BEGIN;

-- Phase 3: serialize active direct-booking slots in the same transaction that
-- reserves provider work. Google free/busy remains a useful final provider
-- check, but it cannot by itself prevent two application workers from both
-- observing the same slot as free.

DO $require_non_overlapping_active_calendar_bookings$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS first_booking
    JOIN public.calendar_bookings AS second_booking
      ON second_booking.business_id = first_booking.business_id
     AND second_booking.google_calendar_id = first_booking.google_calendar_id
     AND second_booking.id > first_booking.id
     AND second_booking.status IN ('pending', 'confirmed')
     AND second_booking.starts_at < first_booking.ends_at
     AND second_booking.ends_at > first_booking.starts_at
    WHERE first_booking.status IN ('pending', 'confirmed')
  ) THEN
    RAISE EXCEPTION 'calendar_booking_active_slot_conflict'
      USING
        ERRCODE = '23P01',
        DETAIL = 'Two existing active calendar bookings overlap.',
        HINT = 'Resolve the overlapping pending or confirmed bookings before retrying this migration.';
  END IF;
END;
$require_non_overlapping_active_calendar_bookings$;

CREATE INDEX calendar_bookings_active_slot_lookup_idx
  ON public.calendar_bookings (
    business_id,
    google_calendar_id,
    starts_at,
    ends_at
  )
  WHERE status IN ('pending', 'confirmed');

-- The business row is already the reservation mutex. Keeping the overlap
-- decision after that FOR UPDATE makes separate source messages serialize
-- across all application instances without introducing an extension-backed
-- exclusion constraint or a second lock order.
CREATE OR REPLACE FUNCTION public.reserve_calendar_booking(
  p_business_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid,
  p_source_message_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_claim_token uuid,
  p_google_calendar_id text,
  p_event_summary text,
  p_request_fingerprint text
) RETURNS public.calendar_bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.calendar_bookings%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_contact_id IS NULL
     OR p_conversation_id IS NULL
     OR p_source_message_id IS NULL
     OR p_starts_at IS NULL
     OR p_ends_at IS NULL
     OR p_ends_at <= p_starts_at
     OR p_claim_token IS NULL
     OR NULLIF(btrim(p_google_calendar_id), '') IS NULL
     OR length(p_google_calendar_id) > 1024
     OR NULLIF(btrim(p_event_summary), '') IS NULL
     OR length(p_event_summary) > 1000
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid calendar booking reservation input'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id IS NOT NULL
    AND business.deleted_at IS NULL
    AND business.operations_suspended_at IS NULL
    AND business.bookings_paused_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking business is not active'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.contacts AS contact
    JOIN public.conversations AS conversation
      ON conversation.id = p_conversation_id
     AND conversation.business_id = contact.business_id
     AND conversation.contact_id = contact.id
    JOIN public.messages AS message
      ON message.id = p_source_message_id
     AND message.business_id = conversation.business_id
     AND message.conversation_id = conversation.id
     AND message.role = 'customer'
    WHERE contact.id = p_contact_id
      AND contact.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'calendar booking reservation tenant mismatch'
      USING ERRCODE = '23514';
  END IF;

  -- Resolve source-message idempotency before inspecting mutable retry input.
  -- A confirmed row is authoritative even when a later model/tool retry emits
  -- different arguments. Failed/stale rows must be checked against their
  -- durable calendar and time, because those identity fields are immutable.
  SELECT booking.*
  INTO v_booking
  FROM public.calendar_bookings AS booking
  WHERE booking.business_id = p_business_id
    AND booking.source_message_id = p_source_message_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_booking.contact_id <> p_contact_id
       OR v_booking.conversation_id <> p_conversation_id THEN
      RAISE EXCEPTION 'calendar booking reservation linkage mismatch'
        USING ERRCODE = '23514';
    END IF;

    IF v_booking.status = 'confirmed' THEN
      RETURN v_booking;
    END IF;
    IF v_booking.status = 'cancelled' THEN
      RAISE EXCEPTION 'cancelled calendar booking cannot be reused'
        USING ERRCODE = '23514';
    END IF;

    IF v_booking.request_fingerprint <> p_request_fingerprint THEN
      RAISE EXCEPTION 'source message was reused with different booking details'
        USING ERRCODE = '23514';
    END IF;

    IF v_booking.status = 'pending'
       AND (
         v_booking.operation_claim_token = p_claim_token
         OR v_booking.operation_claimed_at
            > clock_timestamp() - interval '5 minutes'
       ) THEN
      RETURN v_booking;
    END IF;

    IF v_booking.status = 'failed'
       OR (
         v_booking.status = 'pending'
         AND v_booking.operation_claimed_at
            <= clock_timestamp() - interval '5 minutes'
       ) THEN
      IF EXISTS (
        SELECT 1
        FROM public.calendar_bookings AS conflicting_booking
        WHERE conflicting_booking.business_id = p_business_id
          AND conflicting_booking.google_calendar_id =
            v_booking.google_calendar_id
          AND conflicting_booking.status IN ('pending', 'confirmed')
          AND conflicting_booking.id <> v_booking.id
          AND conflicting_booking.starts_at < v_booking.ends_at
          AND conflicting_booking.ends_at > v_booking.starts_at
      ) THEN
        RAISE EXCEPTION 'calendar_booking_slot_unavailable'
          USING ERRCODE = '23P01';
      END IF;

      UPDATE public.calendar_bookings
      SET
        status = 'pending',
        operation_claim_token = p_claim_token,
        operation_claimed_at = clock_timestamp(),
        reconciliation_attempt_count = 0,
        reconciliation_attempted_at = NULL,
        failed_at = NULL,
        failure_reason = NULL
      WHERE id = v_booking.id
      RETURNING * INTO v_booking;
      RETURN v_booking;
    END IF;

    RAISE EXCEPTION 'calendar booking cannot be reserved from status %',
      v_booking.status
      USING ERRCODE = '23514';
  END IF;

  -- Treat slots as half-open ranges so one appointment may begin exactly when
  -- another ends.
  IF EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = p_business_id
      AND booking.google_calendar_id = btrim(p_google_calendar_id)
      AND booking.status IN ('pending', 'confirmed')
      AND booking.starts_at < p_ends_at
      AND booking.ends_at > p_starts_at
  ) THEN
    RAISE EXCEPTION 'calendar_booking_slot_unavailable'
      USING ERRCODE = '23P01';
  END IF;

  INSERT INTO public.calendar_bookings (
    business_id,
    contact_id,
    conversation_id,
    source_message_id,
    google_calendar_id,
    event_summary,
    request_fingerprint,
    status,
    starts_at,
    ends_at,
    operation_claim_token,
    operation_claimed_at
  ) VALUES (
    p_business_id,
    p_contact_id,
    p_conversation_id,
    p_source_message_id,
    btrim(p_google_calendar_id),
    btrim(p_event_summary),
    p_request_fingerprint,
    'pending',
    p_starts_at,
    p_ends_at,
    p_claim_token,
    clock_timestamp()
  )
  RETURNING * INTO v_booking;

  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_calendar_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_calendar_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.reserve_calendar_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, text, text
) IS
  'Serializes direct-booking reservations per business, rejects overlapping pending/confirmed slots on one Google calendar, and preserves source-message idempotency.';

-- Confirmation may carry provider-returned timestamps. Serialize it with new
-- reservations and reject a provider shift into another active local slot.
-- The business -> booking lock order matches reservation and prevents a
-- confirmation/reservation deadlock.
CREATE OR REPLACE FUNCTION public.confirm_calendar_booking(
  p_business_id uuid,
  p_booking_id uuid,
  p_google_event_id text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_claim_token uuid
) RETURNS public.calendar_bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.calendar_bookings%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_booking_id IS NULL
     OR NULLIF(btrim(p_google_event_id), '') IS NULL
     OR p_starts_at IS NULL
     OR p_ends_at IS NULL
     OR p_ends_at <= p_starts_at
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'invalid calendar booking confirmation input'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking not found for business'
      USING ERRCODE = '23503';
  END IF;

  SELECT booking.*
  INTO v_booking
  FROM public.calendar_bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking not found for business'
      USING ERRCODE = '23503';
  END IF;

  IF v_booking.status = 'confirmed' THEN
    IF v_booking.google_event_id = btrim(p_google_event_id) THEN
      RETURN v_booking;
    END IF;
    RAISE EXCEPTION 'calendar booking has a conflicting Google event'
      USING ERRCODE = '23514';
  END IF;
  IF v_booking.status <> 'pending' THEN
    RAISE EXCEPTION 'calendar booking is not pending'
      USING ERRCODE = '23514';
  END IF;
  IF v_booking.operation_claim_token <> p_claim_token THEN
    RAISE EXCEPTION 'calendar booking operation claim mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS conflicting_booking
    WHERE conflicting_booking.business_id = p_business_id
      AND conflicting_booking.google_calendar_id =
        v_booking.google_calendar_id
      AND conflicting_booking.status IN ('pending', 'confirmed')
      AND conflicting_booking.id <> v_booking.id
      AND conflicting_booking.starts_at < p_ends_at
      AND conflicting_booking.ends_at > p_starts_at
  ) THEN
    RAISE EXCEPTION 'calendar_booking_slot_unavailable'
      USING ERRCODE = '23P01';
  END IF;

  UPDATE public.calendar_bookings
  SET
    status = 'confirmed',
    google_event_id = btrim(p_google_event_id),
    starts_at = p_starts_at,
    ends_at = p_ends_at,
    operation_claim_token = NULL,
    operation_claimed_at = NULL,
    confirmed_at = clock_timestamp()
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;

  PERFORM public.promote_contact_lead_status(
    v_booking.business_id,
    v_booking.contact_id,
    'hot',
    'booking_confirmed',
    v_booking.conversation_id,
    v_booking.source_message_id,
    v_booking.id,
    true
  );

  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_calendar_booking(
  uuid, uuid, text, timestamptz, timestamptz, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_calendar_booking(
  uuid, uuid, text, timestamptz, timestamptz, uuid
) TO service_role;

COMMENT ON FUNCTION public.confirm_calendar_booking(
  uuid, uuid, text, timestamptz, timestamptz, uuid
) IS
  'Serializes provider confirmation with reservation and rejects provider-returned times that overlap another active booking on the same Google calendar.';

COMMIT;
