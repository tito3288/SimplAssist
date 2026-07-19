-- Server-enforced feature entitlements and retry-safe inbound usage support.
--
-- Subscription plan/status and internal billing flags are authorization data.
-- Customers may read their own subscription, but only service-role Stripe/admin
-- flows may mutate those trusted fields.

DROP POLICY IF EXISTS subscriptions_insert ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_update ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_delete ON public.subscriptions;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.subscriptions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subscriptions
  TO service_role;

-- Keep normal owner profile writes intact while preventing an authenticated
-- Data API client from granting itself billing overrides, overages, or changing
-- internal audit/kill-switch state. Migration/admin/service-role writes are not
-- restricted by this trigger.
CREATE OR REPLACE FUNCTION public.guard_business_billing_authorization_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.billing_pilot IS DISTINCT FROM false
       OR NEW.billing_comped IS DISTINCT FROM false
       OR NEW.billing_exempt IS DISTINCT FROM false
       OR NEW.sms_overage_opt_in IS DISTINCT FROM false
       OR NEW.sms_overage_opted_in_at IS NOT NULL
       OR NEW.sms_overage_opted_in_by IS NOT NULL
       OR NEW.telnyx_submission_disabled IS DISTINCT FROM false
       OR NEW.billing_admin_notes IS NOT NULL
       OR NEW.billing_flags_updated_at IS NOT NULL
       OR NEW.billing_flags_updated_by IS NOT NULL THEN
      RAISE EXCEPTION 'customer writes cannot set protected business billing fields'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.billing_pilot IS DISTINCT FROM OLD.billing_pilot
     OR NEW.billing_comped IS DISTINCT FROM OLD.billing_comped
     OR NEW.billing_exempt IS DISTINCT FROM OLD.billing_exempt
     OR NEW.sms_overage_opt_in IS DISTINCT FROM OLD.sms_overage_opt_in
     OR NEW.sms_overage_opted_in_at IS DISTINCT FROM OLD.sms_overage_opted_in_at
     OR NEW.sms_overage_opted_in_by IS DISTINCT FROM OLD.sms_overage_opted_in_by
     OR NEW.telnyx_submission_disabled IS DISTINCT FROM OLD.telnyx_submission_disabled
     OR NEW.billing_admin_notes IS DISTINCT FROM OLD.billing_admin_notes
     OR NEW.billing_flags_updated_at IS DISTINCT FROM OLD.billing_flags_updated_at
     OR NEW.billing_flags_updated_by IS DISTINCT FROM OLD.billing_flags_updated_by THEN
    RAISE EXCEPTION 'customer writes cannot change protected business billing fields'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_business_billing_authorization_fields
  ON public.businesses;
CREATE TRIGGER guard_business_billing_authorization_fields
BEFORE INSERT OR UPDATE ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_business_billing_authorization_fields();

REVOKE ALL ON FUNCTION public.guard_business_billing_authorization_fields()
  FROM PUBLIC, anon, authenticated, service_role;

-- One provider event maps to at most one stored inbound message. Namespaced
-- provider event keys let webhook retries safely heal partial failures.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS provider_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_event_id_unique
  ON public.messages (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

COMMENT ON COLUMN public.messages.provider_event_id IS
  'Namespaced provider webhook event key used to deduplicate inbound messages. NULL for non-provider and legacy messages.';

-- provider_event_id is trusted webhook state. Owners retain ordinary message
-- writes for the dashboard, but cannot reserve or rewrite a provider key and
-- poison another tenant's globally unique event identifier.
CREATE OR REPLACE FUNCTION public.guard_message_provider_event_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF (TG_OP = 'INSERT' AND NEW.provider_event_id IS NOT NULL)
       OR (TG_OP = 'UPDATE'
           AND NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id) THEN
      RAISE EXCEPTION 'customer writes cannot set provider event identifiers'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_message_provider_event_id ON public.messages;
CREATE TRIGGER guard_message_provider_event_id
BEFORE INSERT OR UPDATE ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.guard_message_provider_event_id();

REVOKE ALL ON FUNCTION public.guard_message_provider_event_id()
  FROM PUBLIC, anon, authenticated, service_role;

-- Dashboard owners still need ordinary message reads/writes (including manual
-- replies). RLS remains the tenant boundary and the trigger above removes the
-- one new trusted column from that client-write surface. Explicit grants are
-- required on new Supabase projects where Data API auto-exposure is disabled.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages
  TO service_role;

-- Resolve any legacy duplicates before adding the concurrency guarantees used
-- by find-or-create. This repair is deliberately non-destructive: the oldest
-- identity remains canonical, conversations move to it so future inbound
-- messages continue the same customer thread, and duplicate contact rows are
-- retained with only their conflicting identity key cleared.
WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY business_id, phone_number
           ORDER BY created_at ASC NULLS LAST, id
         ) AS keep_id,
         row_number() OVER (
           PARTITION BY business_id, phone_number
           ORDER BY created_at ASC NULLS LAST, id
         ) AS row_number
  FROM public.contacts
  WHERE phone_number IS NOT NULL
)
UPDATE public.conversations AS conversation
SET contact_id = ranked.keep_id
FROM ranked
WHERE ranked.row_number > 1
  AND conversation.contact_id = ranked.id;

WITH grouped AS (
  SELECT business_id,
         phone_number,
         (array_agg(id ORDER BY created_at ASC NULLS LAST, id))[1] AS keep_id,
         (array_agg(name ORDER BY created_at ASC NULLS LAST, id)
           FILTER (WHERE name IS NOT NULL))[1] AS retained_name,
         (array_agg(email ORDER BY created_at ASC NULLS LAST, id)
           FILTER (WHERE email IS NOT NULL))[1] AS retained_email,
         (array_agg(notes ORDER BY created_at ASC NULLS LAST, id)
           FILTER (WHERE notes IS NOT NULL))[1] AS retained_notes,
         max(COALESCE(lead_score, 0)) AS retained_lead_score,
         max(last_contacted_at) AS retained_last_contacted_at
  FROM public.contacts
  WHERE phone_number IS NOT NULL
  GROUP BY business_id, phone_number
  HAVING count(*) > 1
)
UPDATE public.contacts AS contact
SET name = COALESCE(contact.name, grouped.retained_name),
    email = COALESCE(contact.email, grouped.retained_email),
    notes = COALESCE(contact.notes, grouped.retained_notes),
    lead_score = GREATEST(COALESCE(contact.lead_score, 0), grouped.retained_lead_score),
    last_contacted_at = GREATEST(contact.last_contacted_at, grouped.retained_last_contacted_at)
FROM grouped
WHERE contact.id = grouped.keep_id;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, phone_number
           ORDER BY created_at ASC NULLS LAST, id
         ) AS row_number
  FROM public.contacts
  WHERE phone_number IS NOT NULL
)
UPDATE public.contacts AS contact
SET phone_number = NULL
FROM ranked
WHERE ranked.row_number > 1
  AND contact.id = ranked.id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY business_id, session_id
           ORDER BY created_at ASC NULLS LAST, id
         ) AS keep_id,
         row_number() OVER (
           PARTITION BY business_id, session_id
           ORDER BY created_at ASC NULLS LAST, id
         ) AS row_number
  FROM public.contacts
  WHERE session_id IS NOT NULL
)
UPDATE public.conversations AS conversation
SET contact_id = ranked.keep_id
FROM ranked
WHERE ranked.row_number > 1
  AND conversation.contact_id = ranked.id;

WITH grouped AS (
  SELECT business_id,
         session_id,
         (array_agg(id ORDER BY created_at ASC NULLS LAST, id))[1] AS keep_id,
         (array_agg(name ORDER BY created_at ASC NULLS LAST, id)
           FILTER (WHERE name IS NOT NULL))[1] AS retained_name,
         (array_agg(email ORDER BY created_at ASC NULLS LAST, id)
           FILTER (WHERE email IS NOT NULL))[1] AS retained_email,
         (array_agg(notes ORDER BY created_at ASC NULLS LAST, id)
           FILTER (WHERE notes IS NOT NULL))[1] AS retained_notes,
         max(COALESCE(lead_score, 0)) AS retained_lead_score,
         max(last_contacted_at) AS retained_last_contacted_at
  FROM public.contacts
  WHERE session_id IS NOT NULL
  GROUP BY business_id, session_id
  HAVING count(*) > 1
)
UPDATE public.contacts AS contact
SET name = COALESCE(contact.name, grouped.retained_name),
    email = COALESCE(contact.email, grouped.retained_email),
    notes = COALESCE(contact.notes, grouped.retained_notes),
    lead_score = GREATEST(COALESCE(contact.lead_score, 0), grouped.retained_lead_score),
    last_contacted_at = GREATEST(contact.last_contacted_at, grouped.retained_last_contacted_at)
FROM grouped
WHERE contact.id = grouped.keep_id;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, session_id
           ORDER BY created_at ASC NULLS LAST, id
         ) AS row_number
  FROM public.contacts
  WHERE session_id IS NOT NULL
)
UPDATE public.contacts AS contact
SET session_id = NULL
FROM ranked
WHERE ranked.row_number > 1
  AND contact.id = ranked.id;

-- If contact merging placed multiple open threads on one identity, prefer a
-- Human/handed-off conversation as the keeper. Other conversations and their
-- messages remain intact as closed, readable history; nothing is deleted.
WITH duplicate_groups AS (
  SELECT business_id,
         contact_id,
         channel,
         bool_or(status = 'handed_off' OR NOT is_ai_handling) AS human_mode,
         max(last_message_at) AS latest_message_at
  FROM public.conversations
  WHERE status <> 'closed'
  GROUP BY business_id, contact_id, channel
  HAVING count(*) > 1
), keepers AS (
  SELECT DISTINCT ON (conversation.business_id, conversation.contact_id, conversation.channel)
         conversation.id,
         duplicate_groups.human_mode,
         duplicate_groups.latest_message_at
  FROM public.conversations AS conversation
  JOIN duplicate_groups
    USING (business_id, contact_id, channel)
  WHERE conversation.status <> 'closed'
  ORDER BY conversation.business_id,
           conversation.contact_id,
           conversation.channel,
           CASE WHEN conversation.status = 'handed_off'
                     OR NOT conversation.is_ai_handling THEN 0 ELSE 1 END,
           conversation.last_message_at DESC NULLS LAST,
           conversation.started_at DESC NULLS LAST,
           conversation.id
)
UPDATE public.conversations AS conversation
SET status = CASE WHEN keepers.human_mode THEN 'handed_off' ELSE 'active' END,
    is_ai_handling = NOT keepers.human_mode,
    last_message_at = keepers.latest_message_at
FROM keepers
WHERE conversation.id = keepers.id;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, contact_id, channel
           ORDER BY
             CASE WHEN status = 'handed_off' OR NOT is_ai_handling THEN 0 ELSE 1 END,
             last_message_at DESC NULLS LAST,
             started_at DESC NULLS LAST,
             id
         ) AS row_number
  FROM public.conversations
  WHERE status <> 'closed'
)
UPDATE public.conversations AS conversation
SET status = 'closed',
    is_ai_handling = false
FROM ranked
WHERE ranked.row_number > 1
  AND conversation.id = ranked.id;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_business_phone_unique
  ON public.contacts (business_id, phone_number)
  WHERE phone_number IS NOT NULL;

-- Migration 007 already installed this guarantee under its original name.
-- Reuse that physical index instead of creating an identical second index on
-- established databases; fresh/partially restored databases still get it via
-- the CREATE below.
DO $$
BEGIN
  IF to_regclass('public.contacts_business_session_unique') IS NULL
     AND to_regclass('public.idx_contacts_business_session') IS NOT NULL THEN
    ALTER INDEX public.idx_contacts_business_session
      RENAME TO contacts_business_session_unique;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_business_session_unique
  ON public.contacts (business_id, session_id)
  WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_open_thread_unique
  ON public.conversations (business_id, contact_id, channel)
  WHERE status <> 'closed';

-- Messaging webhooks need to distinguish an event already completed from one
-- currently owned by another request. Concurrent duplicates of an in-progress
-- event must receive 5xx so a later provider retry remains scheduled.
ALTER TABLE public.processed_webhook_events
  ADD COLUMN IF NOT EXISTS processing_status text,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE public.processed_webhook_events
SET processing_status = COALESCE(processing_status, 'completed'),
    completed_at = CASE
      WHEN COALESCE(processing_status, 'completed') = 'completed'
        THEN COALESCE(completed_at, processed_at, now())
      ELSE NULL
    END
WHERE processing_status IS NULL
   OR (processing_status = 'completed' AND completed_at IS NULL)
   OR (processing_status = 'in_progress' AND completed_at IS NOT NULL);

ALTER TABLE public.processed_webhook_events
  ALTER COLUMN processing_status SET DEFAULT 'completed',
  ALTER COLUMN processing_status SET NOT NULL,
  ALTER COLUMN completed_at SET DEFAULT now();

ALTER TABLE public.processed_webhook_events
  DROP CONSTRAINT IF EXISTS processed_webhook_events_processing_status_check;
ALTER TABLE public.processed_webhook_events
  ADD CONSTRAINT processed_webhook_events_processing_status_check
  CHECK (
    (processing_status = 'completed' AND completed_at IS NOT NULL)
    OR
    (processing_status = 'in_progress'
      AND claim_token IS NOT NULL
      AND claimed_at IS NOT NULL
      AND completed_at IS NULL)
  );

CREATE OR REPLACE FUNCTION public.claim_messaging_webhook_event(
  p_event_id text
) RETURNS TABLE(outcome text, token uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
  v_status text;
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'event id is required' USING ERRCODE = '22023';
  END IF;

  LOOP
    -- INSERT handles a new claim. The conditional conflict update atomically
    -- reclaims only an abandoned in-progress row; a fresh holder or completed
    -- event is never overwritten.
    RETURN QUERY
    INSERT INTO public.processed_webhook_events AS claimed_event (
      event_id,
      processed_at,
      processing_status,
      claim_token,
      claimed_at,
      completed_at
    ) VALUES (
      p_event_id,
      now(),
      'in_progress',
      v_token,
      now(),
      NULL
    )
    ON CONFLICT (event_id) DO UPDATE
    SET processed_at = now(),
        processing_status = 'in_progress',
        claim_token = v_token,
        claimed_at = now(),
        completed_at = NULL
    WHERE claimed_event.processing_status = 'in_progress'
      AND (
        claimed_event.claimed_at IS NULL
        OR claimed_event.claimed_at < now() - interval '2 minutes'
      )
    RETURNING 'claimed'::text, claimed_event.claim_token;

    IF FOUND THEN
      RETURN;
    END IF;

    SELECT event.processing_status
    INTO v_status
    FROM public.processed_webhook_events AS event
    WHERE event.event_id = p_event_id;

    -- A token-owned release may delete the row after the conflict check and
    -- before this read. Retry the atomic INSERT instead of reporting a claim
    -- that no longer exists.
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_status = 'completed' THEN
      RETURN QUERY SELECT 'completed'::text, NULL::uuid;
    ELSE
      RETURN QUERY SELECT 'in_progress'::text, NULL::uuid;
    END IF;
    RETURN;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_messaging_webhook_event(
  p_event_id text,
  p_claim_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.processed_webhook_events
  SET processing_status = 'completed',
      completed_at = now(),
      processed_at = now()
  WHERE event_id = p_event_id
    AND claim_token = p_claim_token
    AND processing_status = 'in_progress';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_messaging_webhook_claim(
  p_event_id text,
  p_claim_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.processed_webhook_events
  WHERE event_id = p_event_id
    AND claim_token = p_claim_token
    AND processing_status = 'in_progress';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_messaging_webhook_event(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_messaging_webhook_event(text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_messaging_webhook_claim(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_messaging_webhook_event(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_messaging_webhook_event(text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_messaging_webhook_claim(text, uuid)
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.processed_webhook_events TO service_role;

-- Insert the immutable usage ledger row and increment its period counters in
-- one transaction. A duplicate idempotency key is a successful no-op and
-- returns false; all other failures abort both operations.
CREATE OR REPLACE FUNCTION public.record_billing_usage_event(
  p_business_id uuid,
  p_usage_period_id uuid,
  p_idempotency_key text,
  p_direction text,
  p_channel text,
  p_source text,
  p_sms_parts integer,
  p_mms_events integer,
  p_provider_message_id text,
  p_metadata jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted boolean;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
     OR p_direction IS NULL OR p_direction NOT IN ('inbound', 'outbound')
     OR p_channel IS NULL OR p_channel NOT IN ('sms', 'mms')
     OR p_source IS NULL OR btrim(p_source) = ''
     OR p_sms_parts IS NULL OR p_sms_parts < 0
     OR p_mms_events IS NULL OR p_mms_events < 0 THEN
    RAISE EXCEPTION 'invalid billing usage event payload'
      USING ERRCODE = '22023';
  END IF;

  WITH inserted AS (
    INSERT INTO public.billing_usage_events (
      business_id,
      usage_period_id,
      idempotency_key,
      direction,
      channel,
      source,
      sms_parts,
      mms_events,
      provider_message_id,
      metadata
    ) VALUES (
      p_business_id,
      p_usage_period_id,
      p_idempotency_key,
      p_direction,
      p_channel,
      p_source,
      p_sms_parts,
      p_mms_events,
      p_provider_message_id,
      p_metadata
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING true
  )
  SELECT COALESCE(bool_or(true), false)
  INTO v_inserted
  FROM inserted;

  IF NOT v_inserted THEN
    RETURN false;
  END IF;

  UPDATE public.billing_usage_periods
  SET inbound_sms_parts = inbound_sms_parts
        + CASE WHEN p_direction = 'inbound' THEN p_sms_parts ELSE 0 END,
      outbound_sms_parts = outbound_sms_parts
        + CASE WHEN p_direction = 'outbound' THEN p_sms_parts ELSE 0 END,
      inbound_mms_events = inbound_mms_events
        + CASE WHEN p_direction = 'inbound' AND p_channel = 'mms'
            THEN p_mms_events ELSE 0 END,
      outbound_mms_events = outbound_mms_events
        + CASE WHEN p_direction = 'outbound' AND p_channel = 'mms'
            THEN p_mms_events ELSE 0 END,
      updated_at = now()
  WHERE id = p_usage_period_id
    AND business_id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'usage period % does not belong to business %',
      p_usage_period_id, p_business_id
      USING ERRCODE = '23503';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_billing_usage_event(
  uuid, uuid, text, text, text, text, integer, integer, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.billing_usage_periods
  TO service_role;
GRANT SELECT, INSERT ON TABLE public.billing_usage_events
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_billing_usage_event(
  uuid, uuid, text, text, text, text, integer, integer, text, jsonb
) TO service_role;

-- The superseded two-step increment helper remains temporarily for
-- migration-first compatibility with an already-running application, but it
-- is no longer client-callable and new code does not use it.
REVOKE ALL ON FUNCTION public.increment_billing_usage_period(
  uuid, text, text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_billing_usage_period(
  uuid, text, text, integer, integer
) TO service_role;
