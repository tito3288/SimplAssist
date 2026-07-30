-- Cross-channel lead tiers and durable direct-calendar booking linkage.
--
-- lead_score is intentionally preserved as historical data. lead_status is
-- the authoritative, monotonic tier. Runtime promotion and all booking
-- lifecycle functions are service-only; authenticated owners may read tiers
-- through the existing contacts policy but cannot set them directly.
-- Valid owner-maintained identity fields intentionally trigger promotion.

ALTER TABLE public.contacts
  ADD COLUMN lead_status text NOT NULL DEFAULT 'normal',
  ADD COLUMN lead_status_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN provided_phone_number text;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_lead_status_valid
    CHECK (lead_status IN ('normal', 'warm', 'hot')),
  ADD CONSTRAINT contacts_provided_phone_e164
    CHECK (
      provided_phone_number IS NULL
      OR provided_phone_number ~ '^\+[1-9][0-9]{7,14}$'
    );

CREATE INDEX contacts_business_lead_status_idx
  ON public.contacts (business_id, lead_status, lead_status_updated_at DESC);

-- ---------------------------------------------------------------------------
-- Deterministic normalization used by the one-time backfill and runtime
-- contact-info promotion trigger. These helpers are not public RPC surfaces.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.lead_tier_rank(p_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_status
    WHEN 'normal' THEN 0
    WHEN 'warm' THEN 1
    WHEN 'hot' THEN 2
    ELSE -1
  END
$$;

CREATE FUNCTION public.lead_normalize_email(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(p_value, '')));
  v_local text;
BEGIN
  IF v_email = '' OR length(v_email) > 320 THEN
    RETURN NULL;
  END IF;

  v_local := split_part(v_email, '@', 1);
  IF v_local = ''
     OR left(v_local, 1) = '.'
     OR right(v_local, 1) = '.'
     OR position('..' IN v_local) > 0
     OR v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' THEN
    RETURN NULL;
  END IF;

  RETURN v_email;
END;
$$;

CREATE FUNCTION public.lead_normalize_phone(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trimmed text := btrim(COALESCE(p_value, ''));
  v_digits text;
  v_phone text;
BEGIN
  IF v_trimmed = ''
     OR v_trimmed !~ '^[+0-9[:space:]().-]+$' THEN
    RETURN NULL;
  END IF;

  v_digits := regexp_replace(v_trimmed, '[^0-9]', '', 'g');
  IF left(v_trimmed, 1) = '+' THEN
    v_phone := '+' || v_digits;
  ELSIF length(v_digits) = 10 THEN
    v_phone := '+1' || v_digits;
  ELSIF length(v_digits) = 11 AND left(v_digits, 1) = '1' THEN
    v_phone := '+' || v_digits;
  ELSE
    RETURN NULL;
  END IF;

  IF v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RETURN NULL;
  END IF;
  RETURN v_phone;
END;
$$;

CREATE FUNCTION public.lead_extract_email(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match text[];
  v_email text;
BEGIN
  FOR v_match IN
    SELECT regexp_matches(
      lower(COALESCE(p_text, '')),
      '(^|[^a-z0-9.!#$%&''*+/=?^_`{|}~@-])([a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+)($|[^a-z0-9@-])',
      'gi'
    )
  LOOP
    v_email := public.lead_normalize_email(v_match[2]);
    IF v_email IS NOT NULL THEN
      RETURN v_email;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.lead_extract_phone(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match text[];
  v_phone text;
BEGIN
  FOR v_match IN
    SELECT regexp_matches(
      COALESCE(p_text, ''),
      '(^|[^0-9])((\+[1-9][0-9[:space:]().-]{6,}[0-9])|(\(?[0-9]{3}\)?[[:space:].-]?[0-9]{3}[[:space:].-]?[0-9]{4}))($|[^0-9])',
      'g'
    )
  LOOP
    v_phone := public.lead_normalize_phone(v_match[2]);
    IF v_phone IS NOT NULL THEN
      RETURN v_phone;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.lead_tier_rank(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lead_normalize_email(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lead_normalize_phone(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lead_extract_email(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lead_extract_phone(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Historical local-data backfill. Existing Google events are deliberately not
-- inferred or linked. Only customer-authored transcript data is extracted,
-- existing structured values are preserved, and no audit table exists yet,
-- so this section cannot emit became_hot events.
-- ---------------------------------------------------------------------------

WITH extracted AS (
  SELECT
    contact.id AS contact_id,
    (
      SELECT public.lead_extract_email(message.content)
      FROM public.conversations AS conversation
      JOIN public.messages AS message
        ON message.conversation_id = conversation.id
       AND message.business_id = conversation.business_id
      WHERE conversation.contact_id = contact.id
        AND conversation.business_id = contact.business_id
        AND message.role = 'customer'
        AND public.lead_extract_email(message.content) IS NOT NULL
      ORDER BY message.created_at, message.id
      LIMIT 1
    ) AS email,
    (
      SELECT public.lead_extract_phone(message.content)
      FROM public.conversations AS conversation
      JOIN public.messages AS message
        ON message.conversation_id = conversation.id
       AND message.business_id = conversation.business_id
      WHERE conversation.contact_id = contact.id
        AND conversation.business_id = contact.business_id
        AND message.role = 'customer'
        AND public.lead_extract_phone(message.content) IS NOT NULL
      ORDER BY message.created_at, message.id
      LIMIT 1
    ) AS provided_phone_number
  FROM public.contacts AS contact
  JOIN public.businesses AS business
    ON business.id = contact.business_id
   AND business.owner_id IS NOT NULL
)
UPDATE public.contacts AS contact
SET
  email = CASE
    WHEN NULLIF(btrim(contact.email), '') IS NULL THEN extracted.email
    ELSE contact.email
  END,
  provided_phone_number = COALESCE(
    contact.provided_phone_number,
    extracted.provided_phone_number
  )
FROM extracted
WHERE extracted.contact_id = contact.id
  AND (
    (NULLIF(btrim(contact.email), '') IS NULL AND extracted.email IS NOT NULL)
    OR (
      contact.provided_phone_number IS NULL
      AND extracted.provided_phone_number IS NOT NULL
    )
  );

WITH message_signals AS (
  SELECT
    contact.id AS contact_id,
    COALESCE(
      bool_or(
        lower(message.content) ~
          '(^|[^a-z0-9])(urgent|urgently|asap|as[[:space:]]+soon[[:space:]]+as[[:space:]]+possible|immediately|emergency|today|now|right[[:space:]]+away)($|[^a-z0-9])'
      ) FILTER (WHERE message.role = 'customer'),
      false
    ) AS urgent,
    COALESCE(
      bool_or(
        lower(message.content) ~
          '(^|[^a-z0-9])(price|pricing|cost|how[[:space:]]+much|rate|fee|quote|cheap|cheapest|budget|afford|estimate|pay|payment|book|booking|appointment|schedule|reserve|set[[:space:]]+up[[:space:]]+a[[:space:]]+time|consultation|meet|meeting|call|demo|service|offer|provide|do[[:space:]]+you[[:space:]]+do|available|help[[:space:]]+me|need|looking[[:space:]]+for|interested)($|[^a-z0-9])'
      ) FILTER (WHERE message.role = 'customer'),
      false
    ) AS service_intent,
    COALESCE(
      bool_or(
        public.lead_extract_email(message.content) IS NOT NULL
      ) FILTER (WHERE message.role = 'customer'),
      false
    ) AS captured_email
  FROM public.contacts AS contact
  LEFT JOIN public.conversations AS conversation
    ON conversation.contact_id = contact.id
   AND conversation.business_id = contact.business_id
  LEFT JOIN public.messages AS message
    ON message.conversation_id = conversation.id
   AND message.business_id = contact.business_id
  GROUP BY contact.id
),
engaged_contacts AS (
  SELECT DISTINCT conversation.contact_id
  FROM public.conversations AS conversation
  JOIN public.messages AS message
    ON message.conversation_id = conversation.id
   AND message.business_id = conversation.business_id
   AND message.role = 'customer'
  GROUP BY conversation.id, conversation.contact_id
  HAVING count(*) >= 2
     AND bool_or(
       position('?' IN message.content) > 0
       OR lower(message.content) ~
         '(^|[.!][[:space:]]+|[\r\n]+[[:space:]]*)["''“”‘’([{[:space:]•-]*(who|what|when|where|why|how|can|could|would|do|does|is|are)($|[^a-z0-9])'
     )
),
classified AS (
  SELECT
    contact.id AS contact_id,
    CASE
      WHEN COALESCE(contact.lead_score, 0) >= 7
        OR public.lead_normalize_email(contact.email) IS NOT NULL
        OR signal.captured_email
        OR public.lead_normalize_phone(contact.provided_phone_number) IS NOT NULL
        OR (
          signal.urgent
          AND (
            NULLIF(btrim(contact.name), '') IS NOT NULL
            OR public.lead_normalize_email(contact.email) IS NOT NULL
            OR public.lead_normalize_phone(contact.phone_number) IS NOT NULL
            OR public.lead_normalize_phone(contact.provided_phone_number)
              IS NOT NULL
          )
        )
      THEN 'hot'
      WHEN COALESCE(contact.lead_score, 0) >= 4
        OR signal.urgent
        OR signal.service_intent
        OR engaged.contact_id IS NOT NULL
      THEN 'warm'
      ELSE 'normal'
    END AS lead_status
  FROM public.contacts AS contact
  JOIN public.businesses AS business
    ON business.id = contact.business_id
   AND business.owner_id IS NOT NULL
  JOIN message_signals AS signal
    ON signal.contact_id = contact.id
  LEFT JOIN engaged_contacts AS engaged
    ON engaged.contact_id = contact.id
)
UPDATE public.contacts AS contact
SET
  lead_status = classified.lead_status,
  lead_status_updated_at = COALESCE(
    contact.last_contacted_at,
    contact.created_at,
    now()
  )
FROM classified
WHERE classified.contact_id = contact.id;

-- ---------------------------------------------------------------------------
-- Service-owned booking and lead-audit tables.
-- ---------------------------------------------------------------------------

CREATE TABLE public.calendar_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL
    REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL
    REFERENCES public.conversations(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL
    REFERENCES public.messages(id) ON DELETE CASCADE,
  google_calendar_id text NOT NULL,
  google_event_id text,
  event_summary text NOT NULL,
  request_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  operation_claim_token uuid,
  operation_claimed_at timestamptz,
  reconciliation_attempt_count integer NOT NULL DEFAULT 0,
  reconciliation_attempted_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_bookings_status_valid
    CHECK (status IN ('pending', 'confirmed', 'failed', 'cancelled')),
  CONSTRAINT calendar_bookings_time_order
    CHECK (ends_at > starts_at),
  CONSTRAINT calendar_bookings_calendar_id_valid
    CHECK (
      btrim(google_calendar_id) <> ''
      AND length(google_calendar_id) <= 1024
    ),
  CONSTRAINT calendar_bookings_summary_valid
    CHECK (btrim(event_summary) <> '' AND length(event_summary) <= 1000),
  CONSTRAINT calendar_bookings_fingerprint_valid
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT calendar_bookings_event_id_valid
    CHECK (google_event_id IS NULL OR btrim(google_event_id) <> ''),
  CONSTRAINT calendar_bookings_reconciliation_count_valid
    CHECK (reconciliation_attempt_count >= 0),
  CONSTRAINT calendar_bookings_failure_reason_valid
    CHECK (failure_reason IS NULL OR length(failure_reason) <= 1000),
  CONSTRAINT calendar_bookings_lifecycle_shape
    CHECK (
      (
        status = 'pending'
        AND google_event_id IS NULL
        AND operation_claim_token IS NOT NULL
        AND operation_claimed_at IS NOT NULL
        AND confirmed_at IS NULL
        AND failed_at IS NULL
        AND cancelled_at IS NULL
        AND failure_reason IS NULL
      )
      OR (
        status = 'confirmed'
        AND google_event_id IS NOT NULL
        AND operation_claim_token IS NULL
        AND operation_claimed_at IS NULL
        AND confirmed_at IS NOT NULL
        AND failed_at IS NULL
        AND cancelled_at IS NULL
        AND failure_reason IS NULL
      )
      OR (
        status = 'failed'
        AND google_event_id IS NULL
        AND operation_claim_token IS NULL
        AND operation_claimed_at IS NULL
        AND confirmed_at IS NULL
        AND failed_at IS NOT NULL
        AND cancelled_at IS NULL
        AND NULLIF(btrim(failure_reason), '') IS NOT NULL
      )
      OR (
        status = 'cancelled'
        AND google_event_id IS NOT NULL
        AND operation_claim_token IS NULL
        AND operation_claimed_at IS NULL
        AND confirmed_at IS NOT NULL
        AND failed_at IS NULL
        AND cancelled_at IS NOT NULL
        AND failure_reason IS NULL
      )
    )
);

CREATE UNIQUE INDEX calendar_bookings_source_message_unique
  ON public.calendar_bookings (business_id, source_message_id);
CREATE UNIQUE INDEX calendar_bookings_google_event_unique
  ON public.calendar_bookings (
    business_id,
    google_calendar_id,
    google_event_id
  )
  WHERE google_event_id IS NOT NULL;
CREATE INDEX calendar_bookings_pending_claim_idx
  ON public.calendar_bookings (
    reconciliation_attempted_at,
    operation_claimed_at,
    id
  )
  WHERE status = 'pending';
CREATE INDEX calendar_bookings_contact_idx
  ON public.calendar_bookings (business_id, contact_id, created_at DESC);

CREATE TABLE public.lead_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL
    REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id uuid
    REFERENCES public.conversations(id) ON DELETE SET NULL,
  source_message_id uuid
    REFERENCES public.messages(id) ON DELETE SET NULL,
  calendar_booking_id uuid
    REFERENCES public.calendar_bookings(id) ON DELETE SET NULL,
  event_type text NOT NULL DEFAULT 'became_hot',
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_events_type_valid CHECK (event_type = 'became_hot'),
  CONSTRAINT lead_events_reason_valid
    CHECK (btrim(reason) <> '' AND length(reason) <= 200),
  CONSTRAINT lead_events_source_shape
    CHECK (source_message_id IS NULL OR conversation_id IS NOT NULL)
);

CREATE UNIQUE INDEX lead_events_first_hot_unique
  ON public.lead_events (contact_id, event_type);
CREATE INDEX lead_events_business_created_idx
  ON public.lead_events (business_id, created_at DESC);

ALTER TABLE public.calendar_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.calendar_bookings
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.lead_events
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.calendar_bookings TO service_role;
GRANT ALL ON TABLE public.lead_events TO service_role;

-- ---------------------------------------------------------------------------
-- Cross-table tenant integrity.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.validate_calendar_booking_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1
  FROM public.contacts AS contact
  WHERE contact.id = NEW.contact_id
    AND contact.business_id = NEW.business_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking contact tenant mismatch'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.conversations AS conversation
  WHERE conversation.id = NEW.conversation_id
    AND conversation.business_id = NEW.business_id
    AND conversation.contact_id = NEW.contact_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking conversation tenant mismatch'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.messages AS message
  WHERE message.id = NEW.source_message_id
    AND message.business_id = NEW.business_id
    AND message.conversation_id = NEW.conversation_id
    AND message.role = 'customer'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking source message tenant mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_calendar_booking_tenant_on_insert
BEFORE INSERT
ON public.calendar_bookings
FOR EACH ROW
EXECUTE FUNCTION public.validate_calendar_booking_tenant();

CREATE TRIGGER validate_calendar_booking_tenant_on_linkage_update
BEFORE UPDATE OF business_id, contact_id, conversation_id, source_message_id
ON public.calendar_bookings
FOR EACH ROW
EXECUTE FUNCTION public.validate_calendar_booking_tenant();

CREATE FUNCTION public.validate_lead_event_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1
  FROM public.contacts AS contact
  WHERE contact.id = NEW.contact_id
    AND contact.business_id = NEW.business_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead event contact tenant mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.conversation_id IS NOT NULL THEN
    PERFORM 1
    FROM public.conversations AS conversation
    WHERE conversation.id = NEW.conversation_id
      AND conversation.business_id = NEW.business_id
      AND conversation.contact_id = NEW.contact_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'lead event conversation tenant mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.source_message_id IS NOT NULL THEN
    PERFORM 1
    FROM public.messages AS message
    WHERE message.id = NEW.source_message_id
      AND message.business_id = NEW.business_id
      AND message.conversation_id = NEW.conversation_id
      AND message.role = 'customer'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'lead event source message tenant mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.calendar_booking_id IS NOT NULL THEN
    PERFORM 1
    FROM public.calendar_bookings AS booking
    WHERE booking.id = NEW.calendar_booking_id
      AND booking.business_id = NEW.business_id
      AND booking.contact_id = NEW.contact_id
      AND (
        NEW.conversation_id IS NULL
        OR booking.conversation_id = NEW.conversation_id
      )
      AND (
        NEW.source_message_id IS NULL
        OR booking.source_message_id = NEW.source_message_id
      )
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'lead event booking tenant mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_lead_event_tenant
BEFORE INSERT OR UPDATE
ON public.lead_events
FOR EACH ROW
EXECUTE FUNCTION public.validate_lead_event_tenant();

REVOKE ALL ON FUNCTION public.validate_calendar_booking_tenant()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_lead_event_tenant()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.guard_contact_lead_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(NEW.id, NEW.business_id)
     IS DISTINCT FROM ROW(OLD.id, OLD.business_id)
     AND (
       EXISTS (
         SELECT 1
         FROM public.calendar_bookings
         WHERE contact_id = OLD.id
       )
       OR EXISTS (
         SELECT 1
         FROM public.lead_events
         WHERE contact_id = OLD.id
       )
     ) THEN
    RAISE EXCEPTION 'contact linkage is immutable while lead data exists'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_conversation_lead_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(NEW.id, NEW.business_id, NEW.contact_id)
     IS DISTINCT FROM ROW(OLD.id, OLD.business_id, OLD.contact_id)
     AND (
       EXISTS (
         SELECT 1
         FROM public.calendar_bookings
         WHERE conversation_id = OLD.id
       )
       OR EXISTS (
         SELECT 1
         FROM public.lead_events
         WHERE conversation_id = OLD.id
       )
     ) THEN
    RAISE EXCEPTION
      'conversation linkage is immutable while lead data exists'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_message_lead_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(NEW.id, NEW.business_id, NEW.conversation_id, NEW.role)
     IS DISTINCT FROM
        ROW(OLD.id, OLD.business_id, OLD.conversation_id, OLD.role)
     AND (
       EXISTS (
         SELECT 1
         FROM public.calendar_bookings
         WHERE source_message_id = OLD.id
       )
       OR EXISTS (
         SELECT 1
         FROM public.lead_events
         WHERE source_message_id = OLD.id
       )
     ) THEN
    RAISE EXCEPTION 'message linkage is immutable while lead data exists'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_contact_lead_linkage
BEFORE UPDATE OF id, business_id
ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.guard_contact_lead_linkage();

CREATE TRIGGER guard_conversation_lead_linkage
BEFORE UPDATE OF id, business_id, contact_id
ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.guard_conversation_lead_linkage();

CREATE TRIGGER guard_message_lead_linkage
BEFORE UPDATE OF id, business_id, conversation_id, role
ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.guard_message_lead_linkage();

REVOKE ALL ON FUNCTION public.guard_contact_lead_linkage()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_conversation_lead_linkage()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_message_lead_linkage()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.unlink_lead_events_before_conversation_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.lead_events
  SET
    conversation_id = NULL,
    source_message_id = NULL,
    calendar_booking_id = NULL
  WHERE conversation_id = OLD.id
    AND EXISTS (
      SELECT 1
      FROM public.contacts AS contact
      WHERE contact.id = lead_events.contact_id
        AND contact.business_id = lead_events.business_id
    );
  RETURN OLD;
END;
$$;

CREATE TRIGGER unlink_lead_events_before_conversation_delete
BEFORE DELETE
ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.unlink_lead_events_before_conversation_delete();

REVOKE ALL ON FUNCTION
  public.unlink_lead_events_before_conversation_delete()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Authoritative, monotonic contact tiers.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.guard_contact_lead_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trusted boolean :=
    current_user IN ('postgres', 'supabase_admin');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_trusted AND NEW.lead_status <> 'normal' THEN
      RAISE EXCEPTION 'lead status is service-managed'
        USING ERRCODE = '42501';
    END IF;
    NEW.lead_status := CASE
      WHEN v_trusted THEN NEW.lead_status
      ELSE 'normal'
    END;
    NEW.lead_status_updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NOT v_trusted
     AND (
       NEW.lead_status IS DISTINCT FROM OLD.lead_status
       OR NEW.lead_status_updated_at
          IS DISTINCT FROM OLD.lead_status_updated_at
     ) THEN
    RAISE EXCEPTION 'lead status is service-managed'
      USING ERRCODE = '42501';
  END IF;

  IF (
       CASE NEW.lead_status
         WHEN 'normal' THEN 0
         WHEN 'warm' THEN 1
         WHEN 'hot' THEN 2
         ELSE -1
       END
     ) < (
       CASE OLD.lead_status
         WHEN 'normal' THEN 0
         WHEN 'warm' THEN 1
         WHEN 'hot' THEN 2
         ELSE -1
       END
     ) THEN
    RAISE EXCEPTION 'lead status cannot be downgraded'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.lead_status IS DISTINCT FROM OLD.lead_status THEN
    NEW.lead_status_updated_at := clock_timestamp();
  ELSE
    NEW.lead_status_updated_at := OLD.lead_status_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_contact_lead_fields
BEFORE INSERT OR UPDATE
ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.guard_contact_lead_fields();

CREATE FUNCTION public.guard_calendar_booking_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trusted boolean :=
    current_user IN ('postgres', 'supabase_admin');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_trusted THEN
      RAISE EXCEPTION 'calendar bookings must be reserved through service RPC'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT v_trusted
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       OLD.status = 'confirmed'
       AND NEW.status = 'cancelled'
     ) THEN
    RAISE EXCEPTION 'calendar booking lifecycle is service-managed'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'cancelled calendar bookings are terminal'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'confirmed'
     AND NEW.status NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'confirmed calendar bookings cannot be unconfirmed'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_calendar_booking_lifecycle
BEFORE INSERT OR UPDATE
ON public.calendar_bookings
FOR EACH ROW
EXECUTE FUNCTION public.guard_calendar_booking_lifecycle();

REVOKE ALL ON FUNCTION public.guard_contact_lead_fields()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_calendar_booking_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.promote_contact_lead_status(
  p_business_id uuid,
  p_contact_id uuid,
  p_new_status text,
  p_reason text,
  p_conversation_id uuid DEFAULT NULL,
  p_source_message_id uuid DEFAULT NULL,
  p_calendar_booking_id uuid DEFAULT NULL,
  p_emit_event boolean DEFAULT true
) RETURNS public.contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contact public.contacts%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_contact_id IS NULL
     OR p_new_status NOT IN ('normal', 'warm', 'hot')
     OR NULLIF(btrim(p_reason), '') IS NULL
     OR length(p_reason) > 200 THEN
    RAISE EXCEPTION 'invalid lead promotion input'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_message_id IS NOT NULL
     AND p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'source message requires conversation linkage'
      USING ERRCODE = '22023';
  END IF;

  SELECT contact.*
  INTO v_contact
  FROM public.contacts AS contact
  WHERE contact.id = p_contact_id
    AND contact.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead contact not found for business'
      USING ERRCODE = '23503';
  END IF;

  IF p_conversation_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.conversations AS conversation
       WHERE conversation.id = p_conversation_id
         AND conversation.business_id = p_business_id
         AND conversation.contact_id = p_contact_id
     ) THEN
    RAISE EXCEPTION 'lead promotion conversation tenant mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF p_source_message_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.messages AS message
       WHERE message.id = p_source_message_id
         AND message.business_id = p_business_id
         AND message.conversation_id = p_conversation_id
         AND message.role = 'customer'
     ) THEN
    RAISE EXCEPTION 'lead promotion source message tenant mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF p_calendar_booking_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.calendar_bookings AS booking
       WHERE booking.id = p_calendar_booking_id
         AND booking.business_id = p_business_id
         AND booking.contact_id = p_contact_id
         AND (
           p_conversation_id IS NULL
           OR booking.conversation_id = p_conversation_id
         )
         AND (
           p_source_message_id IS NULL
           OR booking.source_message_id = p_source_message_id
         )
     ) THEN
    RAISE EXCEPTION 'lead promotion booking tenant mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF public.lead_tier_rank(p_new_status)
     <= public.lead_tier_rank(v_contact.lead_status) THEN
    RETURN v_contact;
  END IF;

  UPDATE public.contacts
  SET lead_status = p_new_status
  WHERE id = p_contact_id
    AND business_id = p_business_id
  RETURNING * INTO v_contact;

  IF p_new_status = 'hot' AND p_emit_event THEN
    INSERT INTO public.lead_events (
      business_id,
      contact_id,
      conversation_id,
      source_message_id,
      calendar_booking_id,
      event_type,
      reason
    ) VALUES (
      p_business_id,
      p_contact_id,
      p_conversation_id,
      p_source_message_id,
      p_calendar_booking_id,
      'became_hot',
      btrim(p_reason)
    )
    ON CONFLICT (contact_id, event_type) DO NOTHING;
  END IF;

  RETURN v_contact;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_contact_lead_status(
  uuid, uuid, text, text, uuid, uuid, uuid, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_contact_lead_status(
  uuid, uuid, text, text, uuid, uuid, uuid, boolean
) TO service_role;

CREATE FUNCTION public.promote_contact_info_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.lead_normalize_email(NEW.email) IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.email IS DISTINCT FROM OLD.email
     ) THEN
    PERFORM public.promote_contact_lead_status(
      NEW.business_id,
      NEW.id,
      'hot',
      'email_captured'
    );
  ELSIF public.lead_normalize_phone(NEW.provided_phone_number) IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.provided_phone_number
          IS DISTINCT FROM OLD.provided_phone_number
     ) THEN
    PERFORM public.promote_contact_lead_status(
      NEW.business_id,
      NEW.id,
      'hot',
      'phone_captured'
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER promote_contact_info_lead
AFTER INSERT OR UPDATE
ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.promote_contact_info_lead();

REVOKE ALL ON FUNCTION public.promote_contact_info_lead()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Retry-stable direct-booking lifecycle. A local claim serializes provider
-- work, while the application also supplies a deterministic Google event ID.
-- The original calendar and request fingerprint are immutable on reuse.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.reserve_calendar_booking(
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
  ON CONFLICT (business_id, source_message_id) DO NOTHING;

  SELECT booking.*
  INTO v_booking
  FROM public.calendar_bookings AS booking
  WHERE booking.business_id = p_business_id
    AND booking.source_message_id = p_source_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking reservation was not persisted'
      USING ERRCODE = '55000';
  END IF;
  IF v_booking.contact_id <> p_contact_id
     OR v_booking.conversation_id <> p_conversation_id THEN
    RAISE EXCEPTION 'calendar booking reservation linkage mismatch'
      USING ERRCODE = '23514';
  END IF;

  -- Once confirmed, the stored provider result is the authoritative
  -- idempotency response even if an AI retry emits different tool arguments.
  -- Pending/failed attempts still require an exact request fingerprint.
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
END;
$$;

CREATE FUNCTION public.claim_calendar_booking_reconciliation(
  p_business_id uuid,
  p_booking_id uuid,
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
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'invalid calendar booking reconciliation claim'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id IS NOT NULL
    AND business.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking business is not active'
      USING ERRCODE = '23514';
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

  IF v_booking.status <> 'pending' THEN
    RETURN v_booking;
  END IF;
  IF v_booking.operation_claim_token <> p_claim_token THEN
    RAISE EXCEPTION 'calendar booking operation claim mismatch'
      USING ERRCODE = '42501';
  END IF;
  IF v_booking.operation_claimed_at
     > clock_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION 'calendar booking claim is not stale'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.calendar_bookings
  SET
    operation_claimed_at = clock_timestamp(),
    reconciliation_attempt_count = reconciliation_attempt_count + 1,
    reconciliation_attempted_at = clock_timestamp()
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;

  RETURN v_booking;
END;
$$;

CREATE FUNCTION public.confirm_calendar_booking(
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

CREATE FUNCTION public.fail_calendar_booking(
  p_business_id uuid,
  p_booking_id uuid,
  p_claim_token uuid,
  p_failure_reason text
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
     OR p_claim_token IS NULL
     OR NULLIF(btrim(p_failure_reason), '') IS NULL
     OR length(p_failure_reason) > 1000 THEN
    RAISE EXCEPTION 'invalid calendar booking failure input'
      USING ERRCODE = '22023';
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

  IF v_booking.status IN ('confirmed', 'failed', 'cancelled') THEN
    RETURN v_booking;
  END IF;
  IF v_booking.operation_claim_token <> p_claim_token THEN
    RAISE EXCEPTION 'calendar booking operation claim mismatch'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.calendar_bookings
  SET
    status = 'failed',
    operation_claim_token = NULL,
    operation_claimed_at = NULL,
    failed_at = clock_timestamp(),
    failure_reason = left(btrim(p_failure_reason), 1000)
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;

  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_calendar_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_calendar_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.confirm_calendar_booking(
  uuid, uuid, text, timestamptz, timestamptz, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_calendar_booking(
  uuid, uuid, text, timestamptz, timestamptz, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.claim_calendar_booking_reconciliation(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_calendar_booking_reconciliation(
  uuid, uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.fail_calendar_booking(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_calendar_booking(
  uuid, uuid, uuid, text
) TO service_role;

-- Keep newly introduced PII/provider linkages out of account tombstones
-- without replacing the large, existing cleanup function.
CREATE FUNCTION public.guard_hot_lead_cleanup_inflight()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.owner_id IS NOT NULL
     AND NEW.owner_id IS NULL
     AND EXISTS (
       SELECT 1
       FROM public.calendar_bookings AS booking
       WHERE booking.business_id = NEW.id
         AND booking.status = 'pending'
         AND booking.operation_claimed_at
             > clock_timestamp() - interval '10 minutes'
     ) THEN
    RAISE EXCEPTION
      'account cleanup is waiting for an in-flight calendar booking'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_hot_lead_cleanup_inflight
BEFORE UPDATE OF owner_id
ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_hot_lead_cleanup_inflight();

REVOKE ALL ON FUNCTION public.guard_hot_lead_cleanup_inflight()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.cleanup_hot_lead_data_on_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL THEN
    UPDATE public.contacts
    SET provided_phone_number = NULL
    WHERE business_id = NEW.id
      AND provided_phone_number IS NOT NULL;

    DELETE FROM public.calendar_bookings
    WHERE business_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER cleanup_hot_lead_data_on_tombstone
AFTER UPDATE OF owner_id
ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_hot_lead_data_on_tombstone();

REVOKE ALL ON FUNCTION public.cleanup_hot_lead_data_on_tombstone()
  FROM PUBLIC, anon, authenticated, service_role;
