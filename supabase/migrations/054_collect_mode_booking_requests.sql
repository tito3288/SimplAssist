BEGIN;

-- ---------------------------------------------------------------------------
-- Collect-mode appointment-request ledger.
--
-- These rows are customer requests for owner review, never confirmed
-- bookings. Provenance is mandatory at insert time but nullable afterward so
-- the request survives ordinary contact, conversation, and message deletion.
-- ---------------------------------------------------------------------------

CREATE TABLE public.booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,

  contact_id uuid
    REFERENCES public.contacts(id) ON DELETE SET NULL,

  conversation_id uuid
    REFERENCES public.conversations(id) ON DELETE SET NULL,

  source_message_id uuid
    REFERENCES public.messages(id) ON DELETE SET NULL,

  requested_service text NOT NULL,
  requested_time_text text NOT NULL,
  customer_name text,
  customer_phone text,
  customer_email text,
  status text NOT NULL DEFAULT 'new',
  handled_at timestamptz,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_requests_service_not_blank
    CHECK (requested_service ~ '[^[:space:]]'),

  CONSTRAINT booking_requests_time_not_blank
    CHECK (requested_time_text ~ '[^[:space:]]'),

  CONSTRAINT booking_requests_customer_name_not_blank
    CHECK (
      customer_name IS NULL
      OR customer_name ~ '[^[:space:]]'
    ),

  CONSTRAINT booking_requests_customer_phone_not_blank
    CHECK (
      customer_phone IS NULL
      OR customer_phone ~ '[^[:space:]]'
    ),

  CONSTRAINT booking_requests_customer_email_not_blank
    CHECK (
      customer_email IS NULL
      OR customer_email ~ '[^[:space:]]'
    ),

  CONSTRAINT booking_requests_status_check
    CHECK (status IN ('new', 'handled')),

  CONSTRAINT booking_requests_handled_shape
    CHECK (
      (status = 'new' AND handled_at IS NULL)
      OR (status = 'handled' AND handled_at IS NOT NULL)
    ),

  CONSTRAINT booking_requests_idempotency_key_check
    CHECK (
      idempotency_key = btrim(idempotency_key)
      AND char_length(idempotency_key) BETWEEN 1 AND 256
    )
);

COMMENT ON TABLE public.booking_requests IS
  'Customer appointment requests captured for owner review. A row is a request, never a confirmed booking.';

COMMENT ON COLUMN public.booking_requests.requested_service IS
  'Customer-described service, preserved as supplied by the capture tool. The literal fallback not specified is valid request text.';

COMMENT ON COLUMN public.booking_requests.requested_time_text IS
  'Customer requested-time wording preserved without date/time parsing or normalization. The literal fallback not specified is valid request text.';

COMMENT ON COLUMN public.booking_requests.customer_name IS
  'Nullable event-time snapshot of the customer-provided name.';

COMMENT ON COLUMN public.booking_requests.customer_phone IS
  'Nullable event-time snapshot of the customer-provided phone number.';

COMMENT ON COLUMN public.booking_requests.customer_email IS
  'Nullable event-time snapshot of the customer-provided email address.';

COMMENT ON COLUMN public.booking_requests.status IS
  'Owner workflow state. New requests may transition once to handled and cannot be reopened.';

COMMENT ON COLUMN public.booking_requests.idempotency_key IS
  'Opaque per-business request key. It must not contain customer text, contact data, or raw identifiers.';

CREATE UNIQUE INDEX booking_requests_business_idempotency_unique
  ON public.booking_requests (business_id, idempotency_key);

CREATE INDEX booking_requests_business_created_idx
  ON public.booking_requests (business_id, created_at DESC, id DESC);

CREATE INDEX booking_requests_business_status_created_idx
  ON public.booking_requests (
    business_id,
    status,
    created_at DESC,
    id DESC
  );

CREATE INDEX booking_requests_contact_idx
  ON public.booking_requests (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX booking_requests_conversation_idx
  ON public.booking_requests (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX booking_requests_source_message_idx
  ON public.booking_requests (source_message_id)
  WHERE source_message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Initial and continuing tenant integrity.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.validate_booking_request_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation_channel text;
BEGIN
  IF TG_OP = 'INSERT'
     AND (
       NEW.contact_id IS NULL
       OR NEW.conversation_id IS NULL
       OR NEW.source_message_id IS NULL
     ) THEN
    RAISE EXCEPTION
      'booking request requires contact, conversation, and source message linkage'
      USING ERRCODE = '23514',
            CONSTRAINT = 'booking_requests_initial_linkage_required';
  END IF;

  IF TG_OP = 'INSERT'
     AND (
       NEW.status <> 'new'
       OR NEW.handled_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'booking request must begin in new status'
      USING ERRCODE = '23514',
            CONSTRAINT = 'booking_requests_initial_status_required';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM 1
    FROM public.businesses AS business
    WHERE business.id = NEW.business_id
      AND business.cleanup_pii_scrubbed_at IS NULL
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'booking request business is unavailable'
        USING ERRCODE = '23514',
              CONSTRAINT = 'booking_requests_business_available';
    END IF;
  END IF;

  IF NEW.contact_id IS NOT NULL THEN
    PERFORM 1
    FROM public.contacts AS contact
    WHERE contact.id = NEW.contact_id
      AND contact.business_id = NEW.business_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'booking request contact tenant mismatch'
        USING ERRCODE = '23514',
              CONSTRAINT = 'booking_requests_contact_match';
    END IF;
  END IF;

  IF NEW.conversation_id IS NOT NULL THEN
    SELECT conversation.channel
    INTO v_conversation_channel
    FROM public.conversations AS conversation
    WHERE conversation.id = NEW.conversation_id
      AND conversation.business_id = NEW.business_id
      AND (
        NEW.contact_id IS NULL
        OR conversation.contact_id = NEW.contact_id
      )
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'booking request conversation tenant mismatch'
        USING ERRCODE = '23514',
              CONSTRAINT = 'booking_requests_conversation_match';
    END IF;
  END IF;

  IF NEW.source_message_id IS NOT NULL THEN
    PERFORM 1
    FROM public.messages AS message
    WHERE message.id = NEW.source_message_id
      AND message.business_id = NEW.business_id
      AND message.conversation_id = NEW.conversation_id
      AND message.channel = v_conversation_channel
      AND message.role = 'customer'
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'booking request source message tenant mismatch'
        USING ERRCODE = '23514',
              CONSTRAINT = 'booking_requests_source_message_match';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_booking_request_tenant
BEFORE INSERT OR UPDATE
ON public.booking_requests
FOR EACH ROW
EXECUTE FUNCTION public.validate_booking_request_tenant();

REVOKE ALL
  ON FUNCTION public.validate_booking_request_tenant()
  FROM PUBLIC, anon, authenticated, service_role;

-- Request facts are immutable during ordinary operation. Provenance may only
-- be cleared, status may only advance from new to handled, and the permanent
-- account-cleanup trigger may replace customer text with the deletion marker.
CREATE FUNCTION public.guard_booking_request_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fact_change boolean;
  v_cleanup_scrub boolean := false;
BEGIN
  IF ROW(
       NEW.id,
       NEW.business_id,
       NEW.idempotency_key,
       NEW.created_at
     ) IS DISTINCT FROM ROW(
       OLD.id,
       OLD.business_id,
       OLD.idempotency_key,
       OLD.created_at
     ) THEN
    RAISE EXCEPTION 'booking request identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  v_fact_change := ROW(
    NEW.requested_service,
    NEW.requested_time_text,
    NEW.customer_name,
    NEW.customer_phone,
    NEW.customer_email
  ) IS DISTINCT FROM ROW(
    OLD.requested_service,
    OLD.requested_time_text,
    OLD.customer_name,
    OLD.customer_phone,
    OLD.customer_email
  );

  IF v_fact_change THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.businesses AS business
      WHERE business.id = NEW.business_id
        AND business.cleanup_pii_scrubbed_at IS NOT NULL
    )
    INTO v_cleanup_scrub;

    IF NOT (
      v_cleanup_scrub
      AND NEW.requested_service = '[deleted]'
      AND NEW.requested_time_text = '[deleted]'
      AND NEW.customer_name IS NULL
      AND NEW.customer_phone IS NULL
      AND NEW.customer_email IS NULL
    ) THEN
      RAISE EXCEPTION 'booking request facts are immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF (
       NEW.contact_id IS DISTINCT FROM OLD.contact_id
       AND NOT (
         OLD.contact_id IS NOT NULL
         AND NEW.contact_id IS NULL
       )
     )
     OR (
       NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
       AND NOT (
         OLD.conversation_id IS NOT NULL
         AND NEW.conversation_id IS NULL
       )
     )
     OR (
       NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
       AND NOT (
         OLD.source_message_id IS NOT NULL
         AND NEW.source_message_id IS NULL
       )
     ) THEN
    RAISE EXCEPTION
      'booking request provenance is immutable; retained linkages may only be cleared'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(NEW.status, NEW.handled_at)
     IS DISTINCT FROM ROW(OLD.status, OLD.handled_at)
     AND NOT (
       OLD.status = 'new'
       AND OLD.handled_at IS NULL
       AND NEW.status = 'handled'
       AND NEW.handled_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'booking request status is terminal once handled'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_booking_request_mutation
BEFORE UPDATE
ON public.booking_requests
FOR EACH ROW
EXECUTE FUNCTION public.guard_booking_request_mutation();

REVOKE ALL
  ON FUNCTION public.guard_booking_request_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

-- Prevent initially valid provenance from drifting when linkage-bearing
-- parent records are updated. Customer PII and message content remain mutable
-- so existing cleanup behavior continues to work.
CREATE FUNCTION public.guard_contact_booking_request_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(NEW.id, NEW.business_id)
     IS DISTINCT FROM ROW(OLD.id, OLD.business_id)
     AND EXISTS (
       SELECT 1
       FROM public.booking_requests
       WHERE contact_id = OLD.id
     ) THEN
    RAISE EXCEPTION
      'contact linkage is immutable while booking requests exist'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_conversation_booking_request_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(NEW.id, NEW.business_id, NEW.contact_id, NEW.channel)
     IS DISTINCT FROM
        ROW(OLD.id, OLD.business_id, OLD.contact_id, OLD.channel)
     AND EXISTS (
       SELECT 1
       FROM public.booking_requests
       WHERE conversation_id = OLD.id
     ) THEN
    RAISE EXCEPTION
      'conversation linkage is immutable while booking requests exist'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_message_booking_request_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(NEW.id, NEW.business_id, NEW.conversation_id, NEW.role, NEW.channel)
     IS DISTINCT FROM
        ROW(OLD.id, OLD.business_id, OLD.conversation_id, OLD.role, OLD.channel)
     AND EXISTS (
       SELECT 1
       FROM public.booking_requests
       WHERE source_message_id = OLD.id
     ) THEN
    RAISE EXCEPTION
      'message linkage is immutable while booking requests exist'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_contact_booking_request_linkage
BEFORE UPDATE OF id, business_id
ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.guard_contact_booking_request_linkage();

CREATE TRIGGER guard_conversation_booking_request_linkage
BEFORE UPDATE OF id, business_id, contact_id, channel
ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.guard_conversation_booking_request_linkage();

CREATE TRIGGER guard_message_booking_request_linkage
BEFORE UPDATE OF id, business_id, conversation_id, role, channel
ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.guard_message_booking_request_linkage();

REVOKE ALL
  ON FUNCTION public.guard_contact_booking_request_linkage()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL
  ON FUNCTION public.guard_conversation_booking_request_linkage()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL
  ON FUNCTION public.guard_message_booking_request_linkage()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Retention.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.unlink_booking_requests_before_conversation_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.businesses AS business
    WHERE business.id = OLD.business_id
  ) THEN
    UPDATE public.booking_requests
    SET conversation_id = NULL,
        source_message_id = NULL
    WHERE conversation_id = OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER unlink_booking_requests_before_conversation_delete
BEFORE DELETE
ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.unlink_booking_requests_before_conversation_delete();

CREATE FUNCTION public.unlink_booking_requests_before_contact_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.businesses AS business
    WHERE business.id = OLD.business_id
  ) THEN
    UPDATE public.booking_requests
    SET contact_id = NULL,
        conversation_id = NULL,
        source_message_id = NULL
    WHERE contact_id = OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER unlink_booking_requests_before_contact_delete
BEFORE DELETE
ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.unlink_booking_requests_before_contact_delete();

REVOKE ALL
  ON FUNCTION public.unlink_booking_requests_before_conversation_delete()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL
  ON FUNCTION public.unlink_booking_requests_before_contact_delete()
  FROM PUBLIC, anon, authenticated, service_role;

-- Permanent cleanup keeps the business row as a tombstone. Scrub every
-- customer-authored request field when that existing lifecycle marks PII as
-- removed, while retaining status and anonymous request counts.
CREATE FUNCTION public.scrub_booking_requests_on_business_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.booking_requests
  SET requested_service = '[deleted]',
      requested_time_text = '[deleted]',
      customer_name = NULL,
      customer_phone = NULL,
      customer_email = NULL
  WHERE business_id = NEW.id
    AND (
      requested_service <> '[deleted]'
      OR requested_time_text <> '[deleted]'
      OR customer_name IS NOT NULL
      OR customer_phone IS NOT NULL
      OR customer_email IS NOT NULL
    );

  RETURN NEW;
END;
$$;

CREATE TRIGGER scrub_booking_requests_on_business_cleanup
AFTER UPDATE OF cleanup_pii_scrubbed_at
ON public.businesses
FOR EACH ROW
WHEN (
  OLD.cleanup_pii_scrubbed_at IS NULL
  AND NEW.cleanup_pii_scrubbed_at IS NOT NULL
)
EXECUTE FUNCTION public.scrub_booking_requests_on_business_cleanup();

REVOKE ALL
  ON FUNCTION public.scrub_booking_requests_on_business_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Owner handling action.
--
-- The table remains owner-read-only. This single authenticated function
-- authorizes and performs the only owner mutation, using database time and a
-- row lock so repeated or concurrent calls converge on one handled_at value.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.mark_booking_request_handled(
  p_business_id uuid,
  p_request_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_handled_at timestamptz;
BEGIN
  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id = auth.uid()
    AND business.cleanup_pii_scrubbed_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking request not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request_row.status, request_row.handled_at
  INTO v_status, v_handled_at
  FROM public.booking_requests AS request_row
  WHERE request_row.id = p_request_id
    AND request_row.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking request not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'handled' THEN
    RETURN v_handled_at;
  END IF;

  UPDATE public.booking_requests
  SET status = 'handled',
      handled_at = now()
  WHERE id = p_request_id
    AND business_id = p_business_id
  RETURNING handled_at INTO v_handled_at;

  RETURN v_handled_at;
END;
$$;

REVOKE ALL
  ON FUNCTION public.mark_booking_request_handled(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
  ON FUNCTION public.mark_booking_request_handled(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.mark_booking_request_handled(uuid, uuid) IS
  'Authenticated owner-only, idempotent transition of an appointment request from new to handled.';

-- ---------------------------------------------------------------------------
-- Owner-readable, service-written table access.
-- ---------------------------------------------------------------------------

ALTER TABLE public.booking_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_requests_select
ON public.booking_requests
FOR SELECT
TO authenticated
USING (
  business_id IN (
    SELECT id
    FROM public.businesses
    WHERE owner_id = auth.uid()
  )
);

REVOKE ALL
  ON TABLE public.booking_requests
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
  ON TABLE public.booking_requests
  TO authenticated;

GRANT SELECT, INSERT
  ON TABLE public.booking_requests
  TO service_role;

COMMIT;
