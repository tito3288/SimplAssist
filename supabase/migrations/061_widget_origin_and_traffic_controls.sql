BEGIN;

-- Phase 3: public widget origin authorization and shared abuse controls.
--
-- The browser-facing routes perform the same checks before reaching these
-- functions. The database layer remains authoritative for shared rate and
-- concurrency decisions across application instances.

CREATE FUNCTION public.is_valid_widget_hostname(p_hostname text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_label text;
BEGIN
  IF p_hostname = ''
     OR char_length(p_hostname) > 253
     OR p_hostname <> lower(p_hostname)
     OR p_hostname <> btrim(p_hostname)
     OR right(p_hostname, 1) = '.'
     OR p_hostname ~ '[^a-z0-9.-]' THEN
    RETURN false;
  END IF;

  FOREACH v_label IN ARRAY string_to_array(p_hostname, '.') LOOP
    IF v_label = ''
       OR char_length(v_label) > 63
       OR v_label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

CREATE FUNCTION public.is_valid_widget_hostname_allowlist(p_hostnames text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT cardinality(p_hostnames) <= 10
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_hostnames) AS hostname(value)
      WHERE NOT public.is_valid_widget_hostname(hostname.value)
    )
    AND cardinality(p_hostnames) = (
      SELECT count(DISTINCT hostname.value)::integer
      FROM unnest(p_hostnames) AS hostname(value)
    );
$$;

CREATE FUNCTION public.widget_hostname_from_website_url(p_website_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value text := btrim(p_website_url);
  v_host text;
  v_port text;
  v_colon integer;
BEGIN
  IF v_value = ''
     OR char_length(v_value) > 2048
     OR v_value ~ '[[:space:][:cntrl:]]'
     OR v_value LIKE '%,%'
     OR v_value LIKE '%@%'
     OR v_value LIKE '%[%'
     OR v_value LIKE '%]%' THEN
    RETURN NULL;
  END IF;

  IF v_value ~* '^https?://' THEN
    v_value := regexp_replace(v_value, '^https?://', '', 'i');
  ELSIF v_value ~ '^[a-zA-Z][a-zA-Z0-9+.-]*://' THEN
    RETURN NULL;
  END IF;

  v_host := split_part(split_part(split_part(v_value, '/', 1), '?', 1), '#', 1);
  IF v_host = '' OR v_host LIKE '%@%' THEN
    RETURN NULL;
  END IF;

  v_colon := strpos(v_host, ':');
  IF v_colon > 0 THEN
    IF v_colon <> length(v_host) - strpos(reverse(v_host), ':') + 1 THEN
      RETURN NULL;
    END IF;
    v_port := substring(v_host FROM v_colon + 1);
    v_host := substring(v_host FROM 1 FOR v_colon - 1);
    IF v_port !~ '^[0-9]+$'
       OR v_port::numeric < 1
       OR v_port::numeric > 65535 THEN
      RETURN NULL;
    END IF;
  END IF;

  IF right(v_host, 1) = '.' THEN
    v_host := left(v_host, -1);
  END IF;
  v_host := lower(v_host);

  IF NOT public.is_valid_widget_hostname(v_host) THEN
    RETURN NULL;
  END IF;
  RETURN v_host;
EXCEPTION
  WHEN numeric_value_out_of_range THEN
    RETURN NULL;
END;
$$;

ALTER TABLE public.widget_configs
  ADD COLUMN allowed_hostnames text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD CONSTRAINT widget_configs_allowed_hostnames_valid CHECK (
    public.is_valid_widget_hostname_allowlist(allowed_hostnames)
  );

-- Preserve every currently identifiable install without ever widening an
-- allowlist. The preflight below aborts rather than silently deactivate any
-- active row whose website URL cannot supply a canonical hostname.
UPDATE public.widget_configs AS widget
SET allowed_hostnames = ARRAY[
  public.widget_hostname_from_website_url(business.website_url)
]
FROM public.businesses AS business
WHERE business.id = widget.business_id
  AND public.widget_hostname_from_website_url(business.website_url) IS NOT NULL;

DO $require_active_widget_hostname$
DECLARE
  v_missing_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_missing_count
  FROM public.widget_configs AS widget
  WHERE widget.is_active
    AND cardinality(widget.allowed_hostnames) = 0;

  IF v_missing_count > 0 THEN
    RAISE EXCEPTION 'active_widget_hostname_allowlist_required'
      USING
        ERRCODE = '23514',
        DETAIL = format(
          '%s active widget configuration(s) have no canonical website hostname.',
          v_missing_count
        ),
        HINT = 'Deactivate those widgets or set a valid businesses.website_url before retrying this migration.';
  END IF;
END;
$require_active_widget_hostname$;

ALTER TABLE public.widget_configs
  ADD CONSTRAINT widget_configs_active_requires_allowed_hostname CHECK (
    NOT is_active OR cardinality(allowed_hostnames) > 0
  );

COMMENT ON COLUMN public.widget_configs.allowed_hostnames IS
  'Exact canonical embed hostnames. Empty always denies public widget access; wildcards, schemes, paths, and ports are invalid.';

CREATE TABLE public.widget_offline_lead_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL
    REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL
    REFERENCES public.conversations(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL UNIQUE
    REFERENCES public.messages(id) ON DELETE CASCADE,
  client_lead_id uuid NOT NULL,
  submission_fingerprint text NOT NULL CHECK (
    submission_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, client_lead_id)
);

COMMENT ON TABLE public.widget_offline_lead_submissions IS
  'Content-free proof that an offline widget lead was durably linked to its already-persisted customer message.';

ALTER TABLE public.widget_offline_lead_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.widget_offline_lead_submissions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.widget_offline_lead_submissions TO service_role;

CREATE FUNCTION public.record_widget_offline_lead(
  p_business_id uuid,
  p_session_id text,
  p_client_lead_id uuid,
  p_source_provider_event_id text,
  p_source_message_fingerprint text,
  p_submission_fingerprint text,
  p_contact_name text,
  p_contact_email text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_source_message_id uuid;
  v_conversation_id uuid;
  v_contact_id uuid;
  v_contact public.contacts%ROWTYPE;
  v_existing public.widget_offline_lead_submissions%ROWTYPE;
  v_submission_id uuid;
  v_plan text;
BEGIN
  IF p_business_id IS NULL
     OR p_session_id IS NULL
     OR char_length(p_session_id) < 8
     OR char_length(p_session_id) > 128
     OR p_session_id !~ '^[A-Za-z0-9_-]+$'
     OR p_client_lead_id IS NULL
     OR p_source_provider_event_id IS NULL
     OR p_source_provider_event_id !~ '^widget:[0-9a-f]{64}$'
     OR p_source_message_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_submission_fingerprint !~ '^[0-9a-f]{64}$'
     OR (
       p_contact_name IS NULL
       AND p_contact_email IS NULL
     )
     OR p_contact_name IS NOT NULL
        AND (
          p_contact_name <> btrim(p_contact_name)
          OR p_contact_name = ''
          OR char_length(p_contact_name) > 100
          OR p_contact_name ~ '[[:cntrl:]]'
        )
     OR p_contact_email IS NOT NULL
        AND (
          p_contact_email <> lower(btrim(p_contact_email))
          OR p_contact_email = ''
          OR char_length(p_contact_email) > 254
          OR p_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        ) THEN
    RAISE EXCEPTION 'invalid_widget_offline_lead'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'widget_offline_lead_business_unavailable'
      USING ERRCODE = '55000';
  END IF;

  -- Serialize with service controls and billing-authority transitions. A
  -- quota-exhausted account may still capture a lead, but a suspended,
  -- manually AI-paused, inactive-widget, or no-web-chat account may not.
  IF v_business.operations_suspended_at IS NOT NULL
     OR v_business.ai_replies_paused_at IS NOT NULL THEN
    RAISE EXCEPTION 'widget_offline_lead_business_unavailable'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
  FROM public.widget_configs AS widget
  WHERE widget.business_id = p_business_id
    AND widget.is_active
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'widget_offline_lead_business_unavailable'
      USING ERRCODE = '55000';
  END IF;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions AS subscription
  WHERE subscription.business_id = p_business_id;

  IF FOUND THEN
    IF v_subscription.status IS NULL
       OR v_subscription.status NOT IN ('active', 'past_due', 'trialing') THEN
      RAISE EXCEPTION 'widget_offline_lead_business_unavailable'
        USING ERRCODE = '55000';
    END IF;
    v_plan := v_subscription.plan;
  ELSIF v_business.billing_mode IN ('invoiced', 'comped')
        AND v_business.partner_plan IS NOT NULL THEN
    v_plan := v_business.partner_plan;
  ELSIF v_business.billing_mode = 'stripe'
        AND v_business.partner_plan IS NULL
        AND (
          v_business.billing_pilot
          OR v_business.billing_comped
          OR v_business.billing_exempt
        ) THEN
    v_plan := 'full';
  ELSE
    RAISE EXCEPTION 'widget_offline_lead_business_unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF v_plan NOT IN ('chat_only', 'sms_and_chat', 'full') THEN
    RAISE EXCEPTION 'widget_offline_lead_business_unavailable'
      USING ERRCODE = '55000';
  END IF;

  SELECT submission.*
  INTO v_existing
  FROM public.widget_offline_lead_submissions AS submission
  WHERE submission.business_id = p_business_id
    AND submission.client_lead_id = p_client_lead_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.submission_fingerprint <> p_submission_fingerprint THEN
      RAISE EXCEPTION 'widget_offline_lead_idempotency_conflict'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT
    source_message.id,
    conversation.id,
    contact.id
  INTO
    v_source_message_id,
    v_conversation_id,
    v_contact_id
  FROM public.messages AS source_message
  JOIN public.conversations AS conversation
    ON conversation.id = source_message.conversation_id
   AND conversation.business_id = source_message.business_id
   AND conversation.channel = source_message.channel
  JOIN public.contacts AS contact
    ON contact.id = conversation.contact_id
   AND contact.business_id = conversation.business_id
  WHERE source_message.business_id = p_business_id
    AND source_message.provider_event_id = p_source_provider_event_id
    AND source_message.role = 'customer'
    AND source_message.channel = 'web_chat'
    AND contact.session_id = p_session_id
    AND encode(
      extensions.digest(source_message.content, 'sha256'),
      'hex'
    ) = p_source_message_fingerprint
  FOR UPDATE OF contact;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'widget_offline_lead_source_unavailable'
      USING ERRCODE = '55000';
  END IF;

  SELECT contact.*
  INTO STRICT v_contact
  FROM public.contacts AS contact
  WHERE contact.id = v_contact_id
    AND contact.business_id = p_business_id;

  SELECT submission.*
  INTO v_existing
  FROM public.widget_offline_lead_submissions AS submission
  WHERE submission.source_message_id = v_source_message_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.submission_fingerprint <> p_submission_fingerprint THEN
      RAISE EXCEPTION 'widget_offline_lead_idempotency_conflict'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  IF p_contact_email IS NOT NULL
     AND v_contact.email IS NOT NULL
     AND lower(btrim(v_contact.email)) <> p_contact_email THEN
    RAISE EXCEPTION 'widget_offline_lead_contact_conflict'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.contacts
  SET name = COALESCE(name, p_contact_name),
      email = COALESCE(email, p_contact_email),
      last_contacted_at = statement_timestamp()
  WHERE id = v_contact.id
    AND business_id = p_business_id;

  INSERT INTO public.widget_offline_lead_submissions (
    business_id,
    contact_id,
    conversation_id,
    source_message_id,
    client_lead_id,
    submission_fingerprint
  ) VALUES (
    p_business_id,
    v_contact.id,
    v_conversation_id,
    v_source_message_id,
    p_client_lead_id,
    p_submission_fingerprint
  )
  RETURNING id INTO v_submission_id;

  RETURN v_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_widget_offline_lead(
  uuid, text, uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_widget_offline_lead(
  uuid, text, uuid, text, text, text, text, text
) TO service_role;

-- A business-independent ingress tier runs before token verification or any
-- widget/business lookup. Only opaque server-derived network keys are stored;
-- callers cannot evade it by rotating arbitrary business UUIDs.
CREATE TABLE public.widget_ingress_rate_buckets (
  endpoint text NOT NULL CHECK (
    endpoint IN ('config', 'chat', 'end', 'lead')
  ),
  scope text NOT NULL CHECK (scope IN ('network', 'global')),
  scope_key_hash text NOT NULL CHECK (
    scope_key_hash ~ '^[0-9a-f]{64}$'
  ),
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (endpoint, scope, scope_key_hash, window_start)
);

CREATE INDEX idx_widget_ingress_rate_buckets_window
  ON public.widget_ingress_rate_buckets (window_start);

COMMENT ON TABLE public.widget_ingress_rate_buckets IS
  'Content-free, business-independent widget ingress counters. Network scope keys are hashes of server HMACs; raw addresses are never stored.';

ALTER TABLE public.widget_ingress_rate_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.widget_ingress_rate_buckets
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.widget_ingress_rate_buckets TO service_role;

CREATE FUNCTION public.acquire_widget_ingress_capacity(
  p_endpoint text,
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
  v_network_limit integer;
  v_global_limit integer;
  v_scope text;
  v_scope_hash text;
  v_limit integer;
  v_count integer;
BEGIN
  IF p_endpoint IS NULL
     OR p_endpoint NOT IN ('config', 'chat', 'end', 'lead')
     OR p_network_key IS NULL
     OR p_network_key !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'invalid_widget_ingress_request'
      USING ERRCODE = '22023';
  END IF;

  v_network_limit := CASE p_endpoint
    WHEN 'config' THEN 120
    WHEN 'chat' THEN 60
    WHEN 'end' THEN 30
    WHEN 'lead' THEN 20
  END;
  v_global_limit := CASE p_endpoint
    WHEN 'config' THEN 10000
    WHEN 'chat' THEN 3000
    WHEN 'end' THEN 3000
    WHEN 'lead' THEN 1000
  END;
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

  -- The table retains only a small operational window. The indexed cleanup is
  -- independent of any business record and keeps rotating network keys from
  -- accumulating durable state.
  DELETE FROM public.widget_ingress_rate_buckets AS bucket
  WHERE bucket.window_start < v_minute - interval '10 minutes';

  -- UPSERT row locks make each scope decision atomic across app instances.
  -- Denied attempts remain counted within the minute.
  FOR v_scope, v_scope_hash, v_limit IN
    SELECT rate.scope, rate.scope_hash, rate.request_limit
    FROM (
      VALUES
        ('network'::text, v_network_hash, v_network_limit),
        ('global'::text, v_global_hash, v_global_limit)
    ) AS rate(scope, scope_hash, request_limit)
  LOOP
    INSERT INTO public.widget_ingress_rate_buckets (
      endpoint,
      scope,
      scope_key_hash,
      window_start,
      request_count
    ) VALUES (
      p_endpoint,
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
          ceil(extract(epoch FROM (v_minute + interval '1 minute' - v_now)))
            ::integer
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('status', 'allowed');
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_widget_ingress_capacity(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acquire_widget_ingress_capacity(text, text)
  TO service_role;

CREATE TABLE public.widget_request_rate_buckets (
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (
    endpoint IN (
      'config',
      'chat',
      'end',
      'lead',
      'preview_chat',
      'preview_end'
    )
  ),
  scope text NOT NULL CHECK (
    scope IN (
      'network',
      'session',
      'origin',
      'business',
      'network_day',
      'session_day',
      'business_day'
    )
  ),
  scope_key_hash text NOT NULL CHECK (
    scope_key_hash ~ '^[0-9a-f]{64}$'
  ),
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, endpoint, scope, scope_key_hash, window_start)
);

CREATE INDEX idx_widget_request_rate_buckets_window
  ON public.widget_request_rate_buckets (window_start);

CREATE TABLE public.widget_request_capacity_leases (
  lease_token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  origin_hostname text NOT NULL CHECK (
    public.is_valid_widget_hostname(origin_hostname)
  ),
  session_key_hash text NOT NULL CHECK (
    session_key_hash ~ '^[0-9a-f]{64}$'
  ),
  request_key text NOT NULL CHECK (
    request_key ~ '^[A-Za-z0-9_-]{43}$'
  ),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  CHECK (expires_at > acquired_at),
  UNIQUE (business_id, request_key)
);

CREATE INDEX idx_widget_request_capacity_leases_active_business
  ON public.widget_request_capacity_leases (business_id, expires_at)
  WHERE released_at IS NULL;
CREATE INDEX idx_widget_request_capacity_leases_active_session
  ON public.widget_request_capacity_leases (
    business_id,
    session_key_hash,
    expires_at
  ) WHERE released_at IS NULL;

ALTER TABLE public.widget_request_rate_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.widget_request_capacity_leases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.widget_request_rate_buckets
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.widget_request_capacity_leases
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.widget_request_rate_buckets TO service_role;
GRANT SELECT ON TABLE public.widget_request_capacity_leases TO service_role;

CREATE FUNCTION public.acquire_widget_request_capacity(
  p_business_id uuid,
  p_origin_hostname text,
  p_session_id text,
  p_endpoint text,
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
  v_active_session integer;
  v_active_business integer;
  v_retry_after integer;
  v_lease_token uuid;
  v_effective_plan text;
  v_business public.businesses%ROWTYPE;
  v_widget public.widget_configs%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_existing public.widget_request_capacity_leases%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_origin_hostname IS NULL
     OR NOT public.is_valid_widget_hostname(p_origin_hostname)
     OR p_session_id IS NULL
     OR char_length(p_session_id) < 8
     OR char_length(p_session_id) > 128
     OR p_session_id !~ '^[A-Za-z0-9_-]+$'
     OR p_endpoint IS NULL
     OR p_endpoint NOT IN (
       'config',
       'chat',
       'end',
       'lead',
       'preview_chat',
       'preview_end'
     )
     OR p_network_key IS NULL
     OR p_network_key !~ '^[A-Za-z0-9_-]{43}$'
     OR p_request_key IS NULL
     OR p_request_key !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'invalid_widget_capacity_request'
      USING ERRCODE = '22023';
  END IF;

  -- This row lock makes every counter and lease decision for one business
  -- atomic across application instances.
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'widget_capacity_business_unavailable'
      USING ERRCODE = '55000';
  END IF;

  SELECT widget.*
  INTO v_widget
  FROM public.widget_configs AS widget
  WHERE widget.business_id = p_business_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'origin_not_allowed');
  END IF;

  IF p_endpoint NOT IN ('preview_chat', 'preview_end') THEN
    IF v_widget.allowed_hostnames IS NULL
       OR v_widget.is_active IS NULL
       OR NOT public.is_valid_widget_hostname_allowlist(
      v_widget.allowed_hostnames
    ) THEN
      RAISE EXCEPTION 'widget_capacity_config_unavailable'
        USING ERRCODE = '55000';
    END IF;
    IF NOT p_origin_hostname = ANY(v_widget.allowed_hostnames) THEN
      RETURN jsonb_build_object('status', 'origin_not_allowed');
    END IF;
    IF p_endpoint <> 'config' AND NOT v_widget.is_active THEN
      RETURN jsonb_build_object('status', 'widget_inactive');
    END IF;
  END IF;

  -- The low product-level daily limits protect the finite Chat Only
  -- allowance. Resolve billing authority under the same business lock and
  -- precedence as runtime entitlements: subscription, partner billing, then
  -- a valid direct Stripe override. Inactive subscription authority blocks
  -- fallback but is not live Chat Only traffic.
  IF p_endpoint = 'chat' THEN
    SELECT subscription.*
    INTO v_subscription
    FROM public.subscriptions AS subscription
    WHERE subscription.business_id = p_business_id;

    IF FOUND THEN
      IF v_subscription.plan IS NULL
         OR v_subscription.plan NOT IN (
           'sms_only', 'sms_and_chat', 'full', 'chat_only'
         )
         OR v_subscription.status IS NULL THEN
        RAISE EXCEPTION 'widget_capacity_billing_unavailable'
          USING ERRCODE = '55000';
      END IF;
      IF v_subscription.status IN ('active', 'past_due', 'trialing') THEN
        v_effective_plan := v_subscription.plan;
      END IF;
    ELSIF v_business.billing_mode IN ('invoiced', 'comped') THEN
      IF v_business.partner_plan IS NULL
         OR v_business.partner_plan NOT IN (
           'sms_only', 'sms_and_chat', 'full', 'chat_only'
         ) THEN
        RAISE EXCEPTION 'widget_capacity_billing_unavailable'
          USING ERRCODE = '55000';
      END IF;
      v_effective_plan := v_business.partner_plan;
    ELSIF v_business.billing_mode = 'stripe' THEN
      IF v_business.partner_plan IS NOT NULL
         OR v_business.billing_pilot IS NULL
         OR v_business.billing_comped IS NULL
         OR v_business.billing_exempt IS NULL THEN
        RAISE EXCEPTION 'widget_capacity_billing_unavailable'
          USING ERRCODE = '55000';
      END IF;
      IF v_business.billing_pilot
         OR v_business.billing_comped
         OR v_business.billing_exempt THEN
        v_effective_plan := 'full';
      END IF;
    ELSE
      RAISE EXCEPTION 'widget_capacity_billing_unavailable'
        USING ERRCODE = '55000';
    END IF;
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
  DELETE FROM public.widget_request_capacity_leases AS lease
  WHERE lease.business_id = p_business_id
    AND COALESCE(lease.released_at, lease.expires_at) < v_day - interval '1 day';

  -- Each entry is incremented under the same business lock. Denied attempts
  -- remain counted so a caller cannot hover at the boundary by retrying.
  FOR v_scope, v_scope_hash, v_limit IN
    SELECT rate.scope, rate.scope_hash, rate.request_limit
    FROM (
      VALUES
        ('network'::text, v_network_hash,
          CASE p_endpoint
            WHEN 'chat' THEN 30
            WHEN 'preview_chat' THEN 12
            WHEN 'config' THEN 90
            WHEN 'lead' THEN 10
            WHEN 'preview_end' THEN 12
            ELSE 30
          END),
        ('session'::text, v_session_hash,
          CASE p_endpoint
            WHEN 'chat' THEN 12
            WHEN 'preview_chat' THEN 6
            WHEN 'config' THEN 60
            WHEN 'lead' THEN 5
            WHEN 'preview_end' THEN 8
            ELSE 20
          END),
        ('origin'::text, v_origin_hash,
          CASE p_endpoint
            WHEN 'chat' THEN 60
            WHEN 'preview_chat' THEN 20
            WHEN 'config' THEN 180
            WHEN 'lead' THEN 20
            WHEN 'preview_end' THEN 20
            ELSE 60
          END),
        ('business'::text, v_business_hash,
          CASE p_endpoint
            WHEN 'chat' THEN 120
            WHEN 'preview_chat' THEN 30
            WHEN 'config' THEN 300
            WHEN 'lead' THEN 30
            WHEN 'preview_end' THEN 40
            ELSE 120
          END)
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
      p_endpoint,
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
          ceil(extract(epoch FROM (v_minute + interval '1 minute' - v_now)))
            ::integer
        )
      );
    END IF;
  END LOOP;

  IF p_endpoint = 'preview_chat'
     OR (p_endpoint = 'chat' AND v_effective_plan = 'chat_only') THEN
    -- A finite live allowance (or deliberately smaller preview budget) gets
    -- daily visitor limits so one session or network cannot dominate it.
    -- Growth/Full retain the minute, concurrency, and business emergency
    -- controls below without inheriting Chat Only's 30/60 product cap.
    FOR v_scope, v_scope_hash, v_limit IN
      SELECT daily.scope, daily.scope_hash, daily.request_limit
      FROM (
        VALUES
          ('network_day'::text, v_network_hash,
            CASE p_endpoint WHEN 'chat' THEN 60 ELSE 30 END),
          ('session_day'::text, v_session_hash,
            CASE p_endpoint WHEN 'chat' THEN 30 ELSE 15 END)
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
        p_endpoint,
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
              ceil(extract(epoch FROM (v_day + interval '1 day' - v_now)))
                ::integer
            )
          )
        );
      END IF;
    END LOOP;
  END IF;

  IF p_endpoint IN ('chat', 'preview_chat') THEN
    INSERT INTO public.widget_request_rate_buckets (
      business_id,
      endpoint,
      scope,
      scope_key_hash,
      window_start,
      request_count
    ) VALUES (
      p_business_id,
      p_endpoint,
      'business_day',
      v_business_hash,
      v_day,
      1
    )
    ON CONFLICT (business_id, endpoint, scope, scope_key_hash, window_start)
    DO UPDATE SET
      request_count = public.widget_request_rate_buckets.request_count + 1,
      updated_at = v_now
    RETURNING request_count INTO v_count;

    IF v_count > (CASE
        WHEN p_endpoint = 'preview_chat' THEN 200
        WHEN v_effective_plan = 'chat_only' THEN 120
        ELSE 2500
      END) THEN
      RETURN jsonb_build_object(
        'status', 'rate_limited',
        'retry_after_seconds', LEAST(
          3600,
          GREATEST(
            1,
            ceil(extract(epoch FROM (v_day + interval '1 day' - v_now)))
              ::integer
          )
        )
      );
    END IF;

    SELECT lease.*
    INTO v_existing
    FROM public.widget_request_capacity_leases AS lease
    WHERE lease.business_id = p_business_id
      AND lease.request_key = p_request_key
    FOR UPDATE;

    IF FOUND
       AND v_existing.released_at IS NULL
       AND v_existing.expires_at > v_now THEN
      RETURN jsonb_build_object(
        'status', 'concurrency_limited',
        'retry_after_seconds', LEAST(
          300,
          GREATEST(
            1,
            ceil(extract(epoch FROM (v_existing.expires_at - v_now)))::integer
          )
        )
      );
    END IF;

    SELECT
      count(*) FILTER (
        WHERE lease.session_key_hash = v_session_hash
      )::integer,
      count(*)::integer,
      COALESCE(
        ceil(extract(epoch FROM (min(lease.expires_at) - v_now)))::integer,
        2
      )
    INTO v_active_session, v_active_business, v_retry_after
    FROM public.widget_request_capacity_leases AS lease
    WHERE lease.business_id = p_business_id
      AND lease.released_at IS NULL
      AND lease.expires_at > v_now;

    IF v_active_session >= 1 OR v_active_business >= 8 THEN
      RETURN jsonb_build_object(
        'status', 'concurrency_limited',
        'retry_after_seconds', LEAST(300, GREATEST(1, v_retry_after))
      );
    END IF;

    v_lease_token := gen_random_uuid();
    INSERT INTO public.widget_request_capacity_leases (
      lease_token,
      business_id,
      origin_hostname,
      session_key_hash,
      request_key,
      acquired_at,
      expires_at,
      released_at
    ) VALUES (
      v_lease_token,
      p_business_id,
      p_origin_hostname,
      v_session_hash,
      p_request_key,
      v_now,
      v_now + interval '5 minutes',
      NULL
    )
    ON CONFLICT (business_id, request_key) DO UPDATE
    SET lease_token = EXCLUDED.lease_token,
        origin_hostname = EXCLUDED.origin_hostname,
        session_key_hash = EXCLUDED.session_key_hash,
        acquired_at = EXCLUDED.acquired_at,
        expires_at = EXCLUDED.expires_at,
        released_at = NULL
    RETURNING lease_token INTO v_lease_token;

    RETURN jsonb_build_object(
      'status', 'allowed',
      'lease_token', v_lease_token
    );
  END IF;

  RETURN jsonb_build_object('status', 'allowed', 'lease_token', NULL);
END;
$$;

CREATE FUNCTION public.release_widget_request_capacity(p_lease_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_lease_token IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.widget_request_capacity_leases
  SET released_at = COALESCE(released_at, statement_timestamp())
  WHERE lease_token = p_lease_token;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_widget_request_capacity(
  uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_widget_request_capacity(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acquire_widget_request_capacity(
  uuid, text, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_widget_request_capacity(uuid)
  TO service_role;

COMMIT;
