BEGIN;

-- Phase 3 Slice 4a: immutable, content-free metric counting with event-time
-- partner attribution. This migration is deliberately additive and does not
-- execute the historical backfill routine it defines below.

CREATE TABLE public.business_metric_definitions (
  metric_key text NOT NULL,
  definition_version integer NOT NULL,
  available_since timestamptz NOT NULL,
  supports_historical_backfill boolean NOT NULL,
  CONSTRAINT business_metric_definitions_pkey
    PRIMARY KEY (metric_key, definition_version),
  CONSTRAINT business_metric_definitions_metric_key_check CHECK (
    metric_key IN (
      'missed_call_caught',
      'ai_conversation_engaged',
      'booking_confirmed',
      'web_chat_session_engaged',
      'contact_created',
      'hot_lead_classified',
      'sms_message_inbound',
      'sms_message_outbound',
      'sms_parts_inbound',
      'sms_parts_outbound',
      'mms_event_inbound',
      'mms_event_outbound'
    )
  ),
  CONSTRAINT business_metric_definitions_version_check
    CHECK (definition_version > 0)
);

INSERT INTO public.business_metric_definitions (
  metric_key,
  definition_version,
  available_since,
  supports_historical_backfill
) VALUES
  ('missed_call_caught', 1, transaction_timestamp(), false),
  ('ai_conversation_engaged', 1, transaction_timestamp(), false),
  ('booking_confirmed', 1, transaction_timestamp(), true),
  ('web_chat_session_engaged', 1, transaction_timestamp(), false),
  ('contact_created', 1, transaction_timestamp(), true),
  ('hot_lead_classified', 1, transaction_timestamp(), true),
  ('sms_message_inbound', 1, transaction_timestamp(), true),
  ('sms_message_outbound', 1, transaction_timestamp(), true),
  ('sms_parts_inbound', 1, transaction_timestamp(), true),
  ('sms_parts_outbound', 1, transaction_timestamp(), true),
  ('mms_event_inbound', 1, transaction_timestamp(), true),
  ('mms_event_outbound', 1, transaction_timestamp(), true);

CREATE TABLE public.business_metric_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  partner_id_at_event uuid,
  metric_key text NOT NULL,
  quantity bigint NOT NULL,
  occurred_at timestamptz NOT NULL,
  definition_version integer NOT NULL DEFAULT 1,
  attribution text NOT NULL,
  source_key text NOT NULL,
  origin text,
  CONSTRAINT business_metric_events_business_id_fkey
    FOREIGN KEY (business_id)
    REFERENCES public.businesses(id)
    ON DELETE RESTRICT,
  CONSTRAINT business_metric_events_definition_fkey
    FOREIGN KEY (metric_key, definition_version)
    REFERENCES public.business_metric_definitions(
      metric_key,
      definition_version
    )
    ON DELETE RESTRICT,
  CONSTRAINT business_metric_events_metric_source_unique
    UNIQUE (metric_key, source_key),
  CONSTRAINT business_metric_events_metric_key_check CHECK (
    metric_key IN (
      'missed_call_caught',
      'ai_conversation_engaged',
      'booking_confirmed',
      'web_chat_session_engaged',
      'contact_created',
      'hot_lead_classified',
      'sms_message_inbound',
      'sms_message_outbound',
      'sms_parts_inbound',
      'sms_parts_outbound',
      'mms_event_inbound',
      'mms_event_outbound'
    )
  ),
  CONSTRAINT business_metric_events_quantity_check CHECK (quantity > 0),
  CONSTRAINT business_metric_events_attribution_check CHECK (
    attribution IN ('event_time', 'current_assignment_backfill')
  ),
  CONSTRAINT business_metric_events_source_key_check CHECK (
    source_key = btrim(source_key)
    AND char_length(source_key) BETWEEN 1 AND 256
  ),
  CONSTRAINT business_metric_events_source_contract_check CHECK (
    CASE metric_key
      WHEN 'missed_call_caught' THEN
        source_key ~ '^missed-call:[0-9a-f]{64}$'
      WHEN 'ai_conversation_engaged' THEN
        source_key ~ '^ai-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-(0[1-9]|1[0-2])$'
      WHEN 'booking_confirmed' THEN
        (
          origin = 'ai'
          AND source_key ~ '^ai-booking:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        )
        OR (
          origin = 'dashboard'
          AND source_key ~ '^dashboard-booking:[0-9a-f]{64}$'
        )
      WHEN 'web_chat_session_engaged' THEN
        source_key ~ '^web-chat-session:[0-9a-f]{64}$'
      WHEN 'contact_created' THEN
        source_key ~ '^contact-created:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      WHEN 'hot_lead_classified' THEN
        source_key ~ '^hot-lead:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      WHEN 'sms_message_inbound' THEN
        source_key ~ '^billing-usage:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      WHEN 'sms_message_outbound' THEN
        source_key ~ '^billing-usage:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      WHEN 'sms_parts_inbound' THEN
        source_key ~ '^billing-usage:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      WHEN 'sms_parts_outbound' THEN
        source_key ~ '^billing-usage:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      WHEN 'mms_event_inbound' THEN
        source_key ~ '^billing-usage:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      WHEN 'mms_event_outbound' THEN
        source_key ~ '^billing-usage:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ELSE false
    END
  ),
  CONSTRAINT business_metric_events_origin_check CHECK (
    (
      metric_key = 'booking_confirmed'
      AND origin IS NOT NULL
      AND origin IN ('ai', 'dashboard')
    )
    OR (
      metric_key <> 'booking_confirmed'
      AND origin IS NULL
    )
  )
);

CREATE INDEX business_metric_events_business_occurred_metric_idx
  ON public.business_metric_events (business_id, occurred_at, metric_key);

CREATE INDEX business_metric_events_partner_occurred_idx
  ON public.business_metric_events (partner_id_at_event, occurred_at);

-- Billing usage can commit even when its metric mirrors fail. Persist the
-- content-free partner snapshot on each new authoritative usage row so a
-- later idempotent mirror repair cannot accidentally use a reassigned brand.
-- Existing rows retain the false default and are honestly labeled as
-- current-assignment backfill when recovered.
ALTER TABLE public.billing_usage_events
  ADD COLUMN metric_partner_id_at_event uuid,
  ADD COLUMN metric_partner_snapshot_captured boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.billing_usage_events.metric_partner_id_at_event IS
  'Content-free partner snapshot used only for event-time metric mirror repair; intentionally has no foreign key.';
COMMENT ON COLUMN public.billing_usage_events.metric_partner_snapshot_captured IS
  'True only when migration-050 billing recording captured partner assignment at usage-recording time.';

COMMENT ON TABLE public.business_metric_events IS
  'Immutable count-only business metric ledger with event-time partner attribution and opaque idempotency keys.';
COMMENT ON COLUMN public.business_metric_events.partner_id_at_event IS
  'Plain UUID snapshot with no foreign key so historical attribution survives partner reassignment or deletion.';
COMMENT ON COLUMN public.business_metric_events.source_key IS
  'Opaque idempotency key. External call, session, and provider identifiers must be hashed before recording.';
COMMENT ON TABLE public.business_metric_definitions IS
  'Immutable metric definition versions and honest live/backfill availability metadata.';

CREATE FUNCTION public.reject_business_metric_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'business metric history is immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER reject_business_metric_events_mutation
BEFORE UPDATE OR DELETE ON public.business_metric_events
FOR EACH ROW
EXECUTE FUNCTION public.reject_business_metric_mutation();

CREATE TRIGGER reject_business_metric_definitions_mutation
BEFORE UPDATE OR DELETE ON public.business_metric_definitions
FOR EACH ROW
EXECUTE FUNCTION public.reject_business_metric_mutation();

ALTER TABLE public.business_metric_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_metric_definitions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_metric_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.business_metric_definitions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (
  id,
  business_id,
  partner_id_at_event,
  metric_key,
  quantity,
  occurred_at,
  definition_version,
  attribution,
  source_key,
  origin
) ON TABLE public.business_metric_events TO service_role;
GRANT INSERT (
  business_id,
  partner_id_at_event,
  metric_key,
  quantity,
  occurred_at,
  definition_version,
  attribution,
  source_key,
  origin
) ON TABLE public.business_metric_events TO service_role;
GRANT SELECT (
  metric_key,
  definition_version,
  available_since,
  supports_historical_backfill
) ON TABLE public.business_metric_definitions TO service_role;

REVOKE ALL ON FUNCTION public.reject_business_metric_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_business_metric_event_v1(
  p_business_id uuid,
  p_metric_key text,
  p_quantity bigint,
  p_occurred_at timestamptz,
  p_source_key text,
  p_origin text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partner_id uuid;
  v_inserted boolean;
BEGIN
  IF p_business_id IS NULL
     OR p_metric_key IS NULL
     OR p_quantity IS NULL
     OR p_quantity <= 0
     OR p_occurred_at IS NULL
     OR p_source_key IS NULL
     OR p_source_key IS DISTINCT FROM btrim(p_source_key)
     OR char_length(p_source_key) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'invalid business metric event payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.partner_id
  INTO v_partner_id
  FROM public.businesses AS business
  WHERE business.id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'metric business not found'
      USING ERRCODE = '23503';
  END IF;

  WITH inserted AS (
    INSERT INTO public.business_metric_events (
      business_id,
      partner_id_at_event,
      metric_key,
      quantity,
      occurred_at,
      definition_version,
      attribution,
      source_key,
      origin
    ) VALUES (
      p_business_id,
      v_partner_id,
      p_metric_key,
      p_quantity,
      p_occurred_at,
      1,
      'event_time',
      p_source_key,
      p_origin
    )
    ON CONFLICT (metric_key, source_key) DO NOTHING
    RETURNING true
  )
  SELECT COALESCE(bool_or(true), false)
  INTO v_inserted
  FROM inserted;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.record_business_metric_event_v1(
  uuid, text, bigint, timestamptz, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_business_metric_event_v1(
  uuid, text, bigint, timestamptz, text, text
) TO service_role;

-- SQL-native durable success boundaries. These trigger functions are
-- SECURITY DEFINER because contacts may be created by authenticated owners,
-- while the count ledger deliberately grants them no INSERT privilege. Every
-- metric failure is isolated inside the trigger and cannot fail the source
-- transaction.
CREATE FUNCTION public.record_contact_created_metric_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.business_id IS NULL OR NEW.created_at IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.record_business_metric_event_v1(
      NEW.business_id,
      'contact_created',
      1,
      NEW.created_at,
      'contact-created:' || NEW.id::text,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'business metric recording failed for business % metric contact_created',
      NEW.business_id;
  END;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.record_hot_lead_classified_metric_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.record_business_metric_event_v1(
      NEW.business_id,
      'hot_lead_classified',
      1,
      NEW.created_at,
      'hot-lead:' || NEW.id::text,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'business metric recording failed for business % metric hot_lead_classified',
      NEW.business_id;
  END;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.record_ai_booking_confirmed_metric_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.confirmed_at IS NULL
     OR (TG_OP = 'UPDATE' AND OLD.confirmed_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.record_business_metric_event_v1(
      NEW.business_id,
      'booking_confirmed',
      1,
      NEW.confirmed_at,
      'ai-booking:' || NEW.id::text,
      'ai'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'business metric recording failed for business % metric booking_confirmed',
      NEW.business_id;
  END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER record_contact_created_metric_v1
AFTER INSERT ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.record_contact_created_metric_v1();

CREATE TRIGGER record_hot_lead_classified_metric_v1
AFTER INSERT ON public.lead_events
FOR EACH ROW
EXECUTE FUNCTION public.record_hot_lead_classified_metric_v1();

CREATE TRIGGER record_ai_booking_confirmed_metric_v1
AFTER INSERT OR UPDATE OF confirmed_at ON public.calendar_bookings
FOR EACH ROW
EXECUTE FUNCTION public.record_ai_booking_confirmed_metric_v1();

REVOKE ALL ON FUNCTION public.record_contact_created_metric_v1()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_hot_lead_classified_metric_v1()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_ai_booking_confirmed_metric_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the complete migration-031 callable contract and authoritative
-- usage/counter transaction. Count mirrors run only after the authoritative
-- work and inside a nested exception block, so they can never roll it back.
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
  v_event_id uuid;
  v_event_business_id uuid;
  v_event_direction text;
  v_event_channel text;
  v_event_sms_parts integer;
  v_event_mms_events integer;
  v_event_created_at timestamptz;
  v_event_partner_id_at_event uuid;
  v_event_partner_snapshot_captured boolean;
  v_event_attribution text;
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

  -- Capturing attribution is metric-only work. Resolve it through an ordinary
  -- MVCC read with no row lock and isolate every failure so authoritative
  -- usage insertion/counters retain their pre-050 behavior.
  v_event_partner_id_at_event := NULL;
  v_event_partner_snapshot_captured := false;
  BEGIN
    SELECT business.partner_id
    INTO v_event_partner_id_at_event
    FROM public.businesses AS business
    WHERE business.id = p_business_id;

    v_event_partner_snapshot_captured := FOUND;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'business metric partner snapshot failed for business %',
      p_business_id;
  END;

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
    metadata,
    metric_partner_id_at_event,
    metric_partner_snapshot_captured
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
    p_metadata,
    v_event_partner_id_at_event,
    v_event_partner_snapshot_captured
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING
    id,
    business_id,
    direction,
    channel,
    sms_parts,
    mms_events,
    created_at,
    metric_partner_id_at_event,
    metric_partner_snapshot_captured
  INTO
    v_event_id,
    v_event_business_id,
    v_event_direction,
    v_event_channel,
    v_event_sms_parts,
    v_event_mms_events,
    v_event_created_at,
    v_event_partner_id_at_event,
    v_event_partner_snapshot_captured;

  v_inserted := FOUND;

  IF v_inserted THEN
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
  ELSE
    SELECT
      usage_event.id,
      usage_event.business_id,
      usage_event.direction,
      usage_event.channel,
      usage_event.sms_parts,
      usage_event.mms_events,
      usage_event.created_at,
      usage_event.metric_partner_id_at_event,
      usage_event.metric_partner_snapshot_captured
    INTO
      v_event_id,
      v_event_business_id,
      v_event_direction,
      v_event_channel,
      v_event_sms_parts,
      v_event_mms_events,
      v_event_created_at,
      v_event_partner_id_at_event,
      v_event_partner_snapshot_captured
    FROM public.billing_usage_events AS usage_event
    WHERE usage_event.idempotency_key = p_idempotency_key;

    IF NOT FOUND THEN
      RETURN false;
    END IF;
  END IF;

  BEGIN
    IF v_event_partner_snapshot_captured THEN
      v_event_attribution := 'event_time';
    ELSE
      SELECT business.partner_id
      INTO v_event_partner_id_at_event
      FROM public.businesses AS business
      WHERE business.id = v_event_business_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'metric business not found'
          USING ERRCODE = '23503';
      END IF;

      v_event_attribution := 'current_assignment_backfill';
    END IF;

    INSERT INTO public.business_metric_events (
      business_id,
      partner_id_at_event,
      metric_key,
      quantity,
      occurred_at,
      definition_version,
      attribution,
      source_key,
      origin
    ) VALUES (
      v_event_business_id,
      v_event_partner_id_at_event,
      'sms_message_' || v_event_direction,
      1,
      v_event_created_at,
      1,
      v_event_attribution,
      'billing-usage:' || v_event_id::text,
      NULL
    )
    ON CONFLICT (metric_key, source_key) DO NOTHING;

    IF v_event_sms_parts > 0 THEN
      INSERT INTO public.business_metric_events (
        business_id,
        partner_id_at_event,
        metric_key,
        quantity,
        occurred_at,
        definition_version,
        attribution,
        source_key,
        origin
      ) VALUES (
        v_event_business_id,
        v_event_partner_id_at_event,
        'sms_parts_' || v_event_direction,
        v_event_sms_parts,
        v_event_created_at,
        1,
        v_event_attribution,
        'billing-usage:' || v_event_id::text,
        NULL
      )
      ON CONFLICT (metric_key, source_key) DO NOTHING;
    END IF;

    IF v_event_mms_events > 0 THEN
      INSERT INTO public.business_metric_events (
        business_id,
        partner_id_at_event,
        metric_key,
        quantity,
        occurred_at,
        definition_version,
        attribution,
        source_key,
        origin
      ) VALUES (
        v_event_business_id,
        v_event_partner_id_at_event,
        'mms_event_' || v_event_direction,
        v_event_mms_events,
        v_event_created_at,
        1,
        v_event_attribution,
        'billing-usage:' || v_event_id::text,
        NULL
      )
      ON CONFLICT (metric_key, source_key) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'business metric mirror failed for business % direction %',
      v_event_business_id,
      v_event_direction;
  END;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.record_billing_usage_event(
  uuid, uuid, text, text, text, text, integer, integer, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_billing_usage_event(
  uuid, uuid, text, text, text, text, integer, integer, text, jsonb
) TO service_role;

-- Deliberate, service-role-only rollout operation. Migration 050 defines this
-- routine but never invokes it. Bryan runs it once after db push verification.
CREATE FUNCTION public.backfill_business_metric_events_v1()
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted bigint;
  v_total_inserted bigint := 0;
BEGIN
  -- The rollout dataset is intentionally tiny. Lock each business row once so
  -- "current assignment" is one coherent snapshot for the whole manual call,
  -- serialized with the existing assignment RPC's FOR UPDATE boundary.
  PERFORM business.id
  FROM public.businesses AS business
  ORDER BY business.id
  FOR SHARE;

  INSERT INTO public.business_metric_events (
    business_id,
    partner_id_at_event,
    metric_key,
    quantity,
    occurred_at,
    definition_version,
    attribution,
    source_key,
    origin
  )
  SELECT
    usage_event.business_id,
    CASE
      WHEN usage_event.metric_partner_snapshot_captured
        THEN usage_event.metric_partner_id_at_event
      ELSE business.partner_id
    END,
    'sms_message_' || usage_event.direction,
    1,
    usage_event.created_at,
    1,
    CASE
      WHEN usage_event.metric_partner_snapshot_captured THEN 'event_time'
      ELSE 'current_assignment_backfill'
    END,
    'billing-usage:' || usage_event.id::text,
    NULL
  FROM public.billing_usage_events AS usage_event
  JOIN public.businesses AS business
    ON business.id = usage_event.business_id
  ON CONFLICT (metric_key, source_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_total_inserted := v_total_inserted + v_inserted;

  INSERT INTO public.business_metric_events (
    business_id,
    partner_id_at_event,
    metric_key,
    quantity,
    occurred_at,
    definition_version,
    attribution,
    source_key,
    origin
  )
  SELECT
    usage_event.business_id,
    CASE
      WHEN usage_event.metric_partner_snapshot_captured
        THEN usage_event.metric_partner_id_at_event
      ELSE business.partner_id
    END,
    'sms_parts_' || usage_event.direction,
    usage_event.sms_parts,
    usage_event.created_at,
    1,
    CASE
      WHEN usage_event.metric_partner_snapshot_captured THEN 'event_time'
      ELSE 'current_assignment_backfill'
    END,
    'billing-usage:' || usage_event.id::text,
    NULL
  FROM public.billing_usage_events AS usage_event
  JOIN public.businesses AS business
    ON business.id = usage_event.business_id
  WHERE usage_event.sms_parts > 0
  ON CONFLICT (metric_key, source_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_total_inserted := v_total_inserted + v_inserted;

  INSERT INTO public.business_metric_events (
    business_id,
    partner_id_at_event,
    metric_key,
    quantity,
    occurred_at,
    definition_version,
    attribution,
    source_key,
    origin
  )
  SELECT
    usage_event.business_id,
    CASE
      WHEN usage_event.metric_partner_snapshot_captured
        THEN usage_event.metric_partner_id_at_event
      ELSE business.partner_id
    END,
    'mms_event_' || usage_event.direction,
    usage_event.mms_events,
    usage_event.created_at,
    1,
    CASE
      WHEN usage_event.metric_partner_snapshot_captured THEN 'event_time'
      ELSE 'current_assignment_backfill'
    END,
    'billing-usage:' || usage_event.id::text,
    NULL
  FROM public.billing_usage_events AS usage_event
  JOIN public.businesses AS business
    ON business.id = usage_event.business_id
  WHERE usage_event.mms_events > 0
  ON CONFLICT (metric_key, source_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_total_inserted := v_total_inserted + v_inserted;

  INSERT INTO public.business_metric_events (
    business_id,
    partner_id_at_event,
    metric_key,
    quantity,
    occurred_at,
    definition_version,
    attribution,
    source_key,
    origin
  )
  SELECT
    booking.business_id,
    business.partner_id,
    'booking_confirmed',
    1,
    booking.confirmed_at,
    1,
    'current_assignment_backfill',
    'ai-booking:' || booking.id::text,
    'ai'
  FROM public.calendar_bookings AS booking
  JOIN public.businesses AS business
    ON business.id = booking.business_id
  WHERE booking.confirmed_at IS NOT NULL
  ON CONFLICT (metric_key, source_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_total_inserted := v_total_inserted + v_inserted;

  INSERT INTO public.business_metric_events (
    business_id,
    partner_id_at_event,
    metric_key,
    quantity,
    occurred_at,
    definition_version,
    attribution,
    source_key,
    origin
  )
  SELECT
    contact.business_id,
    business.partner_id,
    'contact_created',
    1,
    contact.created_at,
    1,
    'current_assignment_backfill',
    'contact-created:' || contact.id::text,
    NULL
  FROM public.contacts AS contact
  JOIN public.businesses AS business
    ON business.id = contact.business_id
  WHERE contact.created_at IS NOT NULL
  ON CONFLICT (metric_key, source_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_total_inserted := v_total_inserted + v_inserted;

  INSERT INTO public.business_metric_events (
    business_id,
    partner_id_at_event,
    metric_key,
    quantity,
    occurred_at,
    definition_version,
    attribution,
    source_key,
    origin
  )
  SELECT
    lead_event.business_id,
    business.partner_id,
    'hot_lead_classified',
    1,
    lead_event.created_at,
    1,
    'current_assignment_backfill',
    'hot-lead:' || lead_event.id::text,
    NULL
  FROM public.lead_events AS lead_event
  JOIN public.businesses AS business
    ON business.id = lead_event.business_id
  ON CONFLICT (metric_key, source_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_total_inserted := v_total_inserted + v_inserted;

  RETURN v_total_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_business_metric_events_v1()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_business_metric_events_v1()
  TO service_role;

-- One strictly scoped monthly read model. All details and totals derive from
-- the same materialized event-time filter; source tables are never read.
CREATE FUNCTION public.list_admin_monthly_business_metrics_v1(
  p_month date,
  p_scope_kind text,
  p_partner_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_result jsonb;
BEGIN
  IF p_month IS NULL
     OR NOT isfinite(p_month)
     OR p_month <> date_trunc('month', p_month::timestamp)::date THEN
    RAISE EXCEPTION 'invalid_metric_month'
      USING ERRCODE = '22023';
  END IF;

  IF p_scope_kind IS NULL
     OR p_scope_kind NOT IN ('all', 'direct', 'partner')
     OR (p_scope_kind IN ('all', 'direct') AND p_partner_id IS NOT NULL)
     OR (p_scope_kind = 'partner' AND p_partner_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_metric_scope'
      USING ERRCODE = '22023';
  END IF;

  v_month_start := p_month::timestamp AT TIME ZONE 'UTC';
  v_month_end := (p_month + interval '1 month')::timestamp
    AT TIME ZONE 'UTC';

  WITH metric_definitions AS MATERIALIZED (
    SELECT
      definition.metric_key,
      definition.definition_version,
      definition.available_since,
      definition.supports_historical_backfill
    FROM public.business_metric_definitions AS definition
    WHERE definition.definition_version = 1
  ),
  filtered_events AS MATERIALIZED (
    SELECT
      event.business_id,
      event.partner_id_at_event,
      event.metric_key,
      event.quantity,
      event.origin
    FROM public.business_metric_events AS event
    WHERE event.occurred_at >= v_month_start
      AND event.occurred_at < v_month_end
      AND (
        p_scope_kind = 'all'
        OR (
          p_scope_kind = 'direct'
          AND event.partner_id_at_event IS NULL
        )
        OR (
          p_scope_kind = 'partner'
          AND event.partner_id_at_event = p_partner_id
        )
      )
  ),
  overall_metric_totals AS (
    SELECT
      event.metric_key,
      SUM(event.quantity)::bigint AS quantity
    FROM filtered_events AS event
    GROUP BY event.metric_key
  ),
  overall_origin_totals AS (
    SELECT
      COALESCE(
        SUM(event.quantity) FILTER (
          WHERE event.metric_key = 'booking_confirmed'
            AND event.origin = 'ai'
        ),
        0
      )::bigint AS booking_confirmed_ai,
      COALESCE(
        SUM(event.quantity) FILTER (
          WHERE event.metric_key = 'booking_confirmed'
            AND event.origin = 'dashboard'
        ),
        0
      )::bigint AS booking_confirmed_dashboard
    FROM filtered_events AS event
  ),
  overall_counts AS (
    SELECT
      jsonb_object_agg(
        definition.metric_key,
        COALESCE(metric_total.quantity, 0)
        ORDER BY definition.metric_key
      )
      || jsonb_build_object(
        'booking_confirmed_ai', origin_total.booking_confirmed_ai,
        'booking_confirmed_dashboard',
          origin_total.booking_confirmed_dashboard
      ) AS counts
    FROM metric_definitions AS definition
    LEFT JOIN overall_metric_totals AS metric_total
      ON metric_total.metric_key = definition.metric_key
    CROSS JOIN overall_origin_totals AS origin_total
    GROUP BY
      origin_total.booking_confirmed_ai,
      origin_total.booking_confirmed_dashboard
  ),
  business_segments AS (
    SELECT DISTINCT
      event.business_id,
      event.partner_id_at_event
    FROM filtered_events AS event
  ),
  business_metric_totals AS (
    SELECT
      event.business_id,
      event.partner_id_at_event,
      event.metric_key,
      SUM(event.quantity)::bigint AS quantity
    FROM filtered_events AS event
    GROUP BY
      event.business_id,
      event.partner_id_at_event,
      event.metric_key
  ),
  business_origin_totals AS (
    SELECT
      event.business_id,
      event.partner_id_at_event,
      COALESCE(
        SUM(event.quantity) FILTER (
          WHERE event.metric_key = 'booking_confirmed'
            AND event.origin = 'ai'
        ),
        0
      )::bigint AS booking_confirmed_ai,
      COALESCE(
        SUM(event.quantity) FILTER (
          WHERE event.metric_key = 'booking_confirmed'
            AND event.origin = 'dashboard'
        ),
        0
      )::bigint AS booking_confirmed_dashboard
    FROM filtered_events AS event
    GROUP BY event.business_id, event.partner_id_at_event
  ),
  business_counts AS (
    SELECT
      segment.business_id,
      segment.partner_id_at_event,
      jsonb_object_agg(
        definition.metric_key,
        COALESCE(metric_total.quantity, 0)
        ORDER BY definition.metric_key
      )
      || jsonb_build_object(
        'booking_confirmed_ai',
          COALESCE(origin_total.booking_confirmed_ai, 0),
        'booking_confirmed_dashboard',
          COALESCE(origin_total.booking_confirmed_dashboard, 0)
      ) AS counts
    FROM business_segments AS segment
    CROSS JOIN metric_definitions AS definition
    LEFT JOIN business_metric_totals AS metric_total
      ON metric_total.business_id = segment.business_id
     AND metric_total.partner_id_at_event
           IS NOT DISTINCT FROM segment.partner_id_at_event
     AND metric_total.metric_key = definition.metric_key
    LEFT JOIN business_origin_totals AS origin_total
      ON origin_total.business_id = segment.business_id
     AND origin_total.partner_id_at_event
           IS NOT DISTINCT FROM segment.partner_id_at_event
    GROUP BY
      segment.business_id,
      segment.partner_id_at_event,
      origin_total.booking_confirmed_ai,
      origin_total.booking_confirmed_dashboard
  ),
  business_rows AS (
    SELECT
      business_count.business_id,
      business.name AS business_name,
      business_count.partner_id_at_event,
      partner.name AS partner_name,
      partner.slug AS partner_slug,
      business_count.counts
    FROM business_counts AS business_count
    JOIN public.businesses AS business
      ON business.id = business_count.business_id
    LEFT JOIN public.partners AS partner
      ON partner.id = business_count.partner_id_at_event
  ),
  brand_segments AS (
    SELECT DISTINCT event.partner_id_at_event
    FROM filtered_events AS event
  ),
  brand_metric_totals AS (
    SELECT
      event.partner_id_at_event,
      event.metric_key,
      SUM(event.quantity)::bigint AS quantity
    FROM filtered_events AS event
    GROUP BY event.partner_id_at_event, event.metric_key
  ),
  brand_origin_totals AS (
    SELECT
      event.partner_id_at_event,
      COALESCE(
        SUM(event.quantity) FILTER (
          WHERE event.metric_key = 'booking_confirmed'
            AND event.origin = 'ai'
        ),
        0
      )::bigint AS booking_confirmed_ai,
      COALESCE(
        SUM(event.quantity) FILTER (
          WHERE event.metric_key = 'booking_confirmed'
            AND event.origin = 'dashboard'
        ),
        0
      )::bigint AS booking_confirmed_dashboard
    FROM filtered_events AS event
    GROUP BY event.partner_id_at_event
  ),
  brand_counts AS (
    SELECT
      segment.partner_id_at_event,
      jsonb_object_agg(
        definition.metric_key,
        COALESCE(metric_total.quantity, 0)
        ORDER BY definition.metric_key
      )
      || jsonb_build_object(
        'booking_confirmed_ai',
          COALESCE(origin_total.booking_confirmed_ai, 0),
        'booking_confirmed_dashboard',
          COALESCE(origin_total.booking_confirmed_dashboard, 0)
      ) AS counts
    FROM brand_segments AS segment
    CROSS JOIN metric_definitions AS definition
    LEFT JOIN brand_metric_totals AS metric_total
      ON metric_total.partner_id_at_event
           IS NOT DISTINCT FROM segment.partner_id_at_event
     AND metric_total.metric_key = definition.metric_key
    LEFT JOIN brand_origin_totals AS origin_total
      ON origin_total.partner_id_at_event
           IS NOT DISTINCT FROM segment.partner_id_at_event
    GROUP BY
      segment.partner_id_at_event,
      origin_total.booking_confirmed_ai,
      origin_total.booking_confirmed_dashboard
  ),
  brand_rows AS (
    SELECT
      CASE
        WHEN brand_count.partner_id_at_event IS NULL THEN 'direct'
        ELSE 'partner'
      END AS brand_kind,
      brand_count.partner_id_at_event,
      partner.name AS partner_name,
      partner.slug AS partner_slug,
      brand_count.counts
    FROM brand_counts AS brand_count
    LEFT JOIN public.partners AS partner
      ON partner.id = brand_count.partner_id_at_event
  ),
  historical_partner_ids AS (
    SELECT partner.id AS partner_id
    FROM public.partners AS partner
    UNION
    SELECT DISTINCT event.partner_id_at_event
    FROM public.business_metric_events AS event
    WHERE event.partner_id_at_event IS NOT NULL
  ),
  partner_option_rows AS (
    SELECT
      partner_id.partner_id,
      partner.name AS partner_name,
      partner.slug AS partner_slug
    FROM historical_partner_ids AS partner_id
    LEFT JOIN public.partners AS partner
      ON partner.id = partner_id.partner_id
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object(
      'month', to_char(p_month, 'YYYY-MM'),
      'start', v_month_start,
      'end_exclusive', v_month_end
    ),
    'scope', jsonb_build_object(
      'kind', p_scope_kind,
      'partner_id', p_partner_id
    ),
    'definitions', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'metric_key', definition.metric_key,
            'definition_version', definition.definition_version,
            'available_since', definition.available_since,
            'supports_historical_backfill',
              definition.supports_historical_backfill
          )
          ORDER BY definition.metric_key
        )
        FROM metric_definitions AS definition
      ),
      '[]'::jsonb
    ),
    'totals', (
      SELECT overall_count.counts
      FROM overall_counts AS overall_count
    ),
    'brand_totals', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'brand_kind', brand.brand_kind,
            'partner_id_at_event', brand.partner_id_at_event,
            'partner_name', brand.partner_name,
            'partner_slug', brand.partner_slug,
            'counts', brand.counts
          )
          ORDER BY
            brand.partner_id_at_event NULLS FIRST,
            brand.partner_name NULLS LAST
        )
        FROM brand_rows AS brand
      ),
      '[]'::jsonb
    ),
    'businesses', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'business_id', business.business_id,
            'business_name', business.business_name,
            'partner_id_at_event', business.partner_id_at_event,
            'partner_name', business.partner_name,
            'partner_slug', business.partner_slug,
            'counts', business.counts
          )
          ORDER BY
            business.partner_id_at_event NULLS FIRST,
            business.business_name,
            business.business_id
        )
        FROM business_rows AS business
      ),
      '[]'::jsonb
    ),
    'partner_options', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'partner_id', partner_option.partner_id,
            'partner_name', partner_option.partner_name,
            'partner_slug', partner_option.partner_slug
          )
          ORDER BY
            partner_option.partner_name NULLS LAST,
            partner_option.partner_id
        )
        FROM partner_option_rows AS partner_option
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.list_admin_monthly_business_metrics_v1(
  date, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_admin_monthly_business_metrics_v1(
  date, text, uuid
) TO service_role;

-- Explicit column grants for the SECURITY INVOKER read/write paths. Existing
-- broader service-role grants on source tables remain unchanged for backward
-- compatibility with deployed application code.
GRANT SELECT (id, partner_id, name)
  ON TABLE public.businesses TO service_role;
GRANT SELECT (id, name, slug)
  ON TABLE public.partners TO service_role;
GRANT SELECT (
  id,
  business_id,
  direction,
  channel,
  sms_parts,
  mms_events,
  created_at,
  metric_partner_id_at_event,
  metric_partner_snapshot_captured
) ON TABLE public.billing_usage_events TO service_role;
GRANT SELECT (id, business_id, confirmed_at)
  ON TABLE public.calendar_bookings TO service_role;
GRANT SELECT (id, business_id, created_at)
  ON TABLE public.contacts TO service_role;
GRANT SELECT (id, business_id, created_at)
  ON TABLE public.lead_events TO service_role;

COMMENT ON FUNCTION public.record_business_metric_event_v1(
  uuid, text, bigint, timestamptz, text, text
) IS
  'Service-role-only idempotent metric recorder; resolves event-time partner attribution inside PostgreSQL.';
COMMENT ON FUNCTION public.backfill_business_metric_events_v1() IS
  'Manual idempotent recoverable-source backfill; legacy rows use current assignment while captured live billing repairs preserve event time. Migration 050 never invokes it.';
COMMENT ON FUNCTION public.list_admin_monthly_business_metrics_v1(
  date, text, uuid
) IS
  'Service-role-only UTC monthly count aggregate with structurally exact all/direct/partner event-time scope.';

COMMIT;
