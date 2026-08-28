BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(58);

SELECT has_table('public','website_scan_runs','durable scan runs exist');
SELECT has_table('public','website_scan_pages','owner-safe page metadata exists');
SELECT has_table('public','website_scan_page_payloads','private raw page payloads exist');
SELECT has_table('public','website_scan_suggestions','review suggestions exist');
SELECT has_table('public','website_scan_suggestion_sources','suggestion evidence exists');
SELECT has_table('public','website_scan_questions','targeted owner questions exist');
SELECT has_table('public','business_knowledge_items','approved compact knowledge exists');
SELECT has_column('public','business_knowledge_items','sort_order','approved knowledge has deterministic prompt order');

SELECT ok(
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
    'public.website_scan_runs'::regclass,'public.website_scan_pages'::regclass,
    'public.website_scan_page_payloads'::regclass,'public.website_scan_suggestions'::regclass,
    'public.website_scan_suggestion_sources'::regclass,'public.website_scan_questions'::regclass,
    'public.business_knowledge_items'::regclass
  )),
  'every richer-scan table enforces RLS'
);
SELECT ok(
  NOT has_table_privilege('authenticated','public.website_scan_runs','INSERT')
  AND NOT has_table_privilege('authenticated','public.website_scan_suggestions','UPDATE')
  AND NOT has_table_privilege('service_role','public.website_scan_runs','INSERT'),
  'scan mutations are RPC-owned for both owner and worker roles'
);
SELECT ok(
  NOT has_table_privilege('authenticated','public.website_scan_page_payloads','SELECT')
  AND has_table_privilege('service_role','public.website_scan_page_payloads','SELECT'),
  'raw Markdown is service-only'
);
SELECT ok(
  NOT has_column_privilege('authenticated','public.website_scan_runs','claim_token','SELECT')
  AND NOT has_column_privilege('authenticated','public.website_scan_runs','worker_id','SELECT')
  AND has_column_privilege('authenticated','public.website_scan_runs','status','SELECT'),
  'owner reads exclude lease credentials while retaining safe progress'
);

SELECT has_function('public','start_website_scan_v1',ARRAY['uuid','text','text','uuid'],'owner start RPC exists');
SELECT has_function('public','claim_next_website_scan_v1',ARRAY['text','integer'],'worker claim RPC exists');
SELECT has_function('public','update_website_scan_progress_v1',
  ARRAY['uuid','uuid','integer','text','text','integer','integer','integer','integer','integer'],
  'generation-fenced progress RPC exists');
SELECT has_function('public','complete_website_scan_draft_v1',ARRAY['uuid','uuid','integer','text','jsonb'],
  'draft completion RPC exists');
SELECT has_function('public','publish_website_scan_v1',ARRAY['uuid','integer','uuid','jsonb'],
  'atomic owner publish RPC exists');
SELECT has_function('public','save_website_scan_review_v1',ARRAY['uuid','integer','jsonb'],
  'optimistic review autosave RPC exists');
SELECT has_function('public','request_cancel_website_scan_v1',ARRAY['uuid','integer'],
  'owner cancellation RPC exists');
SELECT has_function('public','discard_website_scan_v1',ARRAY['uuid','integer'],
  'owner discard RPC exists');
SELECT has_function('public','retry_website_scan_v1',ARRAY['uuid','uuid'],'owner retry RPC exists');
SELECT has_function('public','purge_website_scan_payloads_v1',ARRAY[]::text[],
  'abandoned raw payload purge RPC exists');

SELECT ok(
  has_function_privilege('authenticated','public.start_website_scan_v1(uuid,text,text,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.start_website_scan_v1(uuid,text,text,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.claim_next_website_scan_v1(text,integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.claim_next_website_scan_v1(text,integer)','EXECUTE')
  AND has_function_privilege('authenticated','public.save_website_scan_review_v1(uuid,integer,jsonb)','EXECUTE')
  AND has_function_privilege('authenticated','public.publish_website_scan_v1(uuid,integer,uuid,jsonb)','EXECUTE')
  AND has_function_privilege('authenticated','public.request_cancel_website_scan_v1(uuid,integer)','EXECUTE')
  AND has_function_privilege('authenticated','public.retry_website_scan_v1(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.website_scan_has_ai_customization_entitlement(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.purge_website_scan_payloads_v1()','EXECUTE'),
  'owner and worker RPC authority is separated'
);
SELECT is(
  public.normalize_website_scan_evidence(E'  ＡＰＰＯＩＮＴＭＥＮＴＳ\n\tARE  available.  '),
  'appointments are available.',
  'evidence normalization uses NFKC, case folding, and whitespace collapse'
);

INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-a068-000000000001','scan-owner-a068@example.test'),
 ('00000000-0000-4000-a068-000000000002','other-owner-a068@example.test');
INSERT INTO public.businesses(id,owner_id,name,business_type,slug,website_url) VALUES
 ('10000000-0000-4000-a068-000000000001','00000000-0000-4000-a068-000000000001','Scan A','general','scan-a-068','https://scan-a.example'),
 ('10000000-0000-4000-a068-000000000002','00000000-0000-4000-a068-000000000002','Scan B','general','scan-b-068','https://scan-b.example'),
 ('10000000-0000-4000-a068-000000000003','00000000-0000-4000-a068-000000000001','Lease Scan','general','scan-c-068','https://scan-c.example');
INSERT INTO public.businesses(
  id,owner_id,name,business_type,slug,website_url,onboarding_completed_at
) VALUES (
  '10000000-0000-4000-a068-000000000004','00000000-0000-4000-a068-000000000001',
  'Entitlement Scan','general','scan-d-068','https://scan-d.example',clock_timestamp()
);

INSERT INTO public.services(business_id,name) VALUES
 ('10000000-0000-4000-a068-000000000001','Existing One'),
 ('10000000-0000-4000-a068-000000000001','Existing Two');
INSERT INTO public.faqs(business_id,question,answer) VALUES
 ('10000000-0000-4000-a068-000000000001','Existing question one?','Yes.'),
 ('10000000-0000-4000-a068-000000000001','Existing question two?','Yes.');

CREATE TEMP TABLE scan_068_state(name text PRIMARY KEY,uuid_value uuid,integer_value integer,text_value text);
GRANT SELECT,INSERT,UPDATE ON pg_temp.scan_068_state TO authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a068-000000000001',true);
SET LOCAL ROLE authenticated;
INSERT INTO scan_068_state(name,uuid_value)
SELECT 'main_scan',(public.start_website_scan_v1(
  '10000000-0000-4000-a068-000000000001','https://scan-a.example','onboarding',
  '20000000-0000-4000-a068-000000000001'
)).id;

SELECT is(
  (public.start_website_scan_v1('10000000-0000-4000-a068-000000000001','https://scan-a.example',
    'onboarding','20000000-0000-4000-a068-000000000001')).id,
  (SELECT uuid_value FROM scan_068_state WHERE name='main_scan'),
  'start is idempotent'
);
SELECT throws_ok(
  $$SELECT public.start_website_scan_v1('10000000-0000-4000-a068-000000000002',
    'https://scan-b.example','onboarding','20000000-0000-4000-a068-000000000002')$$,
  '42501','website_scan_business_not_accessible','an owner cannot start a foreign scan'
);
SELECT throws_ok(
  $$SELECT public.start_website_scan_v1('10000000-0000-4000-a068-000000000004',
    'https://scan-d.example','onboarding','20000000-0000-4000-a068-000000000005')$$,
  '42501','website_scan_purpose_mismatch',
  'a direct RPC cannot start onboarding after onboarding is complete'
);
SELECT throws_ok(
  $$SELECT public.start_website_scan_v1('10000000-0000-4000-a068-000000000004',
    'https://scan-d.example','manual_rescan','20000000-0000-4000-a068-000000000006')$$,
  '42501','website_scan_plan_required',
  'a direct RPC cannot start a rescan without AI customization entitlement'
);
RESET ROLE;

INSERT INTO public.subscriptions(
  business_id,stripe_customer_id,stripe_subscription_id,plan,status
) VALUES (
  '10000000-0000-4000-a068-000000000004','cus_scan_d_a068','sub_scan_d_a068','chat_only','active'
);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.start_website_scan_v1('10000000-0000-4000-a068-000000000004',
    'https://scan-d.example','manual_rescan','20000000-0000-4000-a068-000000000006')$$,
  'an entitled completed business can start a manual rescan directly'
);
RESET ROLE;
UPDATE public.website_scan_runs SET status='ready_for_review',coverage='complete',progress_stage='review',
  review_revision=1,draft_completed_at=clock_timestamp()
WHERE business_id='10000000-0000-4000-a068-000000000004';
UPDATE public.subscriptions SET status='canceled'
WHERE business_id='10000000-0000-4000-a068-000000000004';
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.save_website_scan_review_v1(
    (SELECT id FROM public.website_scan_runs WHERE business_id='10000000-0000-4000-a068-000000000004'),
    1,'{}'::jsonb)$$,
  '42501','website_scan_plan_required','a lapsed plan cannot autosave a manual rescan review'
);
SELECT throws_ok(
  $$SELECT public.publish_website_scan_v1(
    (SELECT id FROM public.website_scan_runs WHERE business_id='10000000-0000-4000-a068-000000000004'),
    1,'30000000-0000-4000-a068-000000000004',
    '{"services":[],"faqs":[],"knowledge":[],"questions":[]}'::jsonb)$$,
  '42501','website_scan_plan_required','a lapsed plan cannot publish a manual rescan review'
);
RESET ROLE;
UPDATE public.website_scan_runs SET status='failed',coverage='insufficient',progress_stage='done',
  failed_at=clock_timestamp(),error_code='plan_test',error_message='Test failure.'
WHERE business_id='10000000-0000-4000-a068-000000000004';
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.retry_website_scan_v1(
    (SELECT id FROM public.website_scan_runs WHERE business_id='10000000-0000-4000-a068-000000000004'),
    '30000000-0000-4000-a068-000000000005')$$,
  '42501','website_scan_plan_required','a lapsed plan cannot retry a manual rescan'
);
RESET ROLE;
UPDATE public.website_scan_runs SET status='published',progress_stage='done',
  published_at=clock_timestamp(),published_idempotency_key='30000000-0000-4000-a068-000000000006'
WHERE business_id='10000000-0000-4000-a068-000000000004';
SET LOCAL ROLE authenticated;
SELECT is(
  public.publish_website_scan_v1(
    (SELECT id FROM public.website_scan_runs WHERE business_id='10000000-0000-4000-a068-000000000004'),
    1,'30000000-0000-4000-a068-000000000006',
    '{"services":[],"faqs":[],"knowledge":[],"questions":[]}'::jsonb
  )->>'status',
  'published','same-key publish recovery remains idempotent after a plan lapses'
);
RESET ROLE;
UPDATE public.website_scan_runs SET status='queued',progress_stage='queued',
  retry_idempotency_key='30000000-0000-4000-a068-000000000007'
WHERE business_id='10000000-0000-4000-a068-000000000004';
SET LOCAL ROLE authenticated;
SELECT is(
  (public.retry_website_scan_v1(
    (SELECT id FROM public.website_scan_runs WHERE business_id='10000000-0000-4000-a068-000000000004'),
    '30000000-0000-4000-a068-000000000007'
  )).status,
  'queued','same-key retry recovery remains idempotent after a plan lapses'
);
RESET ROLE;
DELETE FROM public.website_scan_runs
WHERE business_id='10000000-0000-4000-a068-000000000004';

INSERT INTO scan_068_state(name,uuid_value,integer_value)
SELECT 'claimed',claimed.id,claimed.claim_generation FROM public.claim_next_website_scan_v1('worker-a068',120) claimed;
UPDATE scan_068_state SET text_value=(SELECT claim_token::text FROM public.website_scan_runs
  WHERE id=uuid_value) WHERE name='claimed';
SELECT ok(
  public.update_website_scan_progress_v1(
    (SELECT uuid_value FROM scan_068_state WHERE name='claimed'),
    (SELECT text_value::uuid FROM scan_068_state WHERE name='claimed'),
    (SELECT integer_value FROM scan_068_state WHERE name='claimed'),
    'crawling','fc-job-a068',1,1,0,0,1
  ),
  'the current worker generation updates durable provider progress'
);
SELECT throws_ok(
  format($sql$SELECT public.save_website_scan_page_v1(%L::uuid,%L::uuid,%s,1,
    'https://scan-a.example/count-mismatch','Mismatch','Character count must match.',
    %L,25,'succeeded',NULL)$sql$,
    (SELECT uuid_value FROM scan_068_state WHERE name='claimed'),
    (SELECT text_value FROM scan_068_state WHERE name='claimed'),
    (SELECT integer_value FROM scan_068_state WHERE name='claimed'),
    encode(digest('Character count must match.','sha256'),'hex')),
  '22023','invalid_website_scan_page',
  'page persistence rejects a character count that differs from Markdown'
);
SELECT lives_ok(
  format($sql$SELECT public.save_website_scan_page_v1(%L::uuid,%L::uuid,%s,0,
    'https://scan-a.example/','Home','Welcome. We provide Premium Service. Appointments are available.',
    %L,64,'succeeded',NULL)$sql$,
    (SELECT uuid_value FROM scan_068_state WHERE name='claimed'),
    (SELECT text_value FROM scan_068_state WHERE name='claimed'),
    (SELECT integer_value FROM scan_068_state WHERE name='claimed'),
    encode(digest('Welcome. We provide Premium Service. Appointments are available.','sha256'),'hex')),
  'a fenced worker stores metadata and private Markdown'
);

SELECT lives_ok(
  format($sql$SELECT public.complete_website_scan_draft_v1(%L::uuid,%L::uuid,%s,'complete',%L::jsonb)$sql$,
    (SELECT uuid_value FROM scan_068_state WHERE name='claimed'),
    (SELECT text_value FROM scan_068_state WHERE name='claimed'),
    (SELECT integer_value FROM scan_068_state WHERE name='claimed'),
    jsonb_build_object(
      'overview',jsonb_build_object('text','A trusted local business.', 'sources',jsonb_build_array(
        jsonb_build_object('url','https://scan-a.example/','title','Home','excerpt','Welcome.'))),
      'profilePrefill','{}'::jsonb,
      'services',jsonb_build_array(jsonb_build_object('dedupeKey','premium service','name','Premium Service',
        'description','Premium work','price',NULL,'selected',true,'changeType','new','sources',jsonb_build_array(
          jsonb_build_object('url','https://scan-a.example/','title','Home','excerpt','Premium Service')))),
      'faqs',jsonb_build_array(jsonb_build_object('dedupeKey','appointments','question','Are appointments available?',
        'answer','Yes.','selected',true,'changeType','new','sources',jsonb_build_array(
          jsonb_build_object('url','https://scan-a.example/','title','Home','excerpt','appointments   are available.')))),
      'knowledge',jsonb_build_array(jsonb_build_object('dedupeKey','trusted','kind','fact','category','general',
        'title','Trusted local business','content','A trusted local business.','selected',true,'changeType','new',
        'sources',jsonb_build_array(jsonb_build_object('url','https://scan-a.example/','title','Home','excerpt','Welcome.')))),
      'questions',jsonb_build_array(jsonb_build_object('questionKey','payment-methods','prompt','Which payments?',
        'reason','Not listed','outputKind','fact','outputTitle','Payment methods')),
      'missing','[]'::jsonb,
      'scanMeta',jsonb_build_object('pageCount',1,'failedPageCount',0,'generatedAt','2026-08-28T00:00:00Z')
    ))),
  'validated extraction becomes a persisted review draft'
);
SELECT is(
  (SELECT count(*)::integer FROM public.website_scan_page_payloads),0,
  'raw Markdown is deleted immediately after successful drafting'
);

INSERT INTO public.website_scan_runs(
  business_id,requested_by,purpose,source_url,idempotency_key,status,progress_stage,discarded_at
) VALUES (
  '10000000-0000-4000-a068-000000000002','00000000-0000-4000-a068-000000000002',
  'onboarding','https://scan-b.example','20000000-0000-4000-a068-000000000004',
  'discarded','done',clock_timestamp()
);

SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.website_scan_runs),1,
  'owner RLS returns only the owner scan');
SELECT is((SELECT count(*)::integer FROM public.website_scan_suggestions),4,
  'owner can review unpacked overview, service, FAQ, and fact suggestions');
SELECT throws_ok($$UPDATE public.website_scan_suggestions SET decision='accepted'$$,'42501',NULL,
  'owners cannot bypass the publish RPC');

SELECT throws_ok(
  format($sql$SELECT public.publish_website_scan_v1(%L::uuid,1,%L::uuid,%L::jsonb)$sql$,
    (SELECT uuid_value FROM scan_068_state WHERE name='main_scan'),
    '30000000-0000-4000-a068-000000000006',
    jsonb_build_object(
      'services',jsonb_build_array((SELECT jsonb_build_object(
        'suggestionId',id,'name',repeat('x',121),'description','Premium work','price',NULL
      ) FROM public.website_scan_suggestions WHERE kind='service')),
      'faqs','[]'::jsonb,'knowledge','[]'::jsonb,'questions','[]'::jsonb
    )),
  '22023','invalid_service_publish',
  'direct publish enforces application content bounds inside the database'
);
SELECT lives_ok(
  format($sql$SELECT public.publish_website_scan_v1(%L::uuid,1,%L::uuid,%L::jsonb)$sql$,
    (SELECT uuid_value FROM scan_068_state WHERE name='main_scan'),
    '30000000-0000-4000-a068-000000000001',
    jsonb_build_object(
      'services',jsonb_build_array((SELECT jsonb_build_object('suggestionId',id,'name','Premium Service',
        'description','Premium work','price',NULL) FROM public.website_scan_suggestions WHERE kind='service')),
      'faqs',jsonb_build_array((SELECT jsonb_build_object('suggestionId',id,'question','Are appointments available?',
        'answer','Yes.') FROM public.website_scan_suggestions WHERE kind='faq')),
      'knowledge',jsonb_build_array(
        (SELECT jsonb_build_object('suggestionId',id,'kind','overview','content','A trusted local business.')
          FROM public.website_scan_suggestions WHERE kind='overview'),
        (SELECT jsonb_build_object('suggestionId',id,'kind','fact','category','general','title','Trusted local business',
          'content','An owner-refined local business.') FROM public.website_scan_suggestions WHERE kind='fact')),
      'questions',jsonb_build_array((SELECT jsonb_build_object('questionId',id,'status','answered','answer','Cards and cash.')
        FROM public.website_scan_questions))
    ))),
  'one transaction publishes the final authoritative owner review'
);
SELECT ok(
  (SELECT count(*)=3 FROM public.services WHERE business_id='10000000-0000-4000-a068-000000000001' AND is_active)
  AND (SELECT count(*)=3 FROM public.faqs WHERE business_id='10000000-0000-4000-a068-000000000001' AND is_active)
  AND EXISTS(SELECT 1 FROM public.business_knowledge_items
    WHERE business_id='10000000-0000-4000-a068-000000000001' AND source='owner_answer'),
  'publish satisfies 3+3 and promotes an answered owner question into approved knowledge'
);
SELECT ok(
  NOT EXISTS(
    SELECT 1 FROM public.website_scan_suggestions
    WHERE scan_id=(SELECT uuid_value FROM scan_068_state WHERE name='main_scan')
      AND kind IN ('service','faq','overview') AND owner_edited
  ),
  'untouched service, FAQ, and overview approvals are not mislabeled owner-edited'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM public.website_scan_suggestions
    WHERE scan_id=(SELECT uuid_value FROM scan_068_state WHERE name='main_scan')
      AND kind='fact' AND owner_edited
  )
  AND EXISTS(
    SELECT 1 FROM public.business_knowledge_items
    WHERE business_id='10000000-0000-4000-a068-000000000001'
      AND kind='fact' AND title='Trusted local business'
      AND content='An owner-refined local business.' AND owner_edited
  ),
  'an actual content edit is recorded on both provenance and live knowledge'
);
SELECT is(
  (public.publish_website_scan_v1(
    (SELECT uuid_value FROM scan_068_state WHERE name='main_scan'),1,
    '30000000-0000-4000-a068-000000000001','{"services":[],"faqs":[],"knowledge":[],"questions":[]}'::jsonb
  )->>'status'),'published','publish retry with the same key is idempotent'
);
RESET ROLE;

-- A suggestion can update only the exact version the worker reviewed.
UPDATE public.businesses SET onboarding_completed_at=clock_timestamp()
WHERE id='10000000-0000-4000-a068-000000000001';
INSERT INTO public.subscriptions(
  business_id,stripe_customer_id,stripe_subscription_id,plan,status
) VALUES (
  '10000000-0000-4000-a068-000000000001','cus_scan_a_a068','sub_scan_a_a068','chat_only','active'
);
INSERT INTO public.website_scan_runs(
  id,business_id,requested_by,purpose,source_url,idempotency_key,status,coverage,
  progress_stage,review_revision,draft_completed_at
) VALUES (
  '21000000-0000-4000-a068-000000000001','10000000-0000-4000-a068-000000000001',
  '00000000-0000-4000-a068-000000000001','manual_rescan','https://scan-a.example',
  '22000000-0000-4000-a068-000000000001','ready_for_review','complete','review',1,clock_timestamp()
);
INSERT INTO public.website_scan_suggestions(
  id,scan_id,business_id,client_key,kind,dedupe_key,draft_payload,change_type,target_id,baseline_hash
)
SELECT '23000000-0000-4000-a068-000000000001','21000000-0000-4000-a068-000000000001',
  s.business_id,'service-stale','service','existing one',
  jsonb_build_object('name','Updated Existing One'),'changed',s.id,
  public.website_scan_service_baseline_hash(s)
FROM public.services s
WHERE s.business_id='10000000-0000-4000-a068-000000000001' AND s.name='Existing One';
INSERT INTO public.website_scan_suggestions(
  id,scan_id,business_id,client_key,kind,category,dedupe_key,draft_payload,
  change_type,target_id,baseline_hash
)
SELECT '23000000-0000-4000-a068-000000000002','21000000-0000-4000-a068-000000000001',
  k.business_id,'overview-stale','overview','business_overview','overview',
  jsonb_build_object('kind','overview','content','A newer scanned overview.','selected',false),
  'changed',k.id,public.website_scan_knowledge_baseline_hash(k)
FROM public.business_knowledge_items k
WHERE k.business_id='10000000-0000-4000-a068-000000000001'
  AND k.kind='overview' AND k.is_active;
UPDATE public.services SET description='Changed in Settings after the scan'
WHERE business_id='10000000-0000-4000-a068-000000000001' AND name='Existing One';
UPDATE public.business_knowledge_items SET content='Owner changed this overview after the scan.'
WHERE business_id='10000000-0000-4000-a068-000000000001' AND kind='overview' AND is_active;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format($sql$SELECT public.publish_website_scan_v1(
    '21000000-0000-4000-a068-000000000001',1,'24000000-0000-4000-a068-000000000002',%L::jsonb)$sql$,
    jsonb_build_object(
      'services','[]'::jsonb,'faqs','[]'::jsonb,
      'knowledge',jsonb_build_array(jsonb_build_object(
        'suggestionId','23000000-0000-4000-a068-000000000002','targetId',
        (SELECT id FROM public.business_knowledge_items
          WHERE business_id='10000000-0000-4000-a068-000000000001' AND kind='overview' AND is_active),
        'baselineHash',(SELECT baseline_hash FROM public.website_scan_suggestions
          WHERE id='23000000-0000-4000-a068-000000000002'),
        'kind','overview','category','business_overview','title','Business overview',
        'content','A newer scanned overview.','ownerEdited',false)),
      'questions','[]'::jsonb
    )),
  '40001','website_scan_stale_overview',
  'publish cannot replace an overview the owner edited after the scan'
);
SELECT throws_ok(
  format($sql$SELECT public.publish_website_scan_v1(
    '21000000-0000-4000-a068-000000000001',1,'24000000-0000-4000-a068-000000000001',%L::jsonb)$sql$,
    jsonb_build_object(
      'services',jsonb_build_array(jsonb_build_object(
        'suggestionId','23000000-0000-4000-a068-000000000001','targetId',
        (SELECT id FROM public.services WHERE business_id='10000000-0000-4000-a068-000000000001'
          AND name='Existing One'),
        'baselineHash',(SELECT baseline_hash FROM public.website_scan_suggestions
          WHERE id='23000000-0000-4000-a068-000000000001'),
        'name','Updated Existing One','description','From the website','price',NULL)),
      'faqs','[]'::jsonb,'knowledge','[]'::jsonb,'questions','[]'::jsonb
    )),
  '40001','website_scan_stale_service',
  'publish rolls back rather than overwriting a newer Settings edit'
);
RESET ROLE;

-- Manual retry gets a new end-to-end deadline but keeps the provider identity
-- needed to resume rather than create a duplicate crawl.
UPDATE public.businesses SET onboarding_completed_at=clock_timestamp()
WHERE id='10000000-0000-4000-a068-000000000002';
INSERT INTO public.subscriptions(
  business_id,stripe_customer_id,stripe_subscription_id,plan,status
) VALUES (
  '10000000-0000-4000-a068-000000000002','cus_scan_b_a068','sub_scan_b_a068','chat_only','active'
);
INSERT INTO public.website_scan_runs(
  id,business_id,requested_by,purpose,source_url,idempotency_key,status,coverage,
  progress_stage,provider_job_id,provider_job_attempt,attempt_count,error_code,
  error_message,started_at,failed_at
) VALUES (
  '21000000-0000-4000-a068-000000000002','10000000-0000-4000-a068-000000000002',
  '00000000-0000-4000-a068-000000000002','manual_rescan','https://scan-b.example',
  '22000000-0000-4000-a068-000000000002','failed','insufficient','done','fc-retry-a068',1,3,
  'scan_deadline_exceeded','The scan timed out.',clock_timestamp()-interval '10 minutes',clock_timestamp()
);
INSERT INTO public.website_scan_pages(
  scan_id,business_id,page_index,normalized_url,status,character_count,error_code
) VALUES (
  '21000000-0000-4000-a068-000000000002','10000000-0000-4000-a068-000000000002',0,
  'https://scan-b.example/stale','failed',0,'provider_page_failed'
);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a068-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$BEGIN
  PERFORM public.retry_website_scan_v1(
    '21000000-0000-4000-a068-000000000002','24000000-0000-4000-a068-000000000003'
  );
END$$;
RESET ROLE;
SELECT ok(
  EXISTS(
    SELECT 1 FROM public.website_scan_runs
    WHERE id='21000000-0000-4000-a068-000000000002' AND status='queued'
      AND started_at IS NULL AND provider_job_id='fc-retry-a068' AND provider_job_attempt=0
      AND pages_discovered=0 AND pages_completed=0 AND pages_failed=0 AND credits_used=0
      AND NOT EXISTS(
        SELECT 1 FROM public.website_scan_pages p
        WHERE p.scan_id='21000000-0000-4000-a068-000000000002'
      )
  ),
  'manual retry resets the six-minute deadline while preserving resumable provider state'
);

-- A lease takeover fences every write from the stale generation.
INSERT INTO public.website_scan_runs(business_id,requested_by,purpose,source_url,idempotency_key)
VALUES('10000000-0000-4000-a068-000000000003','00000000-0000-4000-a068-000000000001',
  'manual_rescan','https://scan-c.example','20000000-0000-4000-a068-000000000003');
INSERT INTO scan_068_state(name,uuid_value,integer_value,text_value)
SELECT 'lease_one',c.id,c.claim_generation,c.claim_token::text
FROM public.claim_next_website_scan_v1('lease-one',30) c;
UPDATE public.website_scan_runs SET claim_expires_at=clock_timestamp()-interval '1 second'
WHERE id=(SELECT uuid_value FROM scan_068_state WHERE name='lease_one');
INSERT INTO scan_068_state(name,uuid_value,integer_value,text_value)
SELECT 'lease_two',c.id,c.claim_generation,c.claim_token::text
FROM public.claim_next_website_scan_v1('lease-two',30) c;
SELECT is(
  public.heartbeat_website_scan_v1(
    (SELECT uuid_value FROM scan_068_state WHERE name='lease_one'),
    (SELECT text_value::uuid FROM scan_068_state WHERE name='lease_one'),
    (SELECT integer_value FROM scan_068_state WHERE name='lease_one'),120),false,
  'the stale claim token and generation cannot heartbeat'
);
SELECT is(
  public.heartbeat_website_scan_v1(
    (SELECT uuid_value FROM scan_068_state WHERE name='lease_two'),
    (SELECT text_value::uuid FROM scan_068_state WHERE name='lease_two'),
    (SELECT integer_value FROM scan_068_state WHERE name='lease_two'),120),true,
  'the replacement worker can resume the same durable run'
);
SELECT lives_ok(
  $$
  DO $page_reorder$
  DECLARE v_scan uuid; v_token uuid; v_generation integer;
  BEGIN
    SELECT uuid_value,text_value::uuid,integer_value INTO v_scan,v_token,v_generation
    FROM pg_temp.scan_068_state WHERE name='lease_two';
    PERFORM public.update_website_scan_progress_v1(
      v_scan,v_token,v_generation,'crawling',NULL,0,2,0,0,0
    );
    PERFORM public.save_website_scan_page_v1(
      v_scan,v_token,v_generation,0,'https://scan-b.example/first','First',
      'First page.',encode(extensions.digest('First page.','sha256'),'hex'),11,'succeeded',NULL
    );
    PERFORM public.save_website_scan_page_v1(
      v_scan,v_token,v_generation,0,'https://scan-b.example/replacement','Replacement',
      'Replacement page.',encode(extensions.digest('Replacement page.','sha256'),'hex'),17,'succeeded',NULL
    );
  END
  $page_reorder$;
  $$,
  'a replacement worker can reuse a provider page index with a different URL'
);
SELECT is(
  (
    SELECT count(*)::integer FROM public.website_scan_pages p
    WHERE p.scan_id=(SELECT uuid_value FROM pg_temp.scan_068_state WHERE name='lease_two')
      AND p.page_index=0 AND p.normalized_url='https://scan-b.example/replacement'
  ),
  1,
  'page-index replacement removes stale metadata instead of inflating progress counts'
);
SELECT ok(
  public.fail_website_scan_v1(
    (SELECT uuid_value FROM pg_temp.scan_068_state WHERE name='lease_two'),
    (SELECT text_value::uuid FROM pg_temp.scan_068_state WHERE name='lease_two'),
    (SELECT integer_value FROM pg_temp.scan_068_state WHERE name='lease_two'),
    'terminal_test_failure','Terminal test failure.',false
  ),
  'the current fenced worker can record a terminal failure'
);
SELECT is(
  (
    SELECT count(*)::integer FROM public.website_scan_page_payloads payload
    JOIN public.website_scan_pages page ON page.id=payload.page_id
    WHERE page.scan_id=(SELECT uuid_value FROM pg_temp.scan_068_state WHERE name='lease_two')
  ),
  0,'terminal failure immediately purges private page Markdown'
);

-- The retained business tombstone explicitly purges scan and brain data.
UPDATE public.businesses SET deleted_at=clock_timestamp(),deletion_scheduled_for=clock_timestamp()-interval '1 day',owner_id=NULL
WHERE id='10000000-0000-4000-a068-000000000001';
UPDATE public.businesses SET cleanup_pii_scrubbed_at=clock_timestamp()
WHERE id='10000000-0000-4000-a068-000000000001';
SELECT ok(
  NOT EXISTS(SELECT 1 FROM public.website_scan_runs WHERE business_id='10000000-0000-4000-a068-000000000001')
  AND NOT EXISTS(SELECT 1 FROM public.business_knowledge_items WHERE business_id='10000000-0000-4000-a068-000000000001'),
  'permanent cleanup removes scan history and approved scan knowledge from retained tombstones'
);

SELECT * FROM finish();
ROLLBACK;
