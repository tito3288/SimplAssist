BEGIN;

-- Durable, review-first website knowledge pipeline. Public scan rows contain
-- only owner-safe metadata and drafts. Scraped Markdown is isolated in a
-- service-role-only table and is deliberately short lived.

CREATE TABLE public.website_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  purpose text NOT NULL CHECK (purpose IN ('onboarding', 'manual_rescan')),
  source_url text NOT NULL,
  idempotency_key uuid NOT NULL,
  retry_idempotency_key uuid,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'discovering', 'crawling', 'extracting',
    'ready_for_review', 'published', 'failed', 'cancelled', 'discarded', 'superseded'
  )),
  coverage text CHECK (coverage IN ('complete', 'partial', 'insufficient')),
  progress_stage text NOT NULL DEFAULT 'queued' CHECK (progress_stage IN (
    'queued', 'discovering', 'crawling', 'extracting', 'review', 'done'
  )),
  pages_discovered integer NOT NULL DEFAULT 0 CHECK (pages_discovered BETWEEN 0 AND 1000),
  pages_succeeded integer NOT NULL DEFAULT 0 CHECK (pages_succeeded BETWEEN 0 AND 1000),
  pages_completed integer NOT NULL DEFAULT 0 CHECK (pages_completed BETWEEN 0 AND 1000),
  pages_failed integer NOT NULL DEFAULT 0 CHECK (pages_failed BETWEEN 0 AND 1000),
  credits_used integer NOT NULL DEFAULT 0 CHECK (credits_used BETWEEN 0 AND 1000000),
  provider_job_id text CHECK (provider_job_id IS NULL OR char_length(provider_job_id) BETWEEN 1 AND 500),
  provider_job_attempt integer NOT NULL DEFAULT 0 CHECK (provider_job_attempt BETWEEN 0 AND 3),
  profile_prefill jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(profile_prefill) = 'object' AND pg_column_size(profile_prefill) <= 65536
  ),
  review_draft jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(review_draft) = 'object' AND pg_column_size(review_draft) <= 524288
  ),
  review_revision integer NOT NULL DEFAULT 0 CHECK (review_revision >= 0),
  published_idempotency_key uuid,
  published_review_hash text CHECK (published_review_hash IS NULL OR published_review_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  worker_id text,
  claim_token uuid,
  claim_generation integer NOT NULL DEFAULT 0 CHECK (claim_generation >= 0),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancel_requested_at timestamptz,
  error_code text CHECK (error_code IS NULL OR (
    error_code ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(error_code)<=64
  )),
  error_message text CHECK (error_message IS NULL OR char_length(error_message) <= 500),
  started_at timestamptz,
  draft_completed_at timestamptz,
  published_at timestamptz,
  failed_at timestamptz,
  discarded_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, business_id),
  UNIQUE (business_id, idempotency_key),
  CONSTRAINT website_scan_runs_url_valid CHECK (
    char_length(source_url) BETWEEN 9 AND 2048
    AND source_url = btrim(source_url)
    AND source_url ~ '^https://'
    AND source_url !~ '[[:cntrl:]]'
  ),
  CONSTRAINT website_scan_runs_claim_shape CHECK (
    (claim_token IS NULL AND worker_id IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL)
    OR (claim_token IS NOT NULL AND worker_id IS NOT NULL AND claimed_at IS NOT NULL
        AND claim_expires_at IS NOT NULL AND claim_expires_at > claimed_at)
  ),
  CONSTRAINT website_scan_runs_terminal_shape CHECK (
    (status = 'published' AND published_at IS NOT NULL AND published_idempotency_key IS NOT NULL)
    OR (status = 'failed' AND failed_at IS NOT NULL AND error_code IS NOT NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
    OR (status = 'discarded' AND discarded_at IS NOT NULL)
    OR status NOT IN ('published', 'failed', 'cancelled', 'discarded')
  )
);

CREATE UNIQUE INDEX website_scan_runs_one_open_per_business
  ON public.website_scan_runs (business_id)
  WHERE status IN ('queued', 'discovering', 'crawling', 'extracting', 'ready_for_review');
CREATE INDEX website_scan_runs_worker_queue
  ON public.website_scan_runs (available_at, created_at, id)
  WHERE status IN ('queued', 'discovering', 'crawling', 'extracting');
CREATE INDEX website_scan_runs_business_created
  ON public.website_scan_runs (business_id, created_at DESC);
CREATE UNIQUE INDEX website_scan_runs_retry_idempotency
  ON public.website_scan_runs (business_id,retry_idempotency_key)
  WHERE retry_idempotency_key IS NOT NULL;

CREATE TABLE public.website_scan_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL,
  business_id uuid NOT NULL,
  page_index integer NOT NULL CHECK (page_index BETWEEN 0 AND 999),
  normalized_url text NOT NULL,
  title text,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'skipped')),
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  character_count integer NOT NULL DEFAULT 0 CHECK (character_count BETWEEN 0 AND 25000),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, business_id),
  UNIQUE (scan_id, page_index),
  UNIQUE (scan_id, normalized_url),
  FOREIGN KEY (scan_id, business_id)
    REFERENCES public.website_scan_runs(id, business_id) ON DELETE CASCADE,
  CHECK (char_length(normalized_url) BETWEEN 9 AND 2048 AND normalized_url ~ '^https://'),
  CHECK (
    (status='succeeded' AND content_hash IS NOT NULL AND character_count>0 AND error_code IS NULL)
    OR (status='failed' AND content_hash IS NULL AND character_count=0 AND error_code IS NOT NULL)
    OR (status='skipped' AND content_hash IS NULL AND character_count=0)
  )
);

CREATE TABLE public.website_scan_page_payloads (
  page_id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  markdown text NOT NULL CHECK (char_length(markdown) BETWEEN 1 AND 25000),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (page_id, business_id)
    REFERENCES public.website_scan_pages(id, business_id) ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE TABLE public.website_scan_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL,
  business_id uuid NOT NULL,
  client_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('service', 'faq', 'overview', 'fact', 'policy')),
  category text CHECK (category IS NULL OR char_length(category) BETWEEN 1 AND 100),
  dedupe_key text NOT NULL,
  draft_payload jsonb NOT NULL CHECK (
    jsonb_typeof(draft_payload) = 'object' AND pg_column_size(draft_payload)<=16384
  ),
  change_type text NOT NULL DEFAULT 'new' CHECK (change_type IN ('new', 'changed', 'unchanged', 'missing')),
  target_id uuid,
  baseline_hash text CHECK (baseline_hash IS NULL OR baseline_hash ~ '^[0-9a-f]{64}$'),
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'accepted', 'rejected', 'keep_current')),
  owner_payload jsonb CHECK (owner_payload IS NULL OR jsonb_typeof(owner_payload) = 'object'),
  owner_edited boolean NOT NULL DEFAULT false,
  published_target_id uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, business_id),
  UNIQUE (scan_id, client_key),
  UNIQUE (scan_id, kind, dedupe_key),
  FOREIGN KEY (scan_id, business_id)
    REFERENCES public.website_scan_runs(id, business_id) ON DELETE CASCADE,
  CHECK (client_key ~ '^[a-zA-Z0-9_-]{1,80}$'),
  CHECK (char_length(dedupe_key) BETWEEN 1 AND 500)
);

CREATE TABLE public.website_scan_suggestion_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id uuid NOT NULL,
  page_id uuid NOT NULL,
  business_id uuid NOT NULL,
  source_url text NOT NULL,
  excerpt text NOT NULL CHECK (char_length(excerpt) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (suggestion_id, page_id, excerpt),
  FOREIGN KEY (suggestion_id, business_id)
    REFERENCES public.website_scan_suggestions(id, business_id) ON DELETE CASCADE,
  FOREIGN KEY (page_id, business_id)
    REFERENCES public.website_scan_pages(id, business_id) ON DELETE CASCADE,
  CHECK (char_length(source_url) BETWEEN 9 AND 2048 AND source_url ~ '^https://')
);

CREATE TABLE public.website_scan_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL,
  business_id uuid NOT NULL,
  question_key text NOT NULL,
  category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 100),
  question text NOT NULL CHECK (char_length(btrim(question)) BETWEEN 3 AND 500),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  output_kind text NOT NULL CHECK (output_kind IN ('fact', 'policy', 'faq')),
  output_title text CHECK (output_title IS NULL OR char_length(btrim(output_title)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'unanswered' CHECK (status IN ('unanswered', 'answered', 'skipped', 'not_applicable')),
  answer text CHECK (answer IS NULL OR char_length(btrim(answer)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, business_id),
  UNIQUE (scan_id, question_key),
  FOREIGN KEY (scan_id, business_id)
    REFERENCES public.website_scan_runs(id, business_id) ON DELETE CASCADE,
  CHECK ((status = 'answered') = (answer IS NOT NULL))
);

CREATE TABLE public.business_knowledge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('overview', 'fact', 'policy')),
  category text,
  title text,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'website_scan', 'owner_answer')),
  origin_suggestion_id uuid,
  source_url text,
  source_excerpt text,
  owner_edited boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, business_id),
  FOREIGN KEY (origin_suggestion_id)
    REFERENCES public.website_scan_suggestions(id) ON DELETE SET NULL,
  CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 200),
  CHECK (source_url IS NULL OR (char_length(source_url) BETWEEN 9 AND 2048 AND source_url ~ '^https://')),
  CHECK (source_excerpt IS NULL OR char_length(source_excerpt) BETWEEN 1 AND 1000),
  CHECK (kind = 'overview' OR title IS NOT NULL)
);

CREATE UNIQUE INDEX business_knowledge_one_active_overview
  ON public.business_knowledge_items (business_id)
  WHERE kind = 'overview' AND is_active;
CREATE UNIQUE INDEX business_knowledge_active_dedupe
  ON public.business_knowledge_items (
    business_id, kind, public.normalize_ai_knowledge_key(coalesce(title, content))
  ) WHERE is_active;
CREATE INDEX business_knowledge_prompt_order
  ON public.business_knowledge_items (business_id, kind, sort_order, verified_at DESC, id)
  WHERE is_active;

CREATE FUNCTION public.guard_business_knowledge_scan_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.origin_suggestion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.website_scan_suggestions s
    WHERE s.id=NEW.origin_suggestion_id AND s.business_id=NEW.business_id
  ) THEN
    RAISE EXCEPTION 'business_knowledge_scan_tenant_mismatch' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_business_knowledge_scan_tenant
BEFORE INSERT OR UPDATE OF business_id,origin_suggestion_id ON public.business_knowledge_items
FOR EACH ROW EXECUTE FUNCTION public.guard_business_knowledge_scan_tenant();

-- Evidence was already validated by the worker. Repeat that trust boundary in
-- the database while tolerating harmless casing and rendered whitespace
-- differences introduced by Markdown cleanup.
CREATE FUNCTION public.normalize_website_scan_evidence(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public,pg_temp AS $$
 SELECT btrim(regexp_replace(lower(normalize(coalesce(p_value,''), NFKC)),
   '[[:space:]]+', ' ', 'g')) $$;

ALTER TABLE public.website_scan_suggestion_sources
  ADD CONSTRAINT website_scan_source_normalized_excerpt_valid
  CHECK (char_length(public.normalize_website_scan_evidence(excerpt)) BETWEEN 8 AND 1000);

-- Database enforcement mirrors the authoritative entitlement precedence used
-- by the server: any synchronized subscription wins, then partner billing,
-- then protected direct-Stripe overrides. chat_only, sms_and_chat, and full
-- explicitly grant AI customization; sms_only does not.
CREATE FUNCTION public.website_scan_has_ai_customization_entitlement(p_business_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN EXISTS(
        SELECT 1 FROM public.subscriptions subscription
        WHERE subscription.business_id=business.id
      ) THEN EXISTS(
        SELECT 1 FROM public.subscriptions subscription
        WHERE subscription.business_id=business.id
          AND subscription.status IN ('active','trialing','past_due')
          AND subscription.plan IN ('chat_only','sms_and_chat','full')
      )
      WHEN business.billing_mode IN ('invoiced','comped') THEN
        business.partner_plan IN ('chat_only','sms_and_chat','full')
      WHEN business.billing_mode='stripe' AND business.partner_plan IS NULL
        AND (business.billing_pilot OR business.billing_comped OR business.billing_exempt) THEN true
      ELSE false
    END
    FROM public.businesses business WHERE business.id=p_business_id
  ),false)
$$;

ALTER TABLE public.website_scan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_scan_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_scan_page_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_scan_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_scan_suggestion_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_scan_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_knowledge_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY website_scan_runs_owner_select ON public.website_scan_runs FOR SELECT
  TO authenticated USING (EXISTS (
    SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = auth.uid()
  ));
CREATE POLICY website_scan_pages_owner_select ON public.website_scan_pages FOR SELECT
  TO authenticated USING (EXISTS (
    SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = auth.uid()
  ));
CREATE POLICY website_scan_suggestions_owner_select ON public.website_scan_suggestions FOR SELECT
  TO authenticated USING (EXISTS (
    SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = auth.uid()
  ));
CREATE POLICY website_scan_sources_owner_select ON public.website_scan_suggestion_sources FOR SELECT
  TO authenticated USING (EXISTS (
    SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = auth.uid()
  ));
CREATE POLICY website_scan_questions_owner_select ON public.website_scan_questions FOR SELECT
  TO authenticated USING (EXISTS (
    SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = auth.uid()
  ));
CREATE POLICY business_knowledge_owner_select ON public.business_knowledge_items FOR SELECT
  TO authenticated USING (EXISTS (
    SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = auth.uid()
  ));

REVOKE ALL ON TABLE public.website_scan_runs, public.website_scan_pages,
  public.website_scan_page_payloads, public.website_scan_suggestions,
  public.website_scan_suggestion_sources, public.website_scan_questions,
  public.business_knowledge_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (
  id,business_id,requested_by,purpose,source_url,idempotency_key,retry_idempotency_key,status,coverage,
  progress_stage,pages_discovered,pages_succeeded,pages_completed,pages_failed,credits_used,
  profile_prefill,review_draft,review_revision,error_code,error_message,started_at,
  draft_completed_at,published_at,failed_at,discarded_at,cancelled_at,cancel_requested_at,
  created_at,updated_at
) ON public.website_scan_runs TO authenticated;
GRANT SELECT ON TABLE public.website_scan_runs, public.website_scan_pages,
  public.website_scan_suggestions, public.website_scan_suggestion_sources,
  public.website_scan_questions, public.business_knowledge_items TO service_role;
GRANT SELECT ON TABLE public.website_scan_pages,
  public.website_scan_suggestions, public.website_scan_suggestion_sources,
  public.website_scan_questions, public.business_knowledge_items TO authenticated;
GRANT SELECT ON TABLE public.website_scan_page_payloads TO service_role;

-- Owner starts are idempotent and rate limited. A ready review remains the one
-- open scan so a rescan can never silently replace unapproved work.
CREATE FUNCTION public.start_website_scan_v1(
  p_business_id uuid, p_source_url text, p_purpose text, p_idempotency_key uuid
) RETURNS public.website_scan_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.website_scan_runs; v_owner uuid := auth.uid();
  v_onboarding_completed_at timestamptz;
BEGIN
  IF v_owner IS NULL OR p_business_id IS NULL OR p_idempotency_key IS NULL
     OR p_purpose NOT IN ('onboarding', 'manual_rescan')
     OR p_source_url IS NULL OR btrim(p_source_url) !~ '^https://'
     OR char_length(btrim(p_source_url)) > 2048 THEN
    RAISE EXCEPTION 'invalid_website_scan_start' USING ERRCODE = '22023';
  END IF;
  SELECT b.onboarding_completed_at INTO v_onboarding_completed_at FROM public.businesses b
   WHERE b.id = p_business_id AND b.owner_id = v_owner AND b.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'website_scan_business_not_accessible' USING ERRCODE = '42501'; END IF;
  IF (p_purpose='onboarding' AND v_onboarding_completed_at IS NOT NULL)
     OR (p_purpose='manual_rescan' AND v_onboarding_completed_at IS NULL) THEN
    RAISE EXCEPTION 'website_scan_purpose_mismatch' USING ERRCODE='42501';
  END IF;
  IF p_purpose='manual_rescan'
     AND NOT public.website_scan_has_ai_customization_entitlement(p_business_id) THEN
    RAISE EXCEPTION 'website_scan_plan_required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM public.website_scan_runs
   WHERE business_id = p_business_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    v_row.claim_token:=NULL; v_row.worker_id:=NULL; v_row.claimed_at:=NULL;
    v_row.claim_expires_at:=NULL; v_row.heartbeat_at:=NULL; v_row.provider_job_id:=NULL;
    RETURN v_row;
  END IF;
  SELECT * INTO v_row FROM public.website_scan_runs
   WHERE business_id = p_business_id
     AND status IN ('queued','discovering','crawling','extracting','ready_for_review');
  IF FOUND THEN
    v_row.claim_token:=NULL; v_row.worker_id:=NULL; v_row.claimed_at:=NULL;
    v_row.claim_expires_at:=NULL; v_row.heartbeat_at:=NULL; v_row.provider_job_id:=NULL;
    RETURN v_row;
  END IF;
  IF (SELECT count(*) FROM public.website_scan_runs
      WHERE business_id = p_business_id AND created_at > clock_timestamp() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'website_scan_daily_limit' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.website_scan_runs (business_id, requested_by, purpose, source_url, idempotency_key)
  VALUES (p_business_id, v_owner, p_purpose, btrim(p_source_url), p_idempotency_key)
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE FUNCTION public.claim_next_website_scan_v1(
  p_worker_id text, p_lease_seconds integer DEFAULT 120
) RETURNS public.website_scan_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_token uuid := gen_random_uuid(); v_row public.website_scan_runs;
BEGIN
  IF p_worker_id IS NULL OR char_length(btrim(p_worker_id)) NOT BETWEEN 1 AND 100
     OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION 'invalid_website_scan_claim' USING ERRCODE = '22023';
  END IF;
  WITH exhausted AS (
    UPDATE public.website_scan_runs SET status='failed',progress_stage='done',coverage='insufficient',
      failed_at=clock_timestamp(),error_code='worker_attempts_exhausted',
      error_message='The scan could not finish after three attempts.',claim_token=NULL,worker_id=NULL,
      claimed_at=NULL,claim_expires_at=NULL,heartbeat_at=NULL,updated_at=clock_timestamp()
    WHERE status IN ('queued','discovering','crawling','extracting')
      AND attempt_count>=max_attempts AND claim_token IS NOT NULL AND claim_expires_at<=clock_timestamp()
    RETURNING id
  )
  DELETE FROM public.website_scan_page_payloads payload
  USING public.website_scan_pages page, exhausted
  WHERE payload.page_id=page.id AND page.scan_id=exhausted.id;
  SELECT r.id INTO v_id FROM public.website_scan_runs r
   WHERE r.status IN ('queued','discovering','crawling','extracting')
     AND r.attempt_count < r.max_attempts AND r.available_at <= clock_timestamp()
     AND (r.claim_token IS NULL OR r.claim_expires_at <= clock_timestamp())
   ORDER BY r.available_at, r.created_at, r.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.website_scan_runs SET
    claim_token=v_token, worker_id=btrim(p_worker_id), claimed_at=clock_timestamp(),
    claim_expires_at=clock_timestamp()+make_interval(secs => p_lease_seconds),
    heartbeat_at=clock_timestamp(), claim_generation=claim_generation+1, attempt_count=attempt_count+1,
    started_at=coalesce(started_at,clock_timestamp()), updated_at=clock_timestamp()
  WHERE id=v_id RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE FUNCTION public.heartbeat_website_scan_v1(
  p_scan_id uuid, p_claim_token uuid, p_claim_generation integer,
  p_lease_seconds integer DEFAULT 120
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_lease_seconds NOT BETWEEN 30 AND 300 THEN RAISE EXCEPTION 'invalid_website_scan_heartbeat'; END IF;
  UPDATE public.website_scan_runs SET heartbeat_at=clock_timestamp(),
    claim_expires_at=clock_timestamp()+make_interval(secs => p_lease_seconds), updated_at=clock_timestamp()
   WHERE id=p_scan_id AND claim_token=p_claim_token AND claim_generation=p_claim_generation
     AND claim_expires_at>clock_timestamp() AND cancel_requested_at IS NULL
     AND status IN ('queued','discovering','crawling','extracting') RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END $$;

CREATE FUNCTION public.update_website_scan_progress_v1(
  p_scan_id uuid, p_claim_token uuid, p_claim_generation integer, p_status text,
  p_provider_job_id text DEFAULT NULL, p_provider_job_attempt integer DEFAULT NULL,
  p_pages_discovered integer DEFAULT NULL, p_pages_completed integer DEFAULT NULL,
  p_pages_failed integer DEFAULT NULL, p_credits_used integer DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_status NOT IN ('discovering','crawling','extracting') THEN RAISE EXCEPTION 'invalid_website_scan_progress'; END IF;
  IF p_provider_job_attempt IS NOT NULL AND p_provider_job_attempt NOT BETWEEN 0 AND 3
     OR p_pages_discovered IS NOT NULL AND p_pages_discovered NOT BETWEEN 0 AND 1000
     OR p_pages_completed IS NOT NULL AND p_pages_completed NOT BETWEEN 0 AND 1000
     OR p_pages_failed IS NOT NULL AND p_pages_failed NOT BETWEEN 0 AND 1000
     OR p_credits_used IS NOT NULL AND p_credits_used NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION 'invalid_website_scan_progress_counts' USING ERRCODE='22023';
  END IF;
  UPDATE public.website_scan_runs SET status=p_status, progress_stage=p_status,
    provider_job_id=coalesce(p_provider_job_id,provider_job_id),
    provider_job_attempt=coalesce(p_provider_job_attempt,provider_job_attempt),
    pages_discovered=coalesce(p_pages_discovered,pages_discovered),
    pages_completed=coalesce(p_pages_completed,pages_completed),
    pages_failed=coalesce(p_pages_failed,pages_failed),
    credits_used=coalesce(p_credits_used,credits_used), updated_at=clock_timestamp()
   WHERE id=p_scan_id AND claim_token=p_claim_token AND claim_generation=p_claim_generation
     AND claim_expires_at>clock_timestamp() AND cancel_requested_at IS NULL
     AND (provider_job_id IS NULL OR p_provider_job_id IS NULL OR provider_job_id=p_provider_job_id
       OR coalesce(p_provider_job_attempt,provider_job_attempt)>provider_job_attempt)
   RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END $$;

CREATE FUNCTION public.save_website_scan_page_v1(
  p_scan_id uuid, p_claim_token uuid, p_claim_generation integer,
  p_page_index integer, p_normalized_url text, p_title text,
  p_markdown text, p_content_hash text, p_character_count integer,
  p_status text DEFAULT 'succeeded', p_error_code text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_business uuid; v_page uuid; v_hash text;
BEGIN
  SELECT business_id INTO v_business FROM public.website_scan_runs
   WHERE id=p_scan_id AND claim_token=p_claim_token AND claim_generation=p_claim_generation
     AND claim_expires_at>clock_timestamp() AND cancel_requested_at IS NULL
     AND status IN ('discovering','crawling','extracting') FOR UPDATE;
  IF v_business IS NULL THEN RAISE EXCEPTION 'website_scan_stale_claim' USING ERRCODE='55000'; END IF;
  IF p_status NOT IN ('succeeded','failed','skipped') OR p_page_index NOT BETWEEN 0 AND 999
     OR p_normalized_url IS NULL
     OR btrim(p_normalized_url) !~ '^https://' OR char_length(p_normalized_url)>2048
     OR (p_status='succeeded' AND (p_markdown IS NULL OR char_length(p_markdown) NOT BETWEEN 1 AND 25000
       OR p_character_count IS NULL OR p_character_count<>char_length(p_markdown) OR p_content_hash IS NULL))
     OR (p_status<>'succeeded' AND (p_markdown IS NOT NULL OR p_content_hash IS NOT NULL
       OR p_character_count IS NULL OR p_character_count<>0)) THEN
    RAISE EXCEPTION 'invalid_website_scan_page' USING ERRCODE='22023';
  END IF;
  v_hash := CASE WHEN p_markdown IS NULL THEN NULL ELSE encode(extensions.digest(p_markdown,'sha256'),'hex') END;
  IF v_hash IS DISTINCT FROM p_content_hash THEN
    RAISE EXCEPTION 'website_scan_page_hash_mismatch' USING ERRCODE='22023';
  END IF;
  -- A replacement worker can receive the same pages in a different order.
  -- The fenced claim owns this run, so remove only the stale URL occupying
  -- this provider position before upserting the canonical URL.
  DELETE FROM public.website_scan_pages
  WHERE scan_id=p_scan_id AND page_index=p_page_index
    AND normalized_url<>btrim(p_normalized_url);
  INSERT INTO public.website_scan_pages(scan_id,business_id,page_index,normalized_url,title,status,content_hash,character_count,error_code)
  VALUES(p_scan_id,v_business,p_page_index,btrim(p_normalized_url),nullif(btrim(p_title),''),p_status,v_hash,p_character_count,p_error_code)
  ON CONFLICT(scan_id,normalized_url) DO UPDATE SET page_index=excluded.page_index,
    title=excluded.title,status=excluded.status,
    content_hash=excluded.content_hash,character_count=excluded.character_count,error_code=excluded.error_code,
    updated_at=clock_timestamp()
  RETURNING id INTO v_page;
  DELETE FROM public.website_scan_page_payloads WHERE page_id=v_page;
  IF p_markdown IS NOT NULL THEN
    INSERT INTO public.website_scan_page_payloads(page_id,business_id,markdown)
    VALUES(v_page,v_business,p_markdown);
  END IF;
  UPDATE public.website_scan_runs r SET
    pages_succeeded=(SELECT count(*) FROM public.website_scan_pages p WHERE p.scan_id=r.id AND p.status='succeeded'),
    pages_failed=(SELECT count(*) FROM public.website_scan_pages p WHERE p.scan_id=r.id AND p.status='failed'),
    updated_at=clock_timestamp() WHERE r.id=p_scan_id;
  RETURN v_page;
END $$;

CREATE FUNCTION public.complete_website_scan_draft_v1(
  p_scan_id uuid, p_claim_token uuid, p_claim_generation integer,
  p_coverage text, p_draft jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_business uuid; v_item jsonb; v_source jsonb; v_question jsonb;
  v_suggestion_id uuid; v_page_id uuid; v_index integer := 0; v_overview jsonb;
BEGIN
  IF p_coverage NOT IN ('complete','partial','insufficient') OR jsonb_typeof(p_draft)<>'object'
     OR NOT p_draft ?& ARRAY['overview','profilePrefill','services','faqs','knowledge','questions','missing','scanMeta']
     OR p_draft - ARRAY['overview','profilePrefill','services','faqs','knowledge','questions','missing','scanMeta'] <> '{}'::jsonb
     OR jsonb_typeof(p_draft->'overview')<>'object'
     OR jsonb_typeof(p_draft->'profilePrefill')<>'object'
     OR jsonb_typeof(p_draft->'services')<>'array'
     OR jsonb_typeof(p_draft->'faqs')<>'array'
     OR jsonb_typeof(p_draft->'knowledge')<>'array'
     OR jsonb_typeof(p_draft->'questions')<>'array'
     OR jsonb_typeof(p_draft->'missing')<>'array'
     OR jsonb_typeof(p_draft->'scanMeta')<>'object'
     OR jsonb_array_length(p_draft->'services')>20
     OR jsonb_array_length(p_draft->'faqs')>20
     OR jsonb_array_length(p_draft->'knowledge')>12
     OR jsonb_array_length(p_draft->'questions')>5
     OR jsonb_array_length(p_draft->'missing')>100
     OR char_length(btrim(p_draft#>>'{overview,text}')) NOT BETWEEN 1 AND 1000
     OR coalesce(p_draft#>>'{overview,changeType}','new') NOT IN ('new','changed','unchanged')
     OR (
       coalesce(p_draft#>>'{overview,changeType}','new')='new'
       AND (p_draft#>>'{overview,targetId}' IS NOT NULL OR p_draft#>>'{overview,baselineHash}' IS NOT NULL)
     )
     OR (
       coalesce(p_draft#>>'{overview,changeType}','new') IN ('changed','unchanged')
       AND (p_draft#>>'{overview,targetId}' IS NULL OR p_draft#>>'{overview,baselineHash}' IS NULL)
     ) THEN
    RAISE EXCEPTION 'invalid_website_scan_draft' USING ERRCODE='22023';
  END IF;
  SELECT business_id INTO v_business FROM public.website_scan_runs
   WHERE id=p_scan_id AND claim_token=p_claim_token AND claim_generation=p_claim_generation
     AND claim_expires_at>clock_timestamp() AND cancel_requested_at IS NULL
     AND status IN ('discovering','crawling','extracting') FOR UPDATE;
  IF v_business IS NULL THEN RAISE EXCEPTION 'website_scan_stale_claim' USING ERRCODE='55000'; END IF;
  DELETE FROM public.website_scan_questions WHERE scan_id=p_scan_id;
  DELETE FROM public.website_scan_suggestions WHERE scan_id=p_scan_id;

  -- The worker's semantic draft is unpacked into queryable rows. client_key is
  -- database-generated and local to the immutable draft version.
  v_overview := p_draft->'overview';
  INSERT INTO public.website_scan_suggestions(
    scan_id,business_id,client_key,kind,category,dedupe_key,draft_payload,
    change_type,target_id,baseline_hash
  ) VALUES (p_scan_id,v_business,'overview-0','overview','business_overview','overview',
    jsonb_build_object('kind','overview','content',v_overview->>'text',
      'selected',coalesce((v_overview->>'selected')::boolean,true)),
    coalesce(v_overview->>'changeType','new'),nullif(v_overview->>'targetId','')::uuid,
    nullif(v_overview->>'baselineHash',''))
  RETURNING id INTO v_suggestion_id;
  FOR v_source IN SELECT value FROM jsonb_array_elements(v_overview->'sources') LOOP
    SELECT p.id INTO v_page_id FROM public.website_scan_pages p
      JOIN public.website_scan_page_payloads payload ON payload.page_id=p.id
     WHERE p.scan_id=p_scan_id AND p.business_id=v_business AND p.status='succeeded'
       AND p.normalized_url=v_source->>'url'
       AND strpos(public.normalize_website_scan_evidence(payload.markdown),
         public.normalize_website_scan_evidence(v_source->>'excerpt'))>0;
    IF v_page_id IS NULL THEN RAISE EXCEPTION 'invalid_website_scan_source' USING ERRCODE='22023'; END IF;
    INSERT INTO public.website_scan_suggestion_sources(suggestion_id,page_id,business_id,source_url,excerpt)
    VALUES(v_suggestion_id,v_page_id,v_business,v_source->>'url',v_source->>'excerpt');
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_draft->'services') LOOP
    v_index := v_index + 1;
    INSERT INTO public.website_scan_suggestions(
      scan_id,business_id,client_key,kind,category,dedupe_key,draft_payload,
      change_type,target_id,baseline_hash
    ) VALUES (
      p_scan_id,v_business,'service-'||v_index,'service','service',v_item->>'dedupeKey',
      v_item-'sources',coalesce(v_item->>'changeType','new'),
      nullif(v_item->>'targetId','')::uuid,nullif(v_item->>'baselineHash','')
    ) RETURNING id INTO v_suggestion_id;
    FOR v_source IN SELECT value FROM jsonb_array_elements(v_item->'sources') LOOP
      SELECT p.id INTO v_page_id FROM public.website_scan_pages p
        JOIN public.website_scan_page_payloads payload ON payload.page_id=p.id
       WHERE p.scan_id=p_scan_id AND p.business_id=v_business AND p.status='succeeded'
         AND p.normalized_url=v_source->>'url'
         AND strpos(public.normalize_website_scan_evidence(payload.markdown),
           public.normalize_website_scan_evidence(v_source->>'excerpt'))>0;
      IF v_page_id IS NULL THEN RAISE EXCEPTION 'invalid_website_scan_source' USING ERRCODE='22023'; END IF;
      INSERT INTO public.website_scan_suggestion_sources(suggestion_id,page_id,business_id,source_url,excerpt)
      VALUES(v_suggestion_id,v_page_id,v_business,v_source->>'url',v_source->>'excerpt');
    END LOOP;
  END LOOP;

  v_index := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_draft->'faqs') LOOP
    v_index := v_index + 1;
    INSERT INTO public.website_scan_suggestions(
      scan_id,business_id,client_key,kind,category,dedupe_key,draft_payload,change_type,target_id,baseline_hash
    ) VALUES (p_scan_id,v_business,'faq-'||v_index,'faq','faq',v_item->>'dedupeKey',
      v_item-'sources',coalesce(v_item->>'changeType','new'),
      nullif(v_item->>'targetId','')::uuid,nullif(v_item->>'baselineHash','')) RETURNING id INTO v_suggestion_id;
    FOR v_source IN SELECT value FROM jsonb_array_elements(v_item->'sources') LOOP
      SELECT p.id INTO v_page_id FROM public.website_scan_pages p
        JOIN public.website_scan_page_payloads payload ON payload.page_id=p.id
       WHERE p.scan_id=p_scan_id AND p.business_id=v_business AND p.status='succeeded'
         AND p.normalized_url=v_source->>'url'
         AND strpos(public.normalize_website_scan_evidence(payload.markdown),
           public.normalize_website_scan_evidence(v_source->>'excerpt'))>0;
      IF v_page_id IS NULL THEN RAISE EXCEPTION 'invalid_website_scan_source' USING ERRCODE='22023'; END IF;
      INSERT INTO public.website_scan_suggestion_sources(suggestion_id,page_id,business_id,source_url,excerpt)
      VALUES(v_suggestion_id,v_page_id,v_business,v_source->>'url',v_source->>'excerpt');
    END LOOP;
  END LOOP;

  v_index := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_draft->'knowledge') LOOP
    v_index := v_index + 1;
    INSERT INTO public.website_scan_suggestions(
      scan_id,business_id,client_key,kind,category,dedupe_key,draft_payload,change_type,target_id,baseline_hash
    ) VALUES (p_scan_id,v_business,'knowledge-'||v_index,v_item->>'kind',v_item->>'category',
      v_item->>'dedupeKey',v_item-'sources',coalesce(v_item->>'changeType','new'),
      nullif(v_item->>'targetId','')::uuid,nullif(v_item->>'baselineHash',''))
    RETURNING id INTO v_suggestion_id;
    FOR v_source IN SELECT value FROM jsonb_array_elements(v_item->'sources') LOOP
      SELECT p.id INTO v_page_id FROM public.website_scan_pages p
        JOIN public.website_scan_page_payloads payload ON payload.page_id=p.id
       WHERE p.scan_id=p_scan_id AND p.business_id=v_business AND p.status='succeeded'
         AND p.normalized_url=v_source->>'url'
         AND strpos(public.normalize_website_scan_evidence(payload.markdown),
           public.normalize_website_scan_evidence(v_source->>'excerpt'))>0;
      IF v_page_id IS NULL THEN RAISE EXCEPTION 'invalid_website_scan_source' USING ERRCODE='22023'; END IF;
      INSERT INTO public.website_scan_suggestion_sources(suggestion_id,page_id,business_id,source_url,excerpt)
      VALUES(v_suggestion_id,v_page_id,v_business,v_source->>'url',v_source->>'excerpt');
    END LOOP;
  END LOOP;

  v_index := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_draft->'missing') LOOP
    v_index := v_index + 1;
    INSERT INTO public.website_scan_suggestions(
      scan_id,business_id,client_key,kind,category,dedupe_key,draft_payload,
      change_type,target_id,baseline_hash
    ) VALUES (
      p_scan_id,v_business,'missing-'||v_index,
      CASE WHEN v_item->>'kind'='knowledge' THEN 'fact' ELSE v_item->>'kind' END,
      'missing',v_item->>'dedupeKey',v_item,'missing',
      nullif(v_item->>'targetId','')::uuid,nullif(v_item->>'baselineHash','')
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.website_scan_suggestions s WHERE s.scan_id=p_scan_id
      AND s.change_type<>'missing'
      AND NOT EXISTS (SELECT 1 FROM public.website_scan_suggestion_sources src WHERE src.suggestion_id=s.id)) THEN
    RAISE EXCEPTION 'website_scan_suggestion_without_source' USING ERRCODE='23514';
  END IF;
  FOR v_question IN SELECT value FROM jsonb_array_elements(p_draft->'questions') LOOP
    INSERT INTO public.website_scan_questions(
      scan_id,business_id,question_key,category,question,reason,output_kind,output_title
    ) VALUES (p_scan_id,v_business,v_question->>'questionKey',v_question->>'outputKind',
      v_question->>'prompt',v_question->>'reason',v_question->>'outputKind',
      nullif(btrim(v_question->>'outputTitle'),''));
  END LOOP;
  UPDATE public.website_scan_runs SET status='ready_for_review',progress_stage='review',coverage=p_coverage,
    profile_prefill=p_draft->'profilePrefill',review_draft=p_draft,review_revision=1,
    draft_completed_at=clock_timestamp(),claim_token=NULL,worker_id=NULL,claimed_at=NULL,
    claim_expires_at=NULL,heartbeat_at=NULL,updated_at=clock_timestamp()
   WHERE id=p_scan_id;
  -- Evidence rows are sufficient for owner review. Keeping full page content
  -- after successful drafting would add risk without improving the live brain.
  DELETE FROM public.website_scan_page_payloads payload USING public.website_scan_pages page
    WHERE payload.page_id=page.id AND page.scan_id=p_scan_id;
  RETURN true;
END $$;

CREATE FUNCTION public.fail_website_scan_v1(
  p_scan_id uuid, p_claim_token uuid, p_claim_generation integer,
  p_error_code text, p_error_message text,
  p_retryable boolean DEFAULT true
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_run public.website_scan_runs;
BEGIN
  SELECT * INTO v_run FROM public.website_scan_runs WHERE id=p_scan_id AND claim_token=p_claim_token
    AND claim_generation=p_claim_generation AND cancel_requested_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_error_code IS NULL OR p_error_code !~ '^[a-z0-9]+(_[a-z0-9]+)*$' OR char_length(p_error_message)>500 THEN
    RAISE EXCEPTION 'invalid_website_scan_failure' USING ERRCODE='22023'; END IF;
  IF p_retryable AND v_run.attempt_count < v_run.max_attempts THEN
    UPDATE public.website_scan_runs SET status='queued',progress_stage='queued',available_at=clock_timestamp()+
      make_interval(secs => least(300,30*(2^greatest(attempt_count-1,0)))::integer),error_code=p_error_code,
      error_message=p_error_message,claim_token=NULL,worker_id=NULL,claimed_at=NULL,claim_expires_at=NULL,
      heartbeat_at=NULL,updated_at=clock_timestamp() WHERE id=p_scan_id;
  ELSE
    UPDATE public.website_scan_runs SET status='failed',progress_stage='done',coverage='insufficient',
      error_code=p_error_code,error_message=p_error_message,failed_at=clock_timestamp(),
      claim_token=NULL,worker_id=NULL,claimed_at=NULL,claim_expires_at=NULL,heartbeat_at=NULL,
      updated_at=clock_timestamp() WHERE id=p_scan_id;
    DELETE FROM public.website_scan_page_payloads payload
    USING public.website_scan_pages page
    WHERE payload.page_id=page.id AND page.scan_id=p_scan_id;
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION public.save_website_scan_review_v1(
  p_scan_id uuid, p_expected_revision integer, p_review_draft jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid:=auth.uid(); v_revision integer; v_business uuid; v_purpose text;
BEGIN
  IF v_owner IS NULL OR p_expected_revision IS NULL OR jsonb_typeof(p_review_draft)<>'object'
     OR pg_column_size(p_review_draft)>262144 THEN RAISE EXCEPTION 'invalid_website_scan_review' USING ERRCODE='22023'; END IF;
  SELECT r.business_id,r.purpose INTO v_business,v_purpose
  FROM public.website_scan_runs r JOIN public.businesses b ON b.id=r.business_id
  WHERE r.id=p_scan_id AND b.owner_id=v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'website_scan_not_accessible' USING ERRCODE='42501'; END IF;
  IF v_purpose='manual_rescan'
     AND NOT public.website_scan_has_ai_customization_entitlement(v_business) THEN
    RAISE EXCEPTION 'website_scan_plan_required' USING ERRCODE='42501';
  END IF;
  UPDATE public.website_scan_runs r SET review_draft=p_review_draft,review_revision=review_revision+1,updated_at=clock_timestamp()
   WHERE r.id=p_scan_id AND r.status='ready_for_review' AND r.review_revision=p_expected_revision
     AND EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=r.business_id AND b.owner_id=v_owner)
   RETURNING review_revision INTO v_revision;
  IF v_revision IS NULL THEN RAISE EXCEPTION 'website_scan_review_stale_or_inaccessible' USING ERRCODE='40001'; END IF;
  RETURN v_revision;
END $$;

-- Hashes deliberately use the worker's locale-independent canonical form so
-- a rescan and the final publish compare the same snapshot.
CREATE FUNCTION public.website_scan_baseline_component(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public,pg_temp AS $$
 SELECT btrim(regexp_replace(lower(normalize(coalesce(p_value,''), NFKC)), '[^a-z0-9]+', ' ', 'g')) $$;
CREATE FUNCTION public.website_scan_service_baseline_hash(p_service public.services)
RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT encode(extensions.digest(public.website_scan_baseline_component(concat_ws('|',p_service.name,
   coalesce(p_service.description,''),coalesce(p_service.price,''))),'sha256'),'hex') $$;
CREATE FUNCTION public.website_scan_faq_baseline_hash(p_faq public.faqs)
RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT encode(extensions.digest(public.website_scan_baseline_component(concat_ws('|',p_faq.question,p_faq.answer)),
   'sha256'),'hex') $$;
CREATE FUNCTION public.website_scan_knowledge_baseline_hash(p_item public.business_knowledge_items)
RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT encode(extensions.digest(public.website_scan_baseline_component(concat_ws('|',p_item.kind,
   coalesce(p_item.category,''),coalesce(p_item.title,''),p_item.content)),'sha256'),'hex') $$;

CREATE FUNCTION public.publish_website_scan_v1(
  p_scan_id uuid, p_expected_revision integer, p_idempotency_key uuid, p_final_review jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid:=auth.uid(); v_run public.website_scan_runs; v_item jsonb; v_target uuid;
  v_suggestion uuid; v_hash text; v_services integer; v_faqs integer; v_result jsonb;
  v_content_edited boolean; v_prior_owner_edited boolean;
BEGIN
  IF v_owner IS NULL OR p_idempotency_key IS NULL OR p_expected_revision IS NULL
    OR jsonb_typeof(p_final_review)<>'object' OR NOT p_final_review ?& ARRAY['services','faqs','knowledge','questions']
    OR p_final_review - ARRAY['services','faqs','knowledge','questions'] <> '{}'::jsonb
    OR jsonb_typeof(p_final_review->'services')<>'array' OR jsonb_typeof(p_final_review->'faqs')<>'array'
    OR jsonb_typeof(p_final_review->'knowledge')<>'array' OR jsonb_typeof(p_final_review->'questions')<>'array'
    OR jsonb_array_length(p_final_review->'services')>20 OR jsonb_array_length(p_final_review->'faqs')>20
    OR jsonb_array_length(p_final_review->'knowledge')>24 OR jsonb_array_length(p_final_review->'questions')>5
    OR pg_column_size(p_final_review)>262144 THEN RAISE EXCEPTION 'invalid_website_scan_publish' USING ERRCODE='22023'; END IF;
  SELECT r.* INTO v_run FROM public.website_scan_runs r JOIN public.businesses b ON b.id=r.business_id
   WHERE r.id=p_scan_id AND b.owner_id=v_owner FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'website_scan_not_accessible' USING ERRCODE='42501'; END IF;
  IF v_run.status='published' AND v_run.published_idempotency_key=p_idempotency_key THEN
    RETURN jsonb_build_object('scanId',v_run.id,'status','published','revision',v_run.review_revision);
  END IF;
  IF v_run.purpose='manual_rescan'
     AND NOT public.website_scan_has_ai_customization_entitlement(v_run.business_id) THEN
    RAISE EXCEPTION 'website_scan_plan_required' USING ERRCODE='42501';
  END IF;
  IF v_run.status<>'ready_for_review' OR v_run.review_revision<>p_expected_revision THEN
    RAISE EXCEPTION 'website_scan_review_stale' USING ERRCODE='40001'; END IF;
  -- Shared business lock serializes existing service/FAQ guards and Settings edits.
  PERFORM 1 FROM public.businesses WHERE id=v_run.business_id FOR UPDATE;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_final_review->'services') LOOP
    v_target:=nullif(v_item->>'targetId','')::uuid; v_suggestion:=nullif(v_item->>'suggestionId','')::uuid;
    v_content_edited:=false; v_prior_owner_edited:=false;
    IF v_target IS NOT NULL AND v_suggestion IS NULL THEN RAISE EXCEPTION 'invalid_service_target'; END IF;
    IF v_item->>'decision' IN ('rejected','keep_current') THEN
      UPDATE public.website_scan_suggestions SET decision=v_item->>'decision',decided_at=clock_timestamp(),
        updated_at=clock_timestamp() WHERE id=v_suggestion AND scan_id=p_scan_id AND kind='service';
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid_service_suggestion'; END IF;
      CONTINUE;
    END IF;
    IF v_suggestion IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.website_scan_suggestions s
       WHERE s.id=v_suggestion AND s.scan_id=p_scan_id AND s.kind='service'
         AND s.target_id IS NOT DISTINCT FROM v_target
         AND s.baseline_hash IS NOT DISTINCT FROM nullif(v_item->>'baselineHash','')) THEN
      RAISE EXCEPTION 'invalid_service_suggestion'; END IF;
    IF public.normalize_ai_knowledge_key(v_item->>'name')=''
       OR char_length(v_item->>'name')>120
       OR char_length(coalesce(v_item->>'description',''))>1000
       OR char_length(coalesce(v_item->>'price',''))>120 THEN
      RAISE EXCEPTION 'invalid_service_publish' USING ERRCODE='22023';
    END IF;
    IF v_suggestion IS NOT NULL THEN
      SELECT
        coalesce(s.draft_payload->>'name','') IS DISTINCT FROM coalesce(v_item->>'name','')
        OR coalesce(s.draft_payload->>'description','') IS DISTINCT FROM coalesce(v_item->>'description','')
        OR coalesce(s.draft_payload->>'price','') IS DISTINCT FROM coalesce(v_item->>'price','')
      INTO v_content_edited FROM public.website_scan_suggestions s WHERE s.id=v_suggestion;
    END IF;
    IF v_target IS NOT NULL THEN
      SELECT coalesce(bool_or(s.owner_edited),false) INTO v_prior_owner_edited
      FROM public.website_scan_suggestions s
      WHERE s.business_id=v_run.business_id AND s.kind='service'
        AND s.published_target_id=v_target AND s.decision='accepted';
    END IF;
    IF v_target IS NULL THEN
      INSERT INTO public.services(business_id,name,description,price,source) VALUES(v_run.business_id,v_item->>'name',
        nullif(btrim(v_item->>'description'),''),nullif(btrim(v_item->>'price'),''),CASE WHEN v_suggestion IS NULL THEN 'manual' ELSE 'suggested' END)
        RETURNING id INTO v_target;
    ELSE
      SELECT public.website_scan_service_baseline_hash(s) INTO v_hash FROM public.services s
       WHERE s.id=v_target AND s.business_id=v_run.business_id AND s.is_active IS TRUE FOR UPDATE;
      IF v_hash IS NULL OR v_hash IS DISTINCT FROM v_item->>'baselineHash' THEN RAISE EXCEPTION 'website_scan_stale_service' USING ERRCODE='40001'; END IF;
      UPDATE public.services SET name=v_item->>'name',description=nullif(btrim(v_item->>'description'),''),
        price=nullif(btrim(v_item->>'price'),'') WHERE id=v_target;
    END IF;
    IF v_suggestion IS NOT NULL THEN UPDATE public.website_scan_suggestions SET decision='accepted',owner_payload=v_item,
      owner_edited=(v_prior_owner_edited OR v_content_edited),
      published_target_id=v_target,decided_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v_suggestion; END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_final_review->'faqs') LOOP
    v_target:=nullif(v_item->>'targetId','')::uuid; v_suggestion:=nullif(v_item->>'suggestionId','')::uuid;
    v_content_edited:=false; v_prior_owner_edited:=false;
    IF v_target IS NOT NULL AND v_suggestion IS NULL THEN RAISE EXCEPTION 'invalid_faq_target'; END IF;
    IF v_item->>'decision' IN ('rejected','keep_current') THEN
      UPDATE public.website_scan_suggestions SET decision=v_item->>'decision',decided_at=clock_timestamp(),
        updated_at=clock_timestamp() WHERE id=v_suggestion AND scan_id=p_scan_id AND kind='faq';
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid_faq_suggestion'; END IF;
      CONTINUE;
    END IF;
    IF v_suggestion IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.website_scan_suggestions s
       WHERE s.id=v_suggestion AND s.scan_id=p_scan_id AND s.kind='faq'
         AND s.target_id IS NOT DISTINCT FROM v_target
         AND s.baseline_hash IS NOT DISTINCT FROM nullif(v_item->>'baselineHash','')) THEN
      RAISE EXCEPTION 'invalid_faq_suggestion'; END IF;
    IF public.normalize_ai_knowledge_key(v_item->>'question')='' OR public.normalize_ai_knowledge_key(v_item->>'answer')=''
       OR char_length(v_item->>'question')>300 OR char_length(v_item->>'answer')>2000 THEN
      RAISE EXCEPTION 'invalid_faq_publish' USING ERRCODE='22023';
    END IF;
    IF v_suggestion IS NOT NULL THEN
      SELECT
        coalesce(s.draft_payload->>'question','') IS DISTINCT FROM coalesce(v_item->>'question','')
        OR coalesce(s.draft_payload->>'answer','') IS DISTINCT FROM coalesce(v_item->>'answer','')
      INTO v_content_edited FROM public.website_scan_suggestions s WHERE s.id=v_suggestion;
    END IF;
    IF v_target IS NOT NULL THEN
      SELECT coalesce(bool_or(s.owner_edited),false) INTO v_prior_owner_edited
      FROM public.website_scan_suggestions s
      WHERE s.business_id=v_run.business_id AND s.kind='faq'
        AND s.published_target_id=v_target AND s.decision='accepted';
    END IF;
    IF v_target IS NULL THEN
      INSERT INTO public.faqs(business_id,question,answer,source) VALUES(v_run.business_id,v_item->>'question',v_item->>'answer',
        CASE WHEN v_suggestion IS NULL THEN 'manual' ELSE 'suggested' END) RETURNING id INTO v_target;
    ELSE
      SELECT public.website_scan_faq_baseline_hash(f) INTO v_hash FROM public.faqs f
       WHERE f.id=v_target AND f.business_id=v_run.business_id AND f.is_active IS TRUE FOR UPDATE;
      IF v_hash IS NULL OR v_hash IS DISTINCT FROM v_item->>'baselineHash' THEN RAISE EXCEPTION 'website_scan_stale_faq' USING ERRCODE='40001'; END IF;
      UPDATE public.faqs SET question=v_item->>'question',answer=v_item->>'answer' WHERE id=v_target;
    END IF;
    IF v_suggestion IS NOT NULL THEN UPDATE public.website_scan_suggestions SET decision='accepted',owner_payload=v_item,
      owner_edited=(v_prior_owner_edited OR v_content_edited),
      published_target_id=v_target,decided_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v_suggestion; END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_final_review->'knowledge') LOOP
    v_target:=nullif(v_item->>'targetId','')::uuid; v_suggestion:=nullif(v_item->>'suggestionId','')::uuid;
    v_content_edited:=false; v_prior_owner_edited:=false;
    IF v_target IS NOT NULL AND v_suggestion IS NULL THEN RAISE EXCEPTION 'invalid_knowledge_target'; END IF;
    IF v_item->>'decision' IN ('rejected','keep_current') THEN
      UPDATE public.website_scan_suggestions SET decision=v_item->>'decision',decided_at=clock_timestamp(),
        updated_at=clock_timestamp() WHERE id=v_suggestion AND scan_id=p_scan_id
          AND kind IN ('overview','fact','policy');
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid_knowledge_suggestion'; END IF;
      CONTINUE;
    END IF;
    IF v_item->>'kind' NOT IN ('overview','fact','policy')
      OR coalesce(char_length(btrim(v_item->>'content')),0)<1
      OR (v_item->>'kind'='overview' AND char_length(v_item->>'content')>1000)
      OR (v_item->>'kind'<>'overview' AND char_length(v_item->>'content')>2000)
      OR char_length(coalesce(v_item->>'category',''))>80
      OR char_length(coalesce(v_item->>'title',''))>200
      OR ((v_item->>'kind')<>'overview' AND coalesce(char_length(btrim(v_item->>'title')),0)<1) THEN
      RAISE EXCEPTION 'invalid_knowledge_publish' USING ERRCODE='22023';
    END IF;
    IF v_suggestion IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.website_scan_suggestions s
       WHERE s.id=v_suggestion AND s.scan_id=p_scan_id AND s.kind=v_item->>'kind'
         AND s.target_id IS NOT DISTINCT FROM v_target
         AND s.baseline_hash IS NOT DISTINCT FROM nullif(v_item->>'baselineHash','')) THEN
      RAISE EXCEPTION 'invalid_knowledge_suggestion'; END IF;
    IF v_suggestion IS NOT NULL THEN
      SELECT
        coalesce(s.draft_payload->>'kind','') IS DISTINCT FROM coalesce(v_item->>'kind','')
        OR coalesce(s.draft_payload->>'category',s.category,
          CASE WHEN s.kind='overview' THEN 'business_overview' ELSE '' END,'')
          IS DISTINCT FROM coalesce(v_item->>'category',
            CASE WHEN v_item->>'kind'='overview' THEN 'business_overview' ELSE '' END,'')
        OR coalesce(s.draft_payload->>'title',
          CASE WHEN s.kind='overview' THEN 'Business overview' ELSE '' END,'')
          IS DISTINCT FROM coalesce(v_item->>'title',
            CASE WHEN v_item->>'kind'='overview' THEN 'Business overview' ELSE '' END,'')
        OR coalesce(s.draft_payload->>'content','') IS DISTINCT FROM coalesce(v_item->>'content','')
      INTO v_content_edited FROM public.website_scan_suggestions s WHERE s.id=v_suggestion;
    ELSE
      v_content_edited:=true;
    END IF;
    IF v_target IS NULL THEN
      IF v_item->>'kind'='overview' AND EXISTS(
        SELECT 1 FROM public.business_knowledge_items k
        WHERE k.business_id=v_run.business_id AND k.kind='overview' AND k.is_active
      ) THEN
        RAISE EXCEPTION 'website_scan_stale_overview' USING ERRCODE='40001';
      END IF;
      INSERT INTO public.business_knowledge_items(business_id,kind,category,title,content,source,origin_suggestion_id,owner_edited)
      VALUES(v_run.business_id,v_item->>'kind',
        CASE WHEN v_item->>'kind'='overview' THEN coalesce(nullif(btrim(v_item->>'category'),''),'business_overview')
          ELSE nullif(btrim(v_item->>'category'),'') END,
        CASE WHEN v_item->>'kind'='overview' THEN coalesce(nullif(btrim(v_item->>'title'),''),'Business overview')
          ELSE nullif(btrim(v_item->>'title'),'') END,
        v_item->>'content',CASE WHEN v_suggestion IS NULL THEN 'manual' ELSE 'website_scan' END,v_suggestion,
        v_content_edited) RETURNING id INTO v_target;
    ELSE
      SELECT public.website_scan_knowledge_baseline_hash(k),k.owner_edited
        INTO v_hash,v_prior_owner_edited FROM public.business_knowledge_items k
       WHERE k.id=v_target AND k.business_id=v_run.business_id AND k.is_active IS TRUE FOR UPDATE;
      IF v_hash IS NULL OR v_hash IS DISTINCT FROM v_item->>'baselineHash' THEN
        IF v_item->>'kind'='overview' THEN
          RAISE EXCEPTION 'website_scan_stale_overview' USING ERRCODE='40001';
        END IF;
        RAISE EXCEPTION 'website_scan_stale_knowledge' USING ERRCODE='40001';
      END IF;
      UPDATE public.business_knowledge_items SET
        category=CASE WHEN v_item->>'kind'='overview'
          THEN coalesce(nullif(btrim(v_item->>'category'),''),'business_overview')
          ELSE nullif(btrim(v_item->>'category'),'') END,
        title=CASE WHEN v_item->>'kind'='overview'
          THEN coalesce(nullif(btrim(v_item->>'title'),''),'Business overview')
          ELSE nullif(btrim(v_item->>'title'),'') END,
        content=v_item->>'content',owner_edited=(v_prior_owner_edited OR v_content_edited),
        verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v_target;
    END IF;
    IF v_suggestion IS NOT NULL THEN UPDATE public.website_scan_suggestions SET decision='accepted',owner_payload=v_item,
      owner_edited=(v_prior_owner_edited OR v_content_edited),published_target_id=v_target,
      decided_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v_suggestion; END IF;
  END LOOP;
  UPDATE public.website_scan_suggestions SET
    decision=CASE WHEN change_type IN ('changed','unchanged','missing') THEN 'keep_current' ELSE 'rejected' END,
    decided_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE scan_id=p_scan_id AND decision='pending';
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_final_review->'questions') LOOP
    UPDATE public.website_scan_questions SET status=v_item->>'status',answer=nullif(btrim(v_item->>'answer'),''),updated_at=clock_timestamp()
    WHERE id=(v_item->>'questionId')::uuid AND scan_id=p_scan_id
       AND v_item->>'status' IN ('answered','skipped','not_applicable');
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_website_scan_question'; END IF;
    IF v_item->>'status'='answered' THEN
      IF (SELECT output_kind FROM public.website_scan_questions WHERE id=(v_item->>'questionId')::uuid)='faq' THEN
        INSERT INTO public.faqs(business_id,question,answer,source)
        SELECT v_run.business_id,coalesce(output_title,question),answer,'manual'
        FROM public.website_scan_questions WHERE id=(v_item->>'questionId')::uuid;
      ELSE
        INSERT INTO public.business_knowledge_items(business_id,kind,category,title,content,source,owner_edited)
        SELECT v_run.business_id,output_kind,category,coalesce(output_title,question),answer,'owner_answer',true
        FROM public.website_scan_questions WHERE id=(v_item->>'questionId')::uuid;
      END IF;
    END IF;
  END LOOP;
  SELECT count(DISTINCT public.normalize_ai_knowledge_key(name)) INTO v_services FROM public.services
    WHERE business_id=v_run.business_id AND is_active AND public.normalize_ai_knowledge_key(name)<>'';
  SELECT count(DISTINCT public.normalize_ai_knowledge_key(question)) INTO v_faqs FROM public.faqs
    WHERE business_id=v_run.business_id AND is_active AND public.normalize_ai_knowledge_key(question)<>''
      AND public.normalize_ai_knowledge_key(answer)<>'' AND char_length(answer)<=2000;
  IF v_services<3 OR v_faqs<3 THEN RAISE EXCEPTION 'website_scan_knowledge_floor' USING ERRCODE='23514'; END IF;
  v_hash:=encode(extensions.digest(p_final_review::text,'sha256'),'hex');
  UPDATE public.website_scan_runs SET status='published',progress_stage='done',review_draft=p_final_review,
    review_revision=review_revision+1,published_idempotency_key=p_idempotency_key,published_review_hash=v_hash,
    published_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_scan_id RETURNING * INTO v_run;
  DELETE FROM public.website_scan_page_payloads p USING public.website_scan_pages page
    WHERE p.page_id=page.id AND page.scan_id=p_scan_id;
  RETURN jsonb_build_object('scanId',v_run.id,'status',v_run.status,'revision',v_run.review_revision,
    'services',v_services,'faqs',v_faqs);
END $$;

CREATE FUNCTION public.discard_website_scan_v1(p_scan_id uuid, p_expected_revision integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid:=auth.uid(); v_id uuid;
BEGIN
  UPDATE public.website_scan_runs r SET status='discarded',progress_stage='done',discarded_at=clock_timestamp(),
    updated_at=clock_timestamp() WHERE r.id=p_scan_id AND r.status='ready_for_review'
    AND r.review_revision=p_expected_revision AND EXISTS(SELECT 1 FROM public.businesses b
      WHERE b.id=r.business_id AND b.owner_id=v_owner) RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'website_scan_review_stale_or_inaccessible' USING ERRCODE='40001'; END IF;
  DELETE FROM public.website_scan_page_payloads p USING public.website_scan_pages page
    WHERE p.page_id=page.id AND page.scan_id=p_scan_id;
  RETURN true;
END $$;

CREATE FUNCTION public.request_cancel_website_scan_v1(
  p_scan_id uuid, p_expected_revision integer DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid:=auth.uid(); v_id uuid;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'website_scan_not_accessible' USING ERRCODE='42501'; END IF;
  UPDATE public.website_scan_runs r SET
    cancel_requested_at=clock_timestamp(), status='cancelled', progress_stage='done',
    cancelled_at=clock_timestamp(), claim_token=NULL,worker_id=NULL,claimed_at=NULL,
    claim_expires_at=NULL,heartbeat_at=NULL,updated_at=clock_timestamp()
  WHERE r.id=p_scan_id
    AND r.status IN ('queued','discovering','crawling','extracting','ready_for_review')
    AND (p_expected_revision IS NULL OR r.review_revision=p_expected_revision)
    AND EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=r.business_id AND b.owner_id=v_owner)
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'website_scan_cancel_stale_or_inaccessible' USING ERRCODE='40001'; END IF;
  DELETE FROM public.website_scan_page_payloads p USING public.website_scan_pages page
    WHERE p.page_id=page.id AND page.scan_id=p_scan_id;
  RETURN true;
END $$;

CREATE FUNCTION public.retry_website_scan_v1(p_scan_id uuid, p_idempotency_key uuid)
RETURNS public.website_scan_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid:=auth.uid(); v_run public.website_scan_runs;
BEGIN
  IF v_owner IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_website_scan_retry' USING ERRCODE='22023';
  END IF;
  SELECT r.* INTO v_run FROM public.website_scan_runs r JOIN public.businesses b ON b.id=r.business_id
    WHERE r.id=p_scan_id AND b.owner_id=v_owner FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'website_scan_retry_stale_or_inaccessible' USING ERRCODE='40001'; END IF;
  IF v_run.retry_idempotency_key=p_idempotency_key
     AND v_run.status IN ('queued','discovering','crawling','extracting') THEN
    v_run.claim_token:=NULL; v_run.worker_id:=NULL; v_run.claimed_at:=NULL;
    v_run.claim_expires_at:=NULL; v_run.heartbeat_at:=NULL; v_run.provider_job_id:=NULL;
    RETURN v_run;
  END IF;
  IF v_run.purpose='manual_rescan'
     AND NOT public.website_scan_has_ai_customization_entitlement(v_run.business_id) THEN
    RAISE EXCEPTION 'website_scan_plan_required' USING ERRCODE='42501';
  END IF;
  IF v_run.status<>'failed' THEN
    RAISE EXCEPTION 'website_scan_retry_stale_or_inaccessible' USING ERRCODE='40001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.website_scan_runs keyed WHERE keyed.business_id=v_run.business_id
      AND keyed.id<>v_run.id AND (keyed.idempotency_key=p_idempotency_key
        OR keyed.retry_idempotency_key=p_idempotency_key)) THEN
    RAISE EXCEPTION 'website_scan_retry_idempotency_conflict' USING ERRCODE='23505';
  END IF;
  IF EXISTS(SELECT 1 FROM public.website_scan_runs other WHERE other.business_id=v_run.business_id
      AND other.id<>v_run.id AND other.status IN ('queued','discovering','crawling','extracting','ready_for_review')) THEN
    RAISE EXCEPTION 'website_scan_open_run_exists' USING ERRCODE='23505';
  END IF;
  -- A user-requested retry is a fresh processing pass. Old metadata/payloads
  -- would otherwise inflate counts and collide if provider ordering changed.
  DELETE FROM public.website_scan_pages WHERE scan_id=p_scan_id;
  UPDATE public.website_scan_runs SET retry_idempotency_key=p_idempotency_key,status='queued',coverage=NULL,
    progress_stage='queued',attempt_count=0,provider_job_attempt=0,pages_discovered=0,
    pages_succeeded=0,pages_completed=0,pages_failed=0,credits_used=0,
    available_at=clock_timestamp(),worker_id=NULL,claim_token=NULL,
    claimed_at=NULL,claim_expires_at=NULL,heartbeat_at=NULL,cancel_requested_at=NULL,error_code=NULL,
    error_message=NULL,failed_at=NULL,started_at=NULL,updated_at=clock_timestamp()
    WHERE id=p_scan_id RETURNING * INTO v_run;
  v_run.claim_token:=NULL; v_run.worker_id:=NULL; v_run.claimed_at:=NULL;
  v_run.claim_expires_at:=NULL; v_run.heartbeat_at:=NULL; v_run.provider_job_id:=NULL;
  RETURN v_run;
END $$;

CREATE FUNCTION public.purge_website_scan_payloads_v1()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer;
BEGIN DELETE FROM public.website_scan_page_payloads WHERE expires_at<=clock_timestamp();
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $$;

CREATE FUNCTION public.purge_website_scan_knowledge_on_tombstone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.cleanup_pii_scrubbed_at IS NOT NULL AND OLD.cleanup_pii_scrubbed_at IS NULL THEN
    DELETE FROM public.website_scan_runs WHERE business_id=NEW.id;
    DELETE FROM public.business_knowledge_items WHERE business_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purge_website_scan_knowledge_on_tombstone
AFTER UPDATE OF cleanup_pii_scrubbed_at ON public.businesses FOR EACH ROW
WHEN (OLD.cleanup_pii_scrubbed_at IS NULL AND NEW.cleanup_pii_scrubbed_at IS NOT NULL)
EXECUTE FUNCTION public.purge_website_scan_knowledge_on_tombstone();

-- Default function EXECUTE is PUBLIC. Close every writer, then grant only the
-- intended caller class.
REVOKE ALL ON FUNCTION public.start_website_scan_v1(uuid,text,text,uuid),
 public.claim_next_website_scan_v1(text,integer), public.heartbeat_website_scan_v1(uuid,uuid,integer,integer),
 public.update_website_scan_progress_v1(uuid,uuid,integer,text,text,integer,integer,integer,integer,integer),
 public.save_website_scan_page_v1(uuid,uuid,integer,integer,text,text,text,text,integer,text,text),
 public.complete_website_scan_draft_v1(uuid,uuid,integer,text,jsonb),
 public.fail_website_scan_v1(uuid,uuid,integer,text,text,boolean),
 public.save_website_scan_review_v1(uuid,integer,jsonb),
 public.publish_website_scan_v1(uuid,integer,uuid,jsonb),
 public.discard_website_scan_v1(uuid,integer), public.request_cancel_website_scan_v1(uuid,integer),
 public.retry_website_scan_v1(uuid,uuid),
 public.purge_website_scan_payloads_v1(),
 public.purge_website_scan_knowledge_on_tombstone(),
 public.guard_business_knowledge_scan_tenant(),
 public.normalize_website_scan_evidence(text),
 public.website_scan_has_ai_customization_entitlement(uuid),
 public.website_scan_baseline_component(text),
 public.website_scan_service_baseline_hash(public.services),
 public.website_scan_faq_baseline_hash(public.faqs),
 public.website_scan_knowledge_baseline_hash(public.business_knowledge_items)
 FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_website_scan_v1(uuid,text,text,uuid),
 public.save_website_scan_review_v1(uuid,integer,jsonb),
 public.publish_website_scan_v1(uuid,integer,uuid,jsonb),
 public.discard_website_scan_v1(uuid,integer),
 public.request_cancel_website_scan_v1(uuid,integer),
 public.retry_website_scan_v1(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_website_scan_v1(text,integer),
 public.heartbeat_website_scan_v1(uuid,uuid,integer,integer),
 public.update_website_scan_progress_v1(uuid,uuid,integer,text,text,integer,integer,integer,integer,integer),
 public.save_website_scan_page_v1(uuid,uuid,integer,integer,text,text,text,text,integer,text,text),
 public.complete_website_scan_draft_v1(uuid,uuid,integer,text,jsonb),
 public.fail_website_scan_v1(uuid,uuid,integer,text,text,boolean),
 public.purge_website_scan_payloads_v1() TO service_role;

COMMENT ON TABLE public.website_scan_page_payloads IS
 'Private, service-only transient Markdown. Owners can read page metadata and evidence, never raw page payloads.';
COMMENT ON FUNCTION public.publish_website_scan_v1(uuid,integer,uuid,jsonb) IS
 'Atomically publishes the submitted final review without deleting existing approved knowledge; optimistic baselines reject stale Settings edits.';

COMMIT;
