BEGIN;

-- Privacy-safe, content-free widget funnel telemetry. Browser session IDs are
-- HMACed in the application before this database boundary; no raw visitor
-- identifier, message, contact data, URL, or network address is accepted.
CREATE TABLE public.widget_engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  session_key_hash text NOT NULL CHECK (
    session_key_hash ~ '^[0-9a-f]{64}$'
  ),
  event_type text NOT NULL CHECK (
    event_type IN (
      'widget_loaded',
      'invitation_shown',
      'invitation_dismissed',
      'widget_engaged',
      'first_message_submitted'
    )
  ),
  source text NOT NULL CHECK (
    source IN (
      'widget_load',
      'manual',
      'proactive_timer',
      'proactive_scroll'
    )
  ),
  device_bucket text NOT NULL CHECK (
    device_bucket IN ('mobile', 'desktop')
  ),
  prompt_version integer NOT NULL CHECK (
    prompt_version BETWEEN 1 AND 1000
  ),
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT widget_engagement_events_source_contract CHECK (
    (event_type = 'widget_loaded' AND source = 'widget_load')
    OR
    (
      event_type IN ('invitation_shown', 'invitation_dismissed')
      AND source IN ('proactive_timer', 'proactive_scroll')
    )
    OR
    (
      event_type IN ('widget_engaged', 'first_message_submitted')
      AND source IN ('manual', 'proactive_timer', 'proactive_scroll')
    )
  ),
  CONSTRAINT widget_engagement_events_session_event_unique UNIQUE (
    business_id,
    session_key_hash,
    event_type,
    prompt_version
  )
);

CREATE INDEX idx_widget_engagement_events_business_occurred
  ON public.widget_engagement_events (
    business_id,
    occurred_at DESC,
    event_type
  );
CREATE INDEX idx_widget_engagement_events_retention
  ON public.widget_engagement_events (occurred_at, id);

COMMENT ON TABLE public.widget_engagement_events IS
  'Content-free proactive-widget funnel events. Session identity is a server-side keyed HMAC; rows contain no message, contact, URL, or network data, become purge-eligible after 90 days, and are removed by the next daily cleanup run.';
COMMENT ON COLUMN public.widget_engagement_events.session_key_hash IS
  'Lowercase SHA-256 HMAC produced server-side from the business and widget session using a domain-separated secret context.';

ALTER TABLE public.widget_engagement_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.widget_engagement_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.widget_engagement_events TO service_role;

CREATE FUNCTION public.record_widget_engagement_event(
  p_business_id uuid,
  p_session_key_hash text,
  p_event_type text,
  p_source text,
  p_device_bucket text,
  p_prompt_version integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted boolean;
BEGIN
  IF p_business_id IS NULL
     OR p_session_key_hash IS NULL
     OR p_session_key_hash !~ '^[0-9a-f]{64}$'
     OR p_event_type IS NULL
     OR p_event_type NOT IN (
       'widget_loaded',
       'invitation_shown',
       'invitation_dismissed',
       'widget_engaged',
       'first_message_submitted'
     )
     OR p_source IS NULL
     OR p_source NOT IN (
       'widget_load',
       'manual',
       'proactive_timer',
       'proactive_scroll'
     )
     OR p_device_bucket IS NULL
     OR p_device_bucket NOT IN ('mobile', 'desktop')
     OR p_prompt_version IS NULL
     OR p_prompt_version NOT BETWEEN 1 AND 1000
     OR (
       p_event_type IN ('invitation_shown', 'invitation_dismissed')
       AND p_source = 'manual'
     )
     OR (
       p_event_type = 'widget_loaded'
       AND p_source <> 'widget_load'
     )
     OR (
       p_event_type <> 'widget_loaded'
       AND p_source = 'widget_load'
     ) THEN
    RAISE EXCEPTION 'invalid_widget_engagement_event'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'widget_engagement_business_unavailable'
      USING ERRCODE = '55000';
  END IF;

  WITH inserted AS (
    INSERT INTO public.widget_engagement_events (
      business_id,
      session_key_hash,
      event_type,
      source,
      device_bucket,
      prompt_version,
      occurred_at
    ) VALUES (
      p_business_id,
      p_session_key_hash,
      p_event_type,
      p_source,
      p_device_bucket,
      p_prompt_version,
      statement_timestamp()
    )
    ON CONFLICT (
      business_id,
      session_key_hash,
      event_type,
      prompt_version
    ) DO NOTHING
    RETURNING true
  )
  SELECT COALESCE(bool_or(true), false)
  INTO v_inserted
  FROM inserted;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.record_widget_engagement_event(
  uuid, text, text, text, text, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_widget_engagement_event(
  uuid, text, text, text, text, integer
) TO service_role;

-- Telemetry gets independent ingress capacity while retaining the same
-- business-independent, opaque-network protection used by other public widget
-- endpoints.
ALTER TABLE public.widget_ingress_rate_buckets
  DROP CONSTRAINT widget_ingress_rate_buckets_endpoint_check,
  ADD CONSTRAINT widget_ingress_rate_buckets_endpoint_check CHECK (
    endpoint IN ('config', 'chat', 'end', 'lead', 'telemetry')
  );

CREATE FUNCTION public.acquire_widget_telemetry_ingress_capacity(
  p_network_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_network_hash text;
  v_global_hash text;
  v_scope text;
  v_scope_hash text;
  v_limit integer;
  v_count integer;
BEGIN
  IF p_network_key IS NULL
     OR p_network_key !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'invalid_widget_telemetry_ingress_request'
      USING ERRCODE = '22023';
  END IF;

  v_network_hash := encode(
    extensions.digest(
      'widget-ingress:network:v1:' || p_network_key,
      'sha256'
    ),
    'hex'
  );
  v_global_hash := encode(
    extensions.digest('widget-ingress:global:v1', 'sha256'),
    'hex'
  );

  DELETE FROM public.widget_ingress_rate_buckets AS bucket
  WHERE bucket.window_start < v_minute - interval '10 minutes';

  FOR v_scope, v_scope_hash, v_limit IN
    SELECT rate.scope, rate.scope_hash, rate.request_limit
    FROM (
      VALUES
        ('network'::text, v_network_hash, 240),
        ('global'::text, v_global_hash, 20000)
    ) AS rate(scope, scope_hash, request_limit)
  LOOP
    INSERT INTO public.widget_ingress_rate_buckets (
      endpoint,
      scope,
      scope_key_hash,
      window_start,
      request_count
    ) VALUES (
      'telemetry',
      v_scope,
      v_scope_hash,
      v_minute,
      1
    )
    ON CONFLICT (endpoint, scope, scope_key_hash, window_start)
    DO UPDATE SET
      request_count = public.widget_ingress_rate_buckets.request_count + 1,
      updated_at = v_now
    RETURNING request_count INTO v_count;

    IF v_count > v_limit THEN
      RETURN jsonb_build_object(
        'status', 'rate_limited',
        'retry_after_seconds', GREATEST(
          1,
          ceil(extract(epoch FROM (
            v_minute + interval '1 minute' - v_now
          )))::integer
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('status', 'allowed');
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_widget_telemetry_ingress_capacity(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acquire_widget_telemetry_ingress_capacity(text)
  TO service_role;

-- Shared origin/session/network/business telemetry limits use the existing
-- widget rate-bucket table but never create a concurrency lease.
ALTER TABLE public.widget_request_rate_buckets
  DROP CONSTRAINT widget_request_rate_buckets_endpoint_check,
  ADD CONSTRAINT widget_request_rate_buckets_endpoint_check CHECK (
    endpoint IN (
      'config',
      'chat',
      'end',
      'lead',
      'telemetry',
      'preview_chat',
      'preview_end'
    )
  );

CREATE FUNCTION public.acquire_widget_telemetry_capacity(
  p_business_id uuid,
  p_origin_hostname text,
  p_session_id text,
  p_network_key text,
  p_request_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_day timestamptz := date_trunc('day', v_now AT TIME ZONE 'UTC')
    AT TIME ZONE 'UTC';
  v_session_hash text;
  v_origin_hash text;
  v_business_hash text;
  v_network_hash text;
  v_scope text;
  v_scope_hash text;
  v_limit integer;
  v_count integer;
  v_widget public.widget_configs%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_origin_hostname IS NULL
     OR NOT public.is_valid_widget_hostname(p_origin_hostname)
     OR p_session_id IS NULL
     OR char_length(p_session_id) < 8
     OR char_length(p_session_id) > 128
     OR p_session_id !~ '^[A-Za-z0-9_-]+$'
     OR p_network_key IS NULL
     OR p_network_key !~ '^[A-Za-z0-9_-]{43}$'
     OR p_request_key IS NULL
     OR p_request_key !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'invalid_widget_telemetry_capacity_request'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'widget_telemetry_business_unavailable'
      USING ERRCODE = '55000';
  END IF;

  SELECT widget.*
  INTO v_widget
  FROM public.widget_configs AS widget
  WHERE widget.business_id = p_business_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'origin_not_allowed');
  END IF;
  IF v_widget.allowed_hostnames IS NULL
     OR v_widget.is_active IS NULL
     OR NOT public.is_valid_widget_hostname_allowlist(
       v_widget.allowed_hostnames
     ) THEN
    RAISE EXCEPTION 'widget_telemetry_config_unavailable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT p_origin_hostname = ANY(v_widget.allowed_hostnames) THEN
    RETURN jsonb_build_object('status', 'origin_not_allowed');
  END IF;
  IF NOT v_widget.is_active THEN
    RETURN jsonb_build_object('status', 'widget_inactive');
  END IF;

  v_session_hash := encode(
    extensions.digest(
      p_business_id::text || ':session:' || p_session_id,
      'sha256'
    ),
    'hex'
  );
  v_origin_hash := encode(
    extensions.digest(
      p_business_id::text || ':origin:' || p_origin_hostname,
      'sha256'
    ),
    'hex'
  );
  v_business_hash := encode(
    extensions.digest(p_business_id::text, 'sha256'),
    'hex'
  );
  v_network_hash := encode(
    extensions.digest(
      p_business_id::text || ':network:' || p_network_key,
      'sha256'
    ),
    'hex'
  );

  DELETE FROM public.widget_request_rate_buckets AS bucket
  WHERE bucket.business_id = p_business_id
    AND bucket.window_start < v_day - interval '1 day';

  FOR v_scope, v_scope_hash, v_limit IN
    SELECT rate.scope, rate.scope_hash, rate.request_limit
    FROM (
      VALUES
        ('network'::text, v_network_hash, 120),
        ('session'::text, v_session_hash, 12),
        ('origin'::text, v_origin_hash, 500),
        ('business'::text, v_business_hash, 1000)
    ) AS rate(scope, scope_hash, request_limit)
  LOOP
    INSERT INTO public.widget_request_rate_buckets (
      business_id,
      endpoint,
      scope,
      scope_key_hash,
      window_start,
      request_count
    ) VALUES (
      p_business_id,
      'telemetry',
      v_scope,
      v_scope_hash,
      v_minute,
      1
    )
    ON CONFLICT (business_id, endpoint, scope, scope_key_hash, window_start)
    DO UPDATE SET
      request_count = public.widget_request_rate_buckets.request_count + 1,
      updated_at = v_now
    RETURNING request_count INTO v_count;

    IF v_count > v_limit THEN
      RETURN jsonb_build_object(
        'status', 'rate_limited',
        'retry_after_seconds', GREATEST(
          1,
          ceil(extract(epoch FROM (
            v_minute + interval '1 minute' - v_now
          )))::integer
        )
      );
    END IF;
  END LOOP;

  FOR v_scope, v_scope_hash, v_limit IN
    SELECT daily.scope, daily.scope_hash, daily.request_limit
    FROM (
      VALUES
        ('network_day'::text, v_network_hash, 1000),
        ('session_day'::text, v_session_hash, 12),
        ('business_day'::text, v_business_hash, 25000)
    ) AS daily(scope, scope_hash, request_limit)
  LOOP
    INSERT INTO public.widget_request_rate_buckets (
      business_id,
      endpoint,
      scope,
      scope_key_hash,
      window_start,
      request_count
    ) VALUES (
      p_business_id,
      'telemetry',
      v_scope,
      v_scope_hash,
      v_day,
      1
    )
    ON CONFLICT (business_id, endpoint, scope, scope_key_hash, window_start)
    DO UPDATE SET
      request_count = public.widget_request_rate_buckets.request_count + 1,
      updated_at = v_now
    RETURNING request_count INTO v_count;

    IF v_count > v_limit THEN
      RETURN jsonb_build_object(
        'status', 'rate_limited',
        'retry_after_seconds', LEAST(
          3600,
          GREATEST(
            1,
            ceil(extract(epoch FROM (
              v_day + interval '1 day' - v_now
            )))::integer
          )
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('status', 'allowed', 'lease_token', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_widget_telemetry_capacity(
  uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acquire_widget_telemetry_capacity(
  uuid, text, text, text, text
) TO service_role;

-- Rows become purge-eligible after 90 days and are removed by the next daily
-- 03:20 UTC run (so actual lifetime can approach 91 days). A dedicated job
-- prevents telemetry lock/failure state from coupling to webhook-idempotency
-- cleanup or AI reservation reaping.
CREATE FUNCTION public.purge_widget_engagement_events()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  DELETE FROM public.widget_engagement_events AS event
  WHERE event.occurred_at < statement_timestamp() - interval '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_widget_engagement_events()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_widget_engagement_events()
  TO service_role;

SELECT cron.schedule(
  'cleanup_widget_engagement_events',
  '20 3 * * *',
  $$SELECT public.purge_widget_engagement_events()$$
);

COMMIT;
