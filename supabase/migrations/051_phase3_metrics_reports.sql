BEGIN;

-- Phase 3 Slice 4b: service-role-only monthly report configuration,
-- immutable count snapshots, and a token-fenced delivery ledger. Everything
-- in this migration is additive so migration 051 can deploy before app code.

CREATE TABLE public.metrics_report_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_kind text NOT NULL,
  partner_id uuid,
  selection_mode text NOT NULL DEFAULT 'all',
  reporting_starts_on date NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT metrics_report_configs_scope_kind_check
    CHECK (scope_kind IN ('direct', 'partner')),
  CONSTRAINT metrics_report_configs_partner_id_fkey
    FOREIGN KEY (partner_id)
    REFERENCES public.partners(id)
    ON DELETE RESTRICT,
  CONSTRAINT metrics_report_configs_scope_shape_check CHECK (
    (scope_kind = 'direct' AND partner_id IS NULL)
    OR (scope_kind = 'partner' AND partner_id IS NOT NULL)
  ),
  CONSTRAINT metrics_report_configs_selection_mode_check
    CHECK (selection_mode IN ('all', 'selected')),
  CONSTRAINT metrics_report_configs_reporting_month_check CHECK (
    isfinite(reporting_starts_on)
    AND reporting_starts_on =
      date_trunc('month', reporting_starts_on::timestamp)::date
  )
);

CREATE UNIQUE INDEX metrics_report_configs_one_direct_idx
  ON public.metrics_report_configs (scope_kind)
  WHERE scope_kind = 'direct';

CREATE UNIQUE INDEX metrics_report_configs_one_partner_idx
  ON public.metrics_report_configs (partner_id)
  WHERE scope_kind = 'partner';

CREATE INDEX metrics_report_configs_enabled_due_idx
  ON public.metrics_report_configs (reporting_starts_on, id)
  WHERE enabled;

CREATE TABLE public.metrics_report_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL,
  email text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT metrics_report_recipients_config_id_fkey
    FOREIGN KEY (config_id)
    REFERENCES public.metrics_report_configs(id)
    ON DELETE CASCADE,
  CONSTRAINT metrics_report_recipients_config_email_unique
    UNIQUE (config_id, email),
  CONSTRAINT metrics_report_recipients_email_canonical CHECK (
    email = lower(btrim(email))
    AND length(email) <= 254
    AND email !~ '[[:cntrl:][:space:],<>]'
    AND email ~
      '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  )
);

CREATE INDEX metrics_report_recipients_config_enabled_idx
  ON public.metrics_report_recipients (config_id, email)
  WHERE enabled;

CREATE TABLE public.metrics_report_selected_businesses (
  config_id uuid NOT NULL,
  business_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT metrics_report_selected_businesses_pkey
    PRIMARY KEY (config_id, business_id),
  CONSTRAINT metrics_report_selected_businesses_config_id_fkey
    FOREIGN KEY (config_id)
    REFERENCES public.metrics_report_configs(id)
    ON DELETE CASCADE,
  CONSTRAINT metrics_report_selected_businesses_business_id_fkey
    FOREIGN KEY (business_id)
    REFERENCES public.businesses(id)
    ON DELETE RESTRICT
);

-- This immutable, version-specific predicate is deliberately strict. It
-- rejects extra keys, malformed nested values, unsafe JavaScript integers,
-- out-of-order/duplicate identities, and totals that disagree with rows.
CREATE FUNCTION public.is_valid_metrics_report_snapshot_v1(
  p_period_start date,
  p_snapshot jsonb
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = public, pg_temp
SET datestyle = 'ISO, YMD'
SET timezone = 'UTC'
AS $$
DECLARE
  v_count_keys constant text[] := ARRAY[
    'ai_conversation_engaged',
    'booking_confirmed',
    'booking_confirmed_ai',
    'booking_confirmed_dashboard',
    'contact_created',
    'hot_lead_classified',
    'missed_call_caught',
    'mms_event_inbound',
    'mms_event_outbound',
    'sms_message_inbound',
    'sms_message_outbound',
    'sms_parts_inbound',
    'sms_parts_outbound',
    'web_chat_session_engaged'
  ];
  v_metric_keys constant text[] := ARRAY[
    'ai_conversation_engaged',
    'booking_confirmed',
    'contact_created',
    'hot_lead_classified',
    'missed_call_caught',
    'mms_event_inbound',
    'mms_event_outbound',
    'sms_message_inbound',
    'sms_message_outbound',
    'sms_parts_inbound',
    'sms_parts_outbound',
    'web_chat_session_engaged'
  ];
  v_uuid_pattern constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_period jsonb;
  v_scope jsonb;
  v_selection jsonb;
  v_definitions jsonb;
  v_totals jsonb;
  v_businesses jsonb;
  v_item jsonb;
  v_counts jsonb;
  v_key text;
  v_previous text;
  v_previous_name text;
  v_previous_business_id text;
  v_current text;
  v_month date;
  v_start timestamptz;
  v_end timestamptz;
  v_sum numeric;
  v_index integer;
  v_selected_ids text[] := ARRAY[]::text[];
  v_business_ids text[] := ARRAY[]::text[];
BEGIN
  IF p_snapshot IS NULL
     OR jsonb_typeof(p_snapshot) <> 'object'
     OR NOT p_snapshot ?& ARRAY[
       'period',
       'scope',
       'selection',
       'definitions',
       'totals',
       'businesses'
     ]
     OR p_snapshot - ARRAY[
       'period',
       'scope',
       'selection',
       'definitions',
       'totals',
       'businesses'
     ] <> '{}'::jsonb THEN
    RETURN false;
  END IF;

  v_period := p_snapshot->'period';
  IF jsonb_typeof(v_period) <> 'object'
     OR NOT v_period ?& ARRAY['month', 'start', 'end_exclusive']
     OR v_period - ARRAY['month', 'start', 'end_exclusive'] <> '{}'::jsonb
     OR jsonb_typeof(v_period->'month') <> 'string'
     OR jsonb_typeof(v_period->'start') <> 'string'
     OR jsonb_typeof(v_period->'end_exclusive') <> 'string'
     OR (v_period->>'month') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     OR (v_period->>'start') !~
       '^[0-9]{4}-(0[1-9]|1[0-2])-01T00:00:00\+00:00$'
     OR (v_period->>'end_exclusive') !~
       '^[0-9]{4}-(0[1-9]|1[0-2])-01T00:00:00\+00:00$' THEN
    RETURN false;
  END IF;

  v_month := ((v_period->>'month') || '-01')::date;
  v_start := (v_period->>'start')::timestamptz;
  v_end := (v_period->>'end_exclusive')::timestamptz;
  IF p_period_start <> v_month
     OR v_start <> v_month::timestamp AT TIME ZONE 'UTC'
     OR v_end <> (v_month + interval '1 month')::timestamp
       AT TIME ZONE 'UTC' THEN
    RETURN false;
  END IF;

  v_scope := p_snapshot->'scope';
  IF jsonb_typeof(v_scope) <> 'object'
     OR NOT v_scope ?& ARRAY[
       'kind', 'partner_id', 'brand_name', 'partner_slug'
     ]
     OR v_scope - ARRAY[
       'kind', 'partner_id', 'brand_name', 'partner_slug'
     ] <> '{}'::jsonb
     OR jsonb_typeof(v_scope->'kind') <> 'string'
     OR v_scope->>'kind' NOT IN ('direct', 'partner')
     OR jsonb_typeof(v_scope->'brand_name') <> 'string'
     OR btrim(v_scope->>'brand_name') = ''
     OR jsonb_typeof(v_scope->'partner_slug') NOT IN ('string', 'null') THEN
    RETURN false;
  END IF;

  IF v_scope->>'kind' = 'direct' THEN
    IF jsonb_typeof(v_scope->'partner_id') <> 'null'
       OR jsonb_typeof(v_scope->'partner_slug') <> 'null'
       OR v_scope->>'brand_name' <> 'SimplAssist' THEN
      RETURN false;
    END IF;
  ELSE
    IF jsonb_typeof(v_scope->'partner_id') <> 'string'
       OR (v_scope->>'partner_id') !~ v_uuid_pattern
       OR jsonb_typeof(v_scope->'partner_slug') <> 'string'
       OR (v_scope->>'partner_slug') !~
         '^[a-z0-9]+(-[a-z0-9]+)*$'
       OR char_length(v_scope->>'partner_slug') > 63 THEN
      RETURN false;
    END IF;
  END IF;

  v_selection := p_snapshot->'selection';
  IF jsonb_typeof(v_selection) <> 'object'
     OR NOT v_selection ?& ARRAY['mode', 'business_ids']
     OR v_selection - ARRAY['mode', 'business_ids'] <> '{}'::jsonb
     OR jsonb_typeof(v_selection->'mode') <> 'string'
     OR v_selection->>'mode' NOT IN ('all', 'selected')
     OR jsonb_typeof(v_selection->'business_ids') <> 'array' THEN
    RETURN false;
  END IF;

  v_previous := NULL;
  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(v_selection->'business_ids')
  LOOP
    IF jsonb_typeof(v_item) <> 'string'
       OR trim(both '"' from v_item::text) !~ v_uuid_pattern THEN
      RETURN false;
    END IF;
    v_current := trim(both '"' from v_item::text);
    IF v_previous IS NOT NULL AND v_current <= v_previous THEN
      RETURN false;
    END IF;
    v_selected_ids := array_append(v_selected_ids, v_current);
    v_previous := v_current;
  END LOOP;

  IF (v_selection->>'mode' = 'all' AND cardinality(v_selected_ids) <> 0)
     OR (
       v_selection->>'mode' = 'selected'
       AND cardinality(v_selected_ids) = 0
     ) THEN
    RETURN false;
  END IF;

  v_definitions := p_snapshot->'definitions';
  IF jsonb_typeof(v_definitions) <> 'array'
     OR jsonb_array_length(v_definitions) <> 12 THEN
    RETURN false;
  END IF;

  v_previous := NULL;
  v_index := 1;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_definitions)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR NOT v_item ?& ARRAY[
         'metric_key',
         'definition_version',
         'available_since',
         'supports_historical_backfill'
       ]
       OR v_item - ARRAY[
         'metric_key',
         'definition_version',
         'available_since',
         'supports_historical_backfill'
       ] <> '{}'::jsonb
       OR jsonb_typeof(v_item->'metric_key') <> 'string'
       OR v_item->>'metric_key' <> v_metric_keys[v_index]
       OR jsonb_typeof(v_item->'definition_version') <> 'number'
       OR v_item->>'definition_version' <> '1'
       OR jsonb_typeof(v_item->'available_since') <> 'string'
       OR (v_item->>'available_since') !~
         '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?\+00:00$'
       OR jsonb_typeof(v_item->'supports_historical_backfill') <>
         'boolean'
       OR (v_item->>'supports_historical_backfill')::boolean <>
         (CASE v_item->>'metric_key'
           WHEN 'missed_call_caught' THEN false
           WHEN 'ai_conversation_engaged' THEN false
           WHEN 'web_chat_session_engaged' THEN false
           ELSE true
         END) THEN
      RETURN false;
    END IF;
    IF NOT isfinite((v_item->>'available_since')::timestamptz) THEN
      RETURN false;
    END IF;
    v_previous := v_item->>'metric_key';
    v_index := v_index + 1;
  END LOOP;

  v_totals := p_snapshot->'totals';
  IF jsonb_typeof(v_totals) <> 'object'
     OR NOT v_totals ?& v_count_keys
     OR v_totals - v_count_keys <> '{}'::jsonb THEN
    RETURN false;
  END IF;

  FOREACH v_key IN ARRAY v_count_keys
  LOOP
    IF jsonb_typeof(v_totals->v_key) <> 'number'
       OR (v_totals->>v_key) !~ '^(0|[1-9][0-9]*)$'
       OR (v_totals->>v_key)::numeric > 9007199254740991 THEN
      RETURN false;
    END IF;
  END LOOP;

  v_businesses := p_snapshot->'businesses';
  IF jsonb_typeof(v_businesses) <> 'array' THEN
    RETURN false;
  END IF;

  v_previous_name := NULL;
  v_previous_business_id := NULL;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_businesses)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR NOT v_item ?& ARRAY[
         'business_id',
         'business_name',
         'partner_id_at_event',
         'counts'
       ]
       OR v_item - ARRAY[
         'business_id',
         'business_name',
         'partner_id_at_event',
         'counts'
       ] <> '{}'::jsonb
       OR jsonb_typeof(v_item->'business_id') <> 'string'
       OR (v_item->>'business_id') !~ v_uuid_pattern
       OR jsonb_typeof(v_item->'business_name') <> 'string'
       OR jsonb_typeof(v_item->'counts') <> 'object' THEN
      RETURN false;
    END IF;

    IF v_scope->>'kind' = 'direct' THEN
      IF jsonb_typeof(v_item->'partner_id_at_event') <> 'null' THEN
        RETURN false;
      END IF;
    ELSIF jsonb_typeof(v_item->'partner_id_at_event') <> 'string'
       OR v_item->>'partner_id_at_event' <> v_scope->>'partner_id' THEN
      RETURN false;
    END IF;

    IF (v_item->>'business_id') = ANY(v_business_ids) THEN
      RETURN false;
    END IF;
    IF v_previous_name IS NOT NULL AND (
      v_item->>'business_name' < v_previous_name
      OR (
        v_item->>'business_name' = v_previous_name
        AND v_item->>'business_id' <= v_previous_business_id
      )
    ) THEN
      RETURN false;
    END IF;
    v_previous_name := v_item->>'business_name';
    v_previous_business_id := v_item->>'business_id';
    v_business_ids := array_append(
      v_business_ids,
      v_item->>'business_id'
    );

    v_counts := v_item->'counts';
    IF NOT v_counts ?& v_count_keys
       OR v_counts - v_count_keys <> '{}'::jsonb THEN
      RETURN false;
    END IF;
    FOREACH v_key IN ARRAY v_count_keys
    LOOP
      IF jsonb_typeof(v_counts->v_key) <> 'number'
         OR (v_counts->>v_key) !~ '^(0|[1-9][0-9]*)$'
         OR (v_counts->>v_key)::numeric > 9007199254740991 THEN
        RETURN false;
      END IF;
    END LOOP;

    IF (v_counts->>'booking_confirmed')::numeric <>
       (v_counts->>'booking_confirmed_ai')::numeric
         + (v_counts->>'booking_confirmed_dashboard')::numeric THEN
      RETURN false;
    END IF;
  END LOOP;

  IF v_selection->>'mode' = 'selected'
     AND (
       SELECT COALESCE(array_agg(value ORDER BY value), ARRAY[]::text[])
       FROM unnest(v_business_ids) AS value
     ) <> v_selected_ids THEN
    RETURN false;
  END IF;

  FOREACH v_key IN ARRAY v_count_keys
  LOOP
    SELECT COALESCE(SUM((business->'counts'->>v_key)::numeric), 0)
    INTO v_sum
    FROM jsonb_array_elements(v_businesses) AS business;

    IF v_sum <> (v_totals->>v_key)::numeric
       OR v_sum > 9007199254740991 THEN
      RETURN false;
    END IF;
  END LOOP;

  IF (v_totals->>'booking_confirmed')::numeric <>
     (v_totals->>'booking_confirmed_ai')::numeric
       + (v_totals->>'booking_confirmed_dashboard')::numeric THEN
    RETURN false;
  END IF;

  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$;

CREATE TABLE public.metrics_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL,
  period_start date NOT NULL,
  snapshot_version integer NOT NULL DEFAULT 1,
  snapshot_payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT metrics_reports_config_id_fkey
    FOREIGN KEY (config_id)
    REFERENCES public.metrics_report_configs(id)
    ON DELETE RESTRICT,
  CONSTRAINT metrics_reports_config_period_unique
    UNIQUE (config_id, period_start),
  CONSTRAINT metrics_reports_period_month_check CHECK (
    isfinite(period_start)
    AND period_start = date_trunc('month', period_start::timestamp)::date
  ),
  CONSTRAINT metrics_reports_snapshot_version_check
    CHECK (snapshot_version = 1),
  CONSTRAINT metrics_reports_snapshot_payload_v1_check
    CHECK (
      snapshot_version = 1
      AND public.is_valid_metrics_report_snapshot_v1(
        period_start,
        snapshot_payload
      )
    ),
  CONSTRAINT metrics_reports_status_check CHECK (
    status IN (
      'pending',
      'in_progress',
      'accepted',
      'partial',
      'failed',
      'needs_review'
    )
  )
);

CREATE INDEX metrics_reports_status_period_idx
  ON public.metrics_reports (status, period_start, created_at, id);

CREATE TABLE public.metrics_report_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  retry_after timestamptz DEFAULT clock_timestamp(),
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  provider_request_started_at timestamptz,
  provider_message_id text,
  accepted_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT metrics_report_deliveries_report_id_fkey
    FOREIGN KEY (report_id)
    REFERENCES public.metrics_reports(id)
    ON DELETE RESTRICT,
  CONSTRAINT metrics_report_deliveries_report_recipient_unique
    UNIQUE (report_id, recipient),
  CONSTRAINT metrics_report_deliveries_recipient_canonical CHECK (
    recipient = lower(btrim(recipient))
    AND length(recipient) <= 254
    AND recipient !~ '[[:cntrl:][:space:],<>]'
    AND recipient ~
      '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  CONSTRAINT metrics_report_deliveries_status_check CHECK (
    status IN (
      'pending',
      'claimed',
      'sending',
      'accepted',
      'failed',
      'needs_review'
    )
  ),
  CONSTRAINT metrics_report_deliveries_attempt_count_check
    CHECK (attempt_count BETWEEN 0 AND 3),
  CONSTRAINT metrics_report_deliveries_last_error_code_check CHECK (
    last_error_code IS NULL
    OR (
      char_length(last_error_code) BETWEEN 1 AND 64
      AND last_error_code ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
    )
  ),
  CONSTRAINT metrics_report_deliveries_provider_id_check CHECK (
    provider_message_id IS NULL
    OR (
      provider_message_id = btrim(provider_message_id)
      AND char_length(provider_message_id) BETWEEN 1 AND 255
      AND provider_message_id !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT metrics_report_deliveries_timestamps_finite_check CHECK (
    (retry_after IS NULL OR isfinite(retry_after))
    AND (claimed_at IS NULL OR isfinite(claimed_at))
    AND (lease_expires_at IS NULL OR isfinite(lease_expires_at))
    AND (
      provider_request_started_at IS NULL
      OR isfinite(provider_request_started_at)
    )
    AND (accepted_at IS NULL OR isfinite(accepted_at))
  ),
  CONSTRAINT metrics_report_deliveries_state_shape_check CHECK (
    CASE status
      WHEN 'pending' THEN
        attempt_count BETWEEN 0 AND 2
        AND retry_after IS NOT NULL
        AND claim_token IS NULL
        AND claimed_at IS NULL
        AND lease_expires_at IS NULL
        AND provider_request_started_at IS NULL
        AND provider_message_id IS NULL
        AND accepted_at IS NULL
      WHEN 'claimed' THEN
        attempt_count BETWEEN 1 AND 3
        AND retry_after IS NULL
        AND claim_token IS NOT NULL
        AND claimed_at IS NOT NULL
        AND lease_expires_at = claimed_at + interval '15 minutes'
        AND provider_request_started_at IS NULL
        AND provider_message_id IS NULL
        AND accepted_at IS NULL
        AND last_error_code IS NULL
      WHEN 'sending' THEN
        attempt_count BETWEEN 1 AND 3
        AND retry_after IS NULL
        AND claim_token IS NOT NULL
        AND claimed_at IS NOT NULL
        AND lease_expires_at = claimed_at + interval '15 minutes'
        AND provider_request_started_at IS NOT NULL
        AND provider_request_started_at >= claimed_at
        AND provider_request_started_at < lease_expires_at
        AND provider_message_id IS NULL
        AND accepted_at IS NULL
        AND last_error_code IS NULL
      WHEN 'accepted' THEN
        attempt_count BETWEEN 1 AND 3
        AND retry_after IS NULL
        AND claim_token IS NULL
        AND claimed_at IS NULL
        AND lease_expires_at IS NULL
        AND provider_request_started_at IS NULL
        AND provider_message_id IS NOT NULL
        AND accepted_at IS NOT NULL
        AND last_error_code IS NULL
      WHEN 'failed' THEN
        attempt_count = 3
        AND retry_after IS NULL
        AND claim_token IS NULL
        AND claimed_at IS NULL
        AND lease_expires_at IS NULL
        AND provider_request_started_at IS NULL
        AND provider_message_id IS NULL
        AND accepted_at IS NULL
        AND last_error_code IS NOT NULL
      WHEN 'needs_review' THEN
        attempt_count BETWEEN 1 AND 3
        AND retry_after IS NULL
        AND claim_token IS NULL
        AND claimed_at IS NULL
        AND lease_expires_at IS NULL
        AND provider_request_started_at IS NULL
        AND provider_message_id IS NULL
        AND accepted_at IS NULL
        AND last_error_code IS NOT NULL
      ELSE false
    END
  )
);

CREATE INDEX metrics_report_deliveries_pending_idx
  ON public.metrics_report_deliveries (
    retry_after NULLS FIRST,
    created_at,
    id
  )
  WHERE status = 'pending';

CREATE INDEX metrics_report_deliveries_lease_idx
  ON public.metrics_report_deliveries (lease_expires_at, id)
  WHERE status IN ('claimed', 'sending');

CREATE FUNCTION public.guard_metrics_report_immutable_fields_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.config_id IS DISTINCT FROM OLD.config_id
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.snapshot_version IS DISTINCT FROM OLD.snapshot_version
     OR NEW.snapshot_payload IS DISTINCT FROM OLD.snapshot_payload
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'metrics_report_snapshot_is_immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_metrics_report_immutable_fields
BEFORE UPDATE ON public.metrics_reports
FOR EACH ROW
EXECUTE FUNCTION public.guard_metrics_report_immutable_fields_v1();

CREATE FUNCTION public.guard_metrics_report_delivery_identity_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.report_id IS DISTINCT FROM OLD.report_id
     OR NEW.recipient IS DISTINCT FROM OLD.recipient
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'metrics_report_delivery_identity_is_immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_metrics_report_delivery_identity
BEFORE UPDATE ON public.metrics_report_deliveries
FOR EACH ROW
EXECUTE FUNCTION public.guard_metrics_report_delivery_identity_v1();

CREATE FUNCTION public.sync_metrics_report_status_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report_id uuid;
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_report_id := OLD.report_id;
  ELSE
    v_report_id := NEW.report_id;
  END IF;

  PERFORM report.id
  FROM public.metrics_reports AS report
  WHERE report.id = v_report_id
  FOR UPDATE;

  SELECT CASE
    WHEN bool_or(delivery.status = 'needs_review') THEN 'needs_review'
    WHEN bool_or(delivery.status IN ('claimed', 'sending')) THEN 'in_progress'
    WHEN bool_or(delivery.status = 'pending') THEN 'pending'
    WHEN bool_and(delivery.status = 'accepted') THEN 'accepted'
    WHEN bool_and(delivery.status = 'failed') THEN 'failed'
    ELSE 'partial'
  END
  INTO v_status
  FROM public.metrics_report_deliveries AS delivery
  WHERE delivery.report_id = v_report_id;

  IF v_status IS NOT NULL THEN
    UPDATE public.metrics_reports AS report
    SET status = v_status,
        updated_at = clock_timestamp()
    WHERE report.id = v_report_id
      AND report.status IS DISTINCT FROM v_status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_metrics_report_status
AFTER INSERT OR UPDATE OF status ON public.metrics_report_deliveries
FOR EACH ROW
EXECUTE FUNCTION public.sync_metrics_report_status_v1();

CREATE TRIGGER sync_metrics_report_status_after_delete
AFTER DELETE ON public.metrics_report_deliveries
FOR EACH ROW
EXECUTE FUNCTION public.sync_metrics_report_status_v1();

CREATE FUNCTION public.ensure_metrics_report_has_delivery_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.metrics_report_deliveries AS delivery
    WHERE delivery.report_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'metrics_report_requires_delivery'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER metrics_reports_require_delivery
AFTER INSERT ON public.metrics_reports
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.ensure_metrics_report_has_delivery_v1();

CREATE FUNCTION public.ensure_metrics_report_delivery_remains_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.metrics_reports AS report
    WHERE report.id = OLD.report_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.metrics_report_deliveries AS delivery
    WHERE delivery.report_id = OLD.report_id
  ) THEN
    RAISE EXCEPTION 'metrics_report_requires_delivery'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

CREATE CONSTRAINT TRIGGER metrics_report_deliveries_keep_one
AFTER DELETE ON public.metrics_report_deliveries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.ensure_metrics_report_delivery_remains_v1();

CREATE TRIGGER set_updated_at_metrics_report_configs
BEFORE UPDATE ON public.metrics_report_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_updated_at_metrics_report_recipients
BEFORE UPDATE ON public.metrics_report_recipients
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_updated_at_metrics_reports
BEFORE UPDATE ON public.metrics_reports
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_updated_at_metrics_report_deliveries
BEFORE UPDATE ON public.metrics_report_deliveries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.metrics_report_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrics_report_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrics_report_selected_businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrics_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrics_report_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.metrics_report_configs
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.metrics_report_recipients
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.metrics_report_selected_businesses
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.metrics_reports
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.metrics_report_deliveries
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.metrics_report_configs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.metrics_report_recipients TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.metrics_report_selected_businesses TO service_role;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.metrics_reports TO service_role;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.metrics_report_deliveries TO service_role;

REVOKE ALL ON FUNCTION public.is_valid_metrics_report_snapshot_v1(date, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_metrics_report_snapshot_v1(date, jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION public.guard_metrics_report_immutable_fields_v1()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_metrics_report_delivery_identity_v1()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_metrics_report_status_v1()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ensure_metrics_report_has_delivery_v1()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ensure_metrics_report_delivery_remains_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- Replace a complete direct-or-partner configuration under one scope lock.
-- Child rows are never patched independently by application code.
CREATE FUNCTION public.save_metrics_report_config_v1(
  p_scope_kind text,
  p_partner_id uuid,
  p_selection_mode text,
  p_reporting_starts_on date,
  p_enabled boolean,
  p_recipients jsonb,
  p_selected_business_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_config public.metrics_report_configs%ROWTYPE;
  v_recipient jsonb;
  v_recipient_count integer;
  v_enabled_recipient_count integer;
  v_selected_count integer;
  v_distinct_selected_count integer;
  v_invalid_business_id uuid;
  v_result jsonb;
BEGIN
  IF p_scope_kind IS NULL
     OR p_scope_kind NOT IN ('direct', 'partner')
     OR (p_scope_kind = 'direct' AND p_partner_id IS NOT NULL)
     OR (p_scope_kind = 'partner' AND p_partner_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_metrics_report_scope'
      USING ERRCODE = '22023';
  END IF;

  IF p_selection_mode IS NULL
     OR p_selection_mode NOT IN ('all', 'selected') THEN
    RAISE EXCEPTION 'invalid_metrics_report_selection_mode'
      USING ERRCODE = '22023';
  END IF;

  IF p_reporting_starts_on IS NULL
     OR NOT isfinite(p_reporting_starts_on)
     OR p_reporting_starts_on <>
       date_trunc('month', p_reporting_starts_on::timestamp)::date THEN
    RAISE EXCEPTION 'invalid_metrics_report_start_month'
      USING ERRCODE = '22023';
  END IF;

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid_metrics_report_enabled'
      USING ERRCODE = '22023';
  END IF;

  IF p_recipients IS NULL OR jsonb_typeof(p_recipients) <> 'array' THEN
    RAISE EXCEPTION 'invalid_metrics_report_recipients'
      USING ERRCODE = '22023';
  END IF;

  FOR v_recipient IN SELECT value FROM jsonb_array_elements(p_recipients)
  LOOP
    IF jsonb_typeof(v_recipient) <> 'object'
       OR NOT v_recipient ?& ARRAY['email', 'enabled']
       OR v_recipient - ARRAY['email', 'enabled'] <> '{}'::jsonb
       OR jsonb_typeof(v_recipient->'email') <> 'string'
       OR jsonb_typeof(v_recipient->'enabled') <> 'boolean'
       OR v_recipient->>'email' <> lower(btrim(v_recipient->>'email'))
       OR length(v_recipient->>'email') > 254
       OR (v_recipient->>'email') ~ '[[:cntrl:][:space:],<>]'
       OR (v_recipient->>'email') !~
         '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' THEN
      RAISE EXCEPTION 'invalid_metrics_report_recipient'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE (recipient->>'enabled')::boolean)::integer,
    COUNT(DISTINCT recipient->>'email')::integer
  INTO
    v_recipient_count,
    v_enabled_recipient_count,
    v_distinct_selected_count
  FROM jsonb_array_elements(p_recipients) AS recipient;

  IF v_recipient_count <> v_distinct_selected_count THEN
    RAISE EXCEPTION 'duplicate_metrics_report_recipient'
      USING ERRCODE = '22023';
  END IF;

  IF p_selected_business_ids IS NULL
     OR array_position(p_selected_business_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_metrics_report_selected_businesses'
      USING ERRCODE = '22023';
  END IF;

  v_selected_count := cardinality(p_selected_business_ids);
  SELECT COUNT(DISTINCT business_id)::integer
  INTO v_distinct_selected_count
  FROM unnest(p_selected_business_ids) AS business_id;

  IF v_selected_count <> v_distinct_selected_count THEN
    RAISE EXCEPTION 'duplicate_metrics_report_selected_business'
      USING ERRCODE = '22023';
  END IF;

  IF (p_selection_mode = 'all' AND v_selected_count <> 0)
     OR (p_selection_mode = 'selected' AND v_selected_count = 0) THEN
    RAISE EXCEPTION 'invalid_metrics_report_selection_shape'
      USING ERRCODE = '22023';
  END IF;

  IF p_enabled AND v_enabled_recipient_count = 0 THEN
    RAISE EXCEPTION 'enabled_metrics_report_requires_recipient'
      USING ERRCODE = '22023';
  END IF;

  IF p_scope_kind = 'partner' AND NOT EXISTS (
    SELECT 1
    FROM public.partners AS partner
    WHERE partner.id = p_partner_id
  ) THEN
    RAISE EXCEPTION 'metrics_report_partner_not_found'
      USING ERRCODE = '23503';
  END IF;

  PERFORM business.id
  FROM public.businesses AS business
  JOIN unnest(p_selected_business_ids) AS selected(business_id)
    ON selected.business_id = business.id
  ORDER BY business.id
  FOR SHARE OF business;

  SELECT selected.business_id
  INTO v_invalid_business_id
  FROM unnest(p_selected_business_ids) AS selected(business_id)
  LEFT JOIN public.businesses AS business
    ON business.id = selected.business_id
  WHERE business.id IS NULL
     OR business.deleted_at IS NOT NULL
     OR (
       p_scope_kind = 'direct'
       AND business.partner_id IS NOT NULL
     )
     OR (
       p_scope_kind = 'partner'
       AND business.partner_id IS DISTINCT FROM p_partner_id
     )
  LIMIT 1;

  IF v_invalid_business_id IS NOT NULL THEN
    RAISE EXCEPTION 'metrics_report_business_out_of_scope'
      USING ERRCODE = '22023';
  END IF;

  IF p_scope_kind = 'direct' THEN
    INSERT INTO public.metrics_report_configs AS config (
      scope_kind,
      partner_id,
      selection_mode,
      reporting_starts_on,
      enabled
    ) VALUES (
      'direct',
      NULL,
      p_selection_mode,
      p_reporting_starts_on,
      p_enabled
    )
    ON CONFLICT (scope_kind) WHERE scope_kind = 'direct'
    DO UPDATE SET
      selection_mode = EXCLUDED.selection_mode,
      reporting_starts_on = EXCLUDED.reporting_starts_on,
      enabled = EXCLUDED.enabled
    RETURNING config.* INTO v_config;
  ELSE
    INSERT INTO public.metrics_report_configs AS config (
      scope_kind,
      partner_id,
      selection_mode,
      reporting_starts_on,
      enabled
    ) VALUES (
      'partner',
      p_partner_id,
      p_selection_mode,
      p_reporting_starts_on,
      p_enabled
    )
    ON CONFLICT (partner_id) WHERE scope_kind = 'partner'
    DO UPDATE SET
      selection_mode = EXCLUDED.selection_mode,
      reporting_starts_on = EXCLUDED.reporting_starts_on,
      enabled = EXCLUDED.enabled
    RETURNING config.* INTO v_config;
  END IF;

  DELETE FROM public.metrics_report_recipients AS recipient
  WHERE recipient.config_id = v_config.id;

  INSERT INTO public.metrics_report_recipients (
    config_id,
    email,
    enabled
  )
  SELECT
    v_config.id,
    recipient->>'email',
    (recipient->>'enabled')::boolean
  FROM jsonb_array_elements(p_recipients) AS recipient;

  DELETE FROM public.metrics_report_selected_businesses AS selected
  WHERE selected.config_id = v_config.id;

  INSERT INTO public.metrics_report_selected_businesses (
    config_id,
    business_id
  )
  SELECT v_config.id, selected.business_id
  FROM unnest(p_selected_business_ids) AS selected(business_id);

  SELECT jsonb_build_object(
    'id', v_config.id,
    'scope_kind', v_config.scope_kind,
    'partner_id', v_config.partner_id,
    'selection_mode', v_config.selection_mode,
    'reporting_starts_on', v_config.reporting_starts_on,
    'enabled', v_config.enabled,
    'recipients', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'email', recipient.email,
            'enabled', recipient.enabled
          )
          ORDER BY recipient.email
        )
        FROM public.metrics_report_recipients AS recipient
        WHERE recipient.config_id = v_config.id
      ),
      '[]'::jsonb
    ),
    'selected_business_ids', COALESCE(
      (
        SELECT jsonb_agg(selected.business_id ORDER BY selected.business_id)
        FROM public.metrics_report_selected_businesses AS selected
        WHERE selected.config_id = v_config.id
      ),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_metrics_report_config_v1(
  text, uuid, text, date, boolean, jsonb, uuid[]
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_metrics_report_config_v1(
  text, uuid, text, date, boolean, jsonb, uuid[]
) TO service_role;

-- Additive v2 read model. V1 remains byte-for-byte untouched. The optional
-- business predicate is ANDed with the event-time scope, while options remain
-- stable because they are built independently from that predicate.
CREATE FUNCTION public.list_admin_monthly_business_metrics_v2(
  p_month date,
  p_scope_kind text,
  p_partner_id uuid,
  p_business_id uuid
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
      AND (p_business_id IS NULL OR event.business_id = p_business_id)
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
  ),
  scoped_business_ids AS (
    SELECT business.id AS business_id
    FROM public.businesses AS business
    WHERE business.deleted_at IS NULL
      AND (
        p_scope_kind = 'all'
        OR (p_scope_kind = 'direct' AND business.partner_id IS NULL)
        OR (
          p_scope_kind = 'partner'
          AND business.partner_id = p_partner_id
        )
      )
    UNION
    SELECT DISTINCT event.business_id
    FROM public.business_metric_events AS event
    WHERE p_scope_kind = 'all'
       OR (p_scope_kind = 'direct' AND event.partner_id_at_event IS NULL)
       OR (
         p_scope_kind = 'partner'
         AND event.partner_id_at_event = p_partner_id
       )
  ),
  business_option_rows AS (
    SELECT
      scoped.business_id,
      business.name AS business_name
    FROM scoped_business_ids AS scoped
    JOIN public.businesses AS business
      ON business.id = scoped.business_id
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object(
      'month', to_char(p_month, 'YYYY-MM'),
      'start', v_month_start,
      'end_exclusive', v_month_end
    ),
    'scope', jsonb_build_object(
      'kind', p_scope_kind,
      'partner_id', p_partner_id,
      'business_id', p_business_id
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
    ),
    'business_options', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'business_id', business_option.business_id,
            'business_name', business_option.business_name
          )
          ORDER BY
            business_option.business_name,
            business_option.business_id
        )
        FROM business_option_rows AS business_option
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.list_admin_monthly_business_metrics_v2(
  date, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_admin_monthly_business_metrics_v2(
  date, text, uuid, uuid
) TO service_role;

-- Compute a frozen v1 payload without applying the enabled/start scheduling
-- gates. Admin test sends use this exact aggregate, and the persistence wrapper
-- below calls it rather than maintaining a second counting implementation.
CREATE FUNCTION public.preview_metrics_report_payload_v1(
  p_config_id uuid,
  p_period_start date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  v_config public.metrics_report_configs%ROWTYPE;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_current_month date;
  v_selected_count integer;
  v_result jsonb;
BEGIN
  IF p_config_id IS NULL THEN
    RAISE EXCEPTION 'metrics_report_config_id_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_period_start IS NULL
     OR NOT isfinite(p_period_start)
     OR p_period_start <>
       date_trunc('month', p_period_start::timestamp)::date THEN
    RAISE EXCEPTION 'invalid_metrics_report_period'
      USING ERRCODE = '22023';
  END IF;

  v_current_month := date_trunc(
    'month',
    transaction_timestamp() AT TIME ZONE 'UTC'
  )::date;
  IF p_period_start >= v_current_month THEN
    RAISE EXCEPTION 'metrics_report_period_not_complete'
      USING ERRCODE = '22023';
  END IF;

  SELECT config.*
  INTO v_config
  FROM public.metrics_report_configs AS config
  WHERE config.id = p_config_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'metrics_report_config_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_selected_count
  FROM public.metrics_report_selected_businesses AS selected
  WHERE selected.config_id = v_config.id;

  IF (v_config.selection_mode = 'all' AND v_selected_count <> 0)
     OR (
       v_config.selection_mode = 'selected'
       AND v_selected_count = 0
     ) THEN
    RAISE EXCEPTION 'invalid_metrics_report_selection_shape'
      USING ERRCODE = '22023';
  END IF;

  v_month_start := p_period_start::timestamp AT TIME ZONE 'UTC';
  v_month_end := (p_period_start + interval '1 month')::timestamp
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
  selected_ids AS MATERIALIZED (
    SELECT selected.business_id
    FROM public.metrics_report_selected_businesses AS selected
    WHERE selected.config_id = v_config.id
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
        (v_config.scope_kind = 'direct'
          AND event.partner_id_at_event IS NULL)
        OR (v_config.scope_kind = 'partner'
          AND event.partner_id_at_event = v_config.partner_id)
      )
      AND (
        v_config.selection_mode = 'all'
        OR EXISTS (
          SELECT 1
          FROM selected_ids AS selected
          WHERE selected.business_id = event.business_id
        )
      )
  ),
  business_segments AS (
    SELECT DISTINCT
      event.business_id,
      event.partner_id_at_event
    FROM filtered_events AS event
    UNION
    SELECT
      selected.business_id,
      CASE
        WHEN v_config.scope_kind = 'partner' THEN v_config.partner_id
        ELSE NULL::uuid
      END AS partner_id_at_event
    FROM selected_ids AS selected
    WHERE v_config.selection_mode = 'selected'
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
      business_count.counts
    FROM business_counts AS business_count
    JOIN public.businesses AS business
      ON business.id = business_count.business_id
  ),
  total_counts AS (
    SELECT
      jsonb_object_agg(
        definition.metric_key,
        COALESCE(
          (
            SELECT SUM((business.counts->>definition.metric_key)::bigint)
            FROM business_counts AS business
          ),
          0
        )
        ORDER BY definition.metric_key
      )
      || jsonb_build_object(
        'booking_confirmed_ai', COALESCE(
          (
            SELECT SUM(
              (business.counts->>'booking_confirmed_ai')::bigint
            )
            FROM business_counts AS business
          ),
          0
        ),
        'booking_confirmed_dashboard', COALESCE(
          (
            SELECT SUM(
              (business.counts->>'booking_confirmed_dashboard')::bigint
            )
            FROM business_counts AS business
          ),
          0
        )
      ) AS counts
    FROM metric_definitions AS definition
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object(
      'month', to_char(p_period_start, 'YYYY-MM'),
      'start', v_month_start,
      'end_exclusive', v_month_end
    ),
    'scope', jsonb_build_object(
      'kind', v_config.scope_kind,
      'partner_id', v_config.partner_id,
      'brand_name', CASE
        WHEN v_config.scope_kind = 'direct' THEN 'SimplAssist'
        ELSE partner.name
      END,
      'partner_slug', CASE
        WHEN v_config.scope_kind = 'direct' THEN NULL::text
        ELSE partner.slug
      END
    ),
    'selection', jsonb_build_object(
      'mode', v_config.selection_mode,
      'business_ids', COALESCE(
        (
          SELECT jsonb_agg(selected.business_id ORDER BY selected.business_id)
          FROM selected_ids AS selected
        ),
        '[]'::jsonb
      )
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
    'totals', (SELECT total.counts FROM total_counts AS total),
    'businesses', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'business_id', business.business_id,
            'business_name', business.business_name,
            'partner_id_at_event', business.partner_id_at_event,
            'counts', business.counts
          )
          ORDER BY business.business_name, business.business_id
        )
        FROM business_rows AS business
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.partners AS partner
    ON partner.id = v_config.partner_id;

  IF NOT public.is_valid_metrics_report_snapshot_v1(
    p_period_start,
    v_result
  ) THEN
    RAISE EXCEPTION 'invalid_metrics_report_snapshot_generated'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_result;
END;
$$;

CREATE FUNCTION public.build_metrics_report_snapshot_v1(
  p_config_id uuid,
  p_period_start date
) RETURNS TABLE(report_id uuid, outcome text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  v_config public.metrics_report_configs%ROWTYPE;
  v_existing_report_id uuid;
  v_report_id uuid;
  v_payload jsonb;
  v_recipient_count integer;
  v_selected_count integer;
BEGIN
  IF p_config_id IS NULL THEN
    RAISE EXCEPTION 'metrics_report_config_id_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_period_start IS NULL
     OR NOT isfinite(p_period_start)
     OR p_period_start <>
       date_trunc('month', p_period_start::timestamp)::date THEN
    RAISE EXCEPTION 'invalid_metrics_report_period'
      USING ERRCODE = '22023';
  END IF;

  IF p_period_start >= date_trunc(
    'month',
    transaction_timestamp() AT TIME ZONE 'UTC'
  )::date THEN
    RAISE EXCEPTION 'metrics_report_period_not_complete'
      USING ERRCODE = '22023';
  END IF;

  SELECT config.*
  INTO v_config
  FROM public.metrics_report_configs AS config
  WHERE config.id = p_config_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'metrics_report_config_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT report.id
  INTO v_existing_report_id
  FROM public.metrics_reports AS report
  WHERE report.config_id = v_config.id
    AND report.period_start = p_period_start;

  IF v_existing_report_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_report_id, 'existing'::text;
    RETURN;
  END IF;

  IF p_period_start < v_config.reporting_starts_on THEN
    RETURN QUERY SELECT NULL::uuid, 'not_due'::text;
    RETURN;
  END IF;

  IF NOT v_config.enabled THEN
    RAISE EXCEPTION 'metrics_report_config_disabled'
      USING ERRCODE = '55000';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_recipient_count
  FROM public.metrics_report_recipients AS recipient
  WHERE recipient.config_id = v_config.id
    AND recipient.enabled;

  IF v_recipient_count = 0 THEN
    RAISE EXCEPTION 'enabled_metrics_report_requires_recipient'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_selected_count
  FROM public.metrics_report_selected_businesses AS selected
  WHERE selected.config_id = v_config.id;

  IF (v_config.selection_mode = 'all' AND v_selected_count <> 0)
     OR (
       v_config.selection_mode = 'selected'
       AND v_selected_count = 0
     ) THEN
    RAISE EXCEPTION 'invalid_metrics_report_selection_shape'
      USING ERRCODE = '22023';
  END IF;

  v_payload := public.preview_metrics_report_payload_v1(
    v_config.id,
    p_period_start
  );

  INSERT INTO public.metrics_reports (
    config_id,
    period_start,
    snapshot_version,
    snapshot_payload,
    status
  ) VALUES (
    v_config.id,
    p_period_start,
    1,
    v_payload,
    'pending'
  )
  ON CONFLICT (config_id, period_start) DO NOTHING
  RETURNING id INTO v_report_id;

  IF v_report_id IS NULL THEN
    SELECT report.id
    INTO v_existing_report_id
    FROM public.metrics_reports AS report
    WHERE report.config_id = v_config.id
      AND report.period_start = p_period_start;

    RETURN QUERY SELECT v_existing_report_id, 'existing'::text;
    RETURN;
  END IF;

  INSERT INTO public.metrics_report_deliveries (
    report_id,
    recipient,
    status,
    attempt_count,
    retry_after
  )
  SELECT
    v_report_id,
    recipient.email,
    'pending',
    0,
    clock_timestamp()
  FROM public.metrics_report_recipients AS recipient
  WHERE recipient.config_id = v_config.id
    AND recipient.enabled
  ORDER BY recipient.email;

  GET DIAGNOSTICS v_recipient_count = ROW_COUNT;
  IF v_recipient_count = 0 THEN
    RAISE EXCEPTION 'metrics_report_requires_delivery'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY SELECT v_report_id, 'created'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_metrics_report_payload_v1(uuid, date)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.build_metrics_report_snapshot_v1(uuid, date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_metrics_report_payload_v1(uuid, date)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.build_metrics_report_snapshot_v1(uuid, date)
  TO service_role;

-- Atomic claim: the optimistic attempt is charged before work begins and a
-- fixed fifteen-minute token lease fences every later transition.
CREATE FUNCTION public.claim_metrics_report_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_now timestamptz DEFAULT clock_timestamp()
) RETURNS TABLE(
  delivery_id uuid,
  report_id uuid,
  recipient text,
  snapshot_version integer,
  snapshot_payload jsonb,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_delivery_id IS NULL
     OR p_claim_token IS NULL
     OR p_now IS NULL
     OR NOT isfinite(p_now) THEN
    RAISE EXCEPTION 'delivery id, claim token, and time are required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    UPDATE public.metrics_report_deliveries AS delivery
    SET
      status = 'claimed',
      attempt_count = delivery.attempt_count + 1,
      retry_after = NULL,
      claim_token = p_claim_token,
      claimed_at = p_now,
      lease_expires_at = p_now + interval '15 minutes',
      provider_request_started_at = NULL,
      provider_message_id = NULL,
      accepted_at = NULL,
      last_error_code = NULL
    WHERE delivery.id = p_delivery_id
      AND delivery.status = 'pending'
      AND delivery.attempt_count < 3
      AND delivery.retry_after <= p_now
    RETURNING
      delivery.id,
      delivery.report_id,
      delivery.recipient,
      delivery.attempt_count
  )
  SELECT
    claimed.id,
    claimed.report_id,
    claimed.recipient,
    report.snapshot_version,
    report.snapshot_payload,
    claimed.attempt_count
  FROM claimed
  JOIN public.metrics_reports AS report
    ON report.id = claimed.report_id;
END;
$$;

CREATE FUNCTION public.mark_metrics_report_delivery_sending_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_now timestamptz DEFAULT clock_timestamp()
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_id uuid;
BEGIN
  IF p_delivery_id IS NULL
     OR p_claim_token IS NULL
     OR p_now IS NULL
     OR NOT isfinite(p_now) THEN
    RAISE EXCEPTION 'delivery id, claim token, and time are required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.metrics_report_deliveries AS delivery
  SET
    status = 'sending',
    provider_request_started_at = GREATEST(p_now, delivery.claimed_at)
  WHERE delivery.id = p_delivery_id
    AND delivery.status = 'claimed'
    AND delivery.claim_token = p_claim_token
    AND delivery.lease_expires_at > p_now
  RETURNING delivery.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

CREATE FUNCTION public.complete_metrics_report_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_provider_message_id text,
  p_accepted_at timestamptz DEFAULT clock_timestamp()
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_id uuid;
BEGIN
  IF p_delivery_id IS NULL
     OR p_claim_token IS NULL
     OR p_accepted_at IS NULL
     OR NOT isfinite(p_accepted_at)
     OR p_provider_message_id IS NULL
     OR p_provider_message_id <> btrim(p_provider_message_id)
     OR char_length(p_provider_message_id) NOT BETWEEN 1 AND 255
     OR p_provider_message_id ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_metrics_report_delivery_completion'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.metrics_report_deliveries AS delivery
  SET
    status = 'accepted',
    retry_after = NULL,
    claim_token = NULL,
    claimed_at = NULL,
    lease_expires_at = NULL,
    provider_request_started_at = NULL,
    provider_message_id = p_provider_message_id,
    accepted_at = p_accepted_at,
    last_error_code = NULL
  WHERE delivery.id = p_delivery_id
    AND delivery.status = 'sending'
    AND delivery.claim_token = p_claim_token
    AND p_accepted_at >= delivery.provider_request_started_at
  RETURNING delivery.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

CREATE FUNCTION public.release_metrics_report_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_now timestamptz DEFAULT clock_timestamp()
) RETURNS TABLE(
  delivery_status text,
  next_retry_at timestamptz,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_delivery_id IS NULL
     OR p_claim_token IS NULL
     OR p_now IS NULL
     OR NOT isfinite(p_now)
     OR p_error_code IS NULL
     OR p_error_code !~ '^[a-z0-9]+(_[a-z0-9]+)*$'
     OR char_length(p_error_code) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'invalid_metrics_report_delivery_release'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.metrics_report_deliveries AS delivery
  SET
    status = CASE
      WHEN delivery.attempt_count >= 3 THEN 'failed'
      ELSE 'pending'
    END,
    retry_after = CASE
      WHEN delivery.attempt_count >= 3 THEN NULL
      ELSE (
        date_trunc('day', p_now AT TIME ZONE 'UTC')
          + interval '1 day'
      ) AT TIME ZONE 'UTC'
    END,
    claim_token = NULL,
    claimed_at = NULL,
    lease_expires_at = NULL,
    provider_request_started_at = NULL,
    provider_message_id = NULL,
    accepted_at = NULL,
    last_error_code = p_error_code
  WHERE delivery.id = p_delivery_id
    AND delivery.status IN ('claimed', 'sending')
    AND delivery.claim_token = p_claim_token
  RETURNING
    delivery.status,
    delivery.retry_after,
    delivery.attempt_count;
END;
$$;

CREATE FUNCTION public.mark_metrics_report_delivery_needs_review_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_error_code text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_id uuid;
BEGIN
  IF p_delivery_id IS NULL
     OR p_claim_token IS NULL
     OR p_error_code IS NULL
     OR p_error_code !~ '^[a-z0-9]+(_[a-z0-9]+)*$'
     OR char_length(p_error_code) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'invalid_metrics_report_delivery_review'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.metrics_report_deliveries AS delivery
  SET
    status = 'needs_review',
    retry_after = NULL,
    claim_token = NULL,
    claimed_at = NULL,
    lease_expires_at = NULL,
    provider_request_started_at = NULL,
    provider_message_id = NULL,
    accepted_at = NULL,
    last_error_code = p_error_code
  WHERE delivery.id = p_delivery_id
    AND delivery.status IN ('claimed', 'sending')
    AND delivery.claim_token = p_claim_token
  RETURNING delivery.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

-- Lease expiry has asymmetric meaning. Before provider start it proves no
-- send and refunds the optimistic attempt. After provider start the provider
-- outcome is ambiguous, so the row is fenced in needs_review and never retried.
CREATE FUNCTION public.reconcile_expired_metrics_report_delivery_leases_v1(
  p_limit integer DEFAULT 100,
  p_now timestamptz DEFAULT clock_timestamp()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_delivery record;
  v_reclaimed integer := 0;
  v_needs_review integer := 0;
  v_remaining integer := 0;
BEGIN
  IF p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 500
     OR p_now IS NULL
     OR NOT isfinite(p_now) THEN
    RAISE EXCEPTION 'invalid_metrics_report_reconcile_limit'
      USING ERRCODE = '22023';
  END IF;

  FOR v_delivery IN
    SELECT delivery.id, delivery.status
    FROM public.metrics_report_deliveries AS delivery
    WHERE delivery.status IN ('claimed', 'sending')
      AND delivery.lease_expires_at <= p_now
    ORDER BY delivery.lease_expires_at, delivery.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    IF v_delivery.status = 'claimed' THEN
      UPDATE public.metrics_report_deliveries AS delivery
      SET
        status = 'pending',
        attempt_count = GREATEST(delivery.attempt_count - 1, 0),
        retry_after = p_now,
        claim_token = NULL,
        claimed_at = NULL,
        lease_expires_at = NULL,
        provider_request_started_at = NULL,
        provider_message_id = NULL,
        accepted_at = NULL,
        last_error_code = 'lease_expired_before_provider'
      WHERE delivery.id = v_delivery.id
        AND delivery.status = 'claimed';
      v_reclaimed := v_reclaimed + 1;
    ELSE
      UPDATE public.metrics_report_deliveries AS delivery
      SET
        status = 'needs_review',
        retry_after = NULL,
        claim_token = NULL,
        claimed_at = NULL,
        lease_expires_at = NULL,
        provider_request_started_at = NULL,
        provider_message_id = NULL,
        accepted_at = NULL,
        last_error_code = 'provider_outcome_unknown'
      WHERE delivery.id = v_delivery.id
        AND delivery.status = 'sending';
      v_needs_review := v_needs_review + 1;
    END IF;
  END LOOP;

  SELECT COUNT(*)::integer
  INTO v_remaining
  FROM public.metrics_report_deliveries AS delivery
  WHERE delivery.status IN ('claimed', 'sending')
    AND delivery.lease_expires_at <= p_now;

  RETURN jsonb_build_object(
    'reclaimed', v_reclaimed,
    'needs_review', v_needs_review,
    'remaining', v_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_metrics_report_delivery_v1(
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_metrics_report_delivery_sending_v1(
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_metrics_report_delivery_v1(
  uuid, uuid, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_metrics_report_delivery_v1(
  uuid, uuid, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_metrics_report_delivery_needs_review_v1(
  uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.reconcile_expired_metrics_report_delivery_leases_v1(
    integer, timestamptz
  ) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_metrics_report_delivery_v1(
  uuid, uuid, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_metrics_report_delivery_sending_v1(
  uuid, uuid, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_metrics_report_delivery_v1(
  uuid, uuid, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_metrics_report_delivery_v1(
  uuid, uuid, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_metrics_report_delivery_needs_review_v1(
  uuid, uuid, text
) TO service_role;
GRANT EXECUTE ON FUNCTION
  public.reconcile_expired_metrics_report_delivery_leases_v1(
    integer, timestamptz
  ) TO service_role;

COMMENT ON TABLE public.metrics_report_configs IS
  'Service-role-only current monthly report configuration; edits apply only when a future snapshot is generated.';
COMMENT ON TABLE public.metrics_report_recipients IS
  'Editable canonical admin/partner-staff recipients for future report snapshots.';
COMMENT ON TABLE public.metrics_report_selected_businesses IS
  'Current selected-business membership for future snapshots; event counts still intersect event-time brand attribution.';
COMMENT ON TABLE public.metrics_reports IS
  'Immutable count-only monthly snapshots with a delivery-derived status rollup.';
COMMENT ON TABLE public.metrics_report_deliveries IS
  'Frozen recipient delivery ledger. accepted means provider acceptance, not delivered or opened.';
COMMENT ON COLUMN public.metrics_report_deliveries.provider_request_started_at IS
  'Crossing this boundary makes lease expiry ambiguous; expired sending work becomes needs_review and is never automatically retried.';

COMMENT ON FUNCTION public.list_admin_monthly_business_metrics_v2(
  date, text, uuid, uuid
) IS
  'Service-role-only v1-compatible UTC metrics aggregate with optional business filtering and stable business options.';
COMMENT ON FUNCTION public.preview_metrics_report_payload_v1(uuid, date) IS
  'Read-only single source for strict count-only report snapshot payloads; intentionally ignores enabled and reporting-start scheduling gates.';
COMMENT ON FUNCTION public.build_metrics_report_snapshot_v1(uuid, date) IS
  'Idempotently freezes one enabled config report and its enabled recipients in the caller transaction.';
COMMENT ON FUNCTION public.release_metrics_report_delivery_v1(
  uuid, uuid, text, timestamptz
) IS
  'Token-owned release for proven no-send outcomes only. Sending is accepted solely for a definite provider rejection; timeout or unknown outcomes must use needs_review.';
COMMENT ON FUNCTION public.complete_metrics_report_delivery_v1(
  uuid, uuid, text, timestamptz
) IS
  'Records provider acceptance with a nonblank provider message id; this does not claim delivery or open tracking.';

COMMIT;
