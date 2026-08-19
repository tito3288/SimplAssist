BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(22);

SELECT ok(
  to_regclass('public.calendar_bookings_active_slot_lookup_idx') IS NOT NULL
  AND pg_get_indexdef(
    'public.calendar_bookings_active_slot_lookup_idx'::regclass
  ) LIKE '%WHERE (status = ANY (ARRAY[''pending''::text, ''confirmed''::text]))%',
  'active calendar slots have a partial overlap lookup index'
);

SELECT ok(
  (
    SELECT procedure.prosecdef
      AND procedure.proconfig =
        ARRAY['search_path=public, pg_temp']::text[]
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'public.reserve_calendar_booking(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text,text)'::regprocedure
  )
  AND pg_get_functiondef(
    'public.reserve_calendar_booking(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text,text)'::regprocedure
  ) LIKE ALL (ARRAY[
    '%FROM public.businesses AS business%',
    '%FOR UPDATE%',
    '%IF FOUND THEN%',
    '%conflicting_booking.status IN (''pending'', ''confirmed'')%',
    '%conflicting_booking.id <> v_booking.id%',
    '%booking.starts_at < p_ends_at%',
    '%booking.ends_at > p_starts_at%',
    '%calendar_booking_slot_unavailable%',
    '%ERRCODE = ''23P01''%'
  ]),
  'reservation serializes on the business and rejects half-open active-slot overlap'
);

SELECT ok(
  (
    SELECT procedure.prosecdef
      AND procedure.proconfig =
        ARRAY['search_path=public, pg_temp']::text[]
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'public.confirm_calendar_booking(uuid,uuid,text,timestamptz,timestamptz,uuid)'::regprocedure
  )
  AND pg_get_functiondef(
    'public.confirm_calendar_booking(uuid,uuid,text,timestamptz,timestamptz,uuid)'::regprocedure
  ) LIKE ALL (ARRAY[
    '%FROM public.businesses AS business%',
    '%FOR UPDATE%',
    '%conflicting_booking.google_calendar_id =%',
    '%v_booking.google_calendar_id%',
    '%conflicting_booking.starts_at < p_ends_at%',
    '%conflicting_booking.ends_at > p_starts_at%',
    '%calendar_booking_slot_unavailable%',
    '%ERRCODE = ''23P01''%'
  ]),
  'confirmation uses the same business-first lock and rejects provider time overlap'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.reserve_calendar_booking(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.reserve_calendar_booking(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.reserve_calendar_booking(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.confirm_calendar_booking(uuid,uuid,text,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.confirm_calendar_booking(uuid,uuid,text,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ),
  'slot serialization preserves service-only reservation and confirmation boundaries'
);

INSERT INTO auth.users (id, email)
VALUES (
  '00000000-0000-4000-a062-000000000001',
  'calendar-slot-a062@example.test'
);

UPDATE public.businesses
SET id = '10000000-0000-4000-a062-000000000001',
    name = 'Calendar Slot Test 062',
    slug = 'calendar-slot-test-a062'
WHERE owner_id = '00000000-0000-4000-a062-000000000001';

INSERT INTO public.google_calendar_tokens (
  id,
  business_id,
  access_token,
  refresh_token,
  token_expiry,
  calendar_id,
  google_email,
  created_at,
  updated_at
) VALUES (
  '62000000-0000-4000-a062-000000000001',
  '10000000-0000-4000-a062-000000000001',
  'fixture-access-a062-1',
  'fixture-refresh-a062-1',
  '2099-01-01 00:00:00+00',
  'primary',
  'calendar-slot-a062@example.test',
  '2039-01-01 00:00:00+00',
  '2039-01-01 00:00:00+00'
);

INSERT INTO public.contacts (
  id,
  business_id,
  name,
  email,
  source_channel,
  lead_score
) VALUES (
  '20000000-0000-4000-a062-000000000001',
  '10000000-0000-4000-a062-000000000001',
  'Calendar Slot Contact',
  'calendar-slot-contact-a062@example.test',
  'web_chat',
  0
);

INSERT INTO public.conversations (
  id,
  business_id,
  contact_id,
  channel,
  status,
  is_ai_handling
) VALUES (
  '30000000-0000-4000-a062-000000000001',
  '10000000-0000-4000-a062-000000000001',
  '20000000-0000-4000-a062-000000000001',
  'web_chat',
  'active',
  true
);

INSERT INTO public.messages (
  id,
  conversation_id,
  business_id,
  role,
  content,
  channel
) VALUES
  (
    '40000000-0000-4000-a062-000000000001',
    '30000000-0000-4000-a062-000000000001',
    '10000000-0000-4000-a062-000000000001',
    'customer',
    'Reserve the first slot.',
    'web_chat'
  ),
  (
    '40000000-0000-4000-a062-000000000002',
    '30000000-0000-4000-a062-000000000001',
    '10000000-0000-4000-a062-000000000001',
    'customer',
    'Reserve the replacement slot.',
    'web_chat'
  ),
  (
    '40000000-0000-4000-a062-000000000003',
    '30000000-0000-4000-a062-000000000001',
    '10000000-0000-4000-a062-000000000001',
    'customer',
    'Reserve the adjacent slot.',
    'web_chat'
  ),
  (
    '40000000-0000-4000-a062-000000000004',
    '30000000-0000-4000-a062-000000000001',
    '10000000-0000-4000-a062-000000000001',
    'customer',
    'Reserve the other calendar.',
    'web_chat'
  ),
  (
    '40000000-0000-4000-a062-000000000005',
    '30000000-0000-4000-a062-000000000001',
    '10000000-0000-4000-a062-000000000001',
    'customer',
    'Try the confirmed slot.',
    'web_chat'
  ),
  (
    '40000000-0000-4000-a062-000000000006',
    '30000000-0000-4000-a062-000000000001',
    '10000000-0000-4000-a062-000000000001',
    'customer',
    'Retry a failed booking after its selected calendar changes.',
    'web_chat'
  ),
  (
    '40000000-0000-4000-a062-000000000007',
    '30000000-0000-4000-a062-000000000001',
    '10000000-0000-4000-a062-000000000001',
    'customer',
    'Reserve the durable secondary-calendar conflict.',
    'web_chat'
  );

SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$
    SELECT public.reserve_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_contact_id => '20000000-0000-4000-a062-000000000001',
      p_conversation_id => '30000000-0000-4000-a062-000000000001',
      p_source_message_id => '40000000-0000-4000-a062-000000000001',
      p_starts_at => '2039-09-10T14:00:00Z',
      p_ends_at => '2039-09-10T14:30:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000001',
      p_google_calendar_id => 'primary',
      p_event_summary => 'First Slot',
      p_request_fingerprint =>
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  $$,
  'the first active slot is reserved'
);

SELECT throws_ok(
  $$
    SELECT public.reserve_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_contact_id => '20000000-0000-4000-a062-000000000001',
      p_conversation_id => '30000000-0000-4000-a062-000000000001',
      p_source_message_id => '40000000-0000-4000-a062-000000000002',
      p_starts_at => '2039-09-10T14:15:00Z',
      p_ends_at => '2039-09-10T14:45:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000002',
      p_google_calendar_id => 'primary',
      p_event_summary => 'Overlapping Slot',
      p_request_fingerprint =>
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )
  $$,
  '23P01',
  'calendar_booking_slot_unavailable',
  'a pending local reservation blocks an overlapping source message'
);

SELECT lives_ok(
  $$
    SELECT public.reserve_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_contact_id => '20000000-0000-4000-a062-000000000001',
      p_conversation_id => '30000000-0000-4000-a062-000000000001',
      p_source_message_id => '40000000-0000-4000-a062-000000000003',
      p_starts_at => '2039-09-10T14:30:00Z',
      p_ends_at => '2039-09-10T15:00:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000003',
      p_google_calendar_id => 'primary',
      p_event_summary => 'Adjacent Slot',
      p_request_fingerprint =>
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    )
  $$,
  'half-open slot boundaries allow an immediately adjacent booking'
);

SELECT lives_ok(
  $$
    SELECT public.reserve_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_contact_id => '20000000-0000-4000-a062-000000000001',
      p_conversation_id => '30000000-0000-4000-a062-000000000001',
      p_source_message_id => '40000000-0000-4000-a062-000000000004',
      p_starts_at => '2039-09-10T14:15:00Z',
      p_ends_at => '2039-09-10T14:45:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000004',
      p_google_calendar_id => 'secondary',
      p_event_summary => 'Other Calendar',
      p_request_fingerprint =>
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    )
  $$,
  'the same time remains available on a different Google calendar'
);

SELECT lives_ok(
  $$
    SELECT public.fail_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_booking_id => (
        SELECT booking.id
        FROM public.calendar_bookings AS booking
        WHERE booking.source_message_id =
          '40000000-0000-4000-a062-000000000001'
      ),
      p_claim_token => '50000000-0000-4000-a062-000000000001',
      p_failure_reason => 'Provider slot unavailable.'
    )
  $$,
  'failing a pending reservation releases its local active slot'
);

SELECT lives_ok(
  $$
    SELECT public.reserve_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_contact_id => '20000000-0000-4000-a062-000000000001',
      p_conversation_id => '30000000-0000-4000-a062-000000000001',
      p_source_message_id => '40000000-0000-4000-a062-000000000002',
      p_starts_at => '2039-09-10T14:00:00Z',
      p_ends_at => '2039-09-10T14:30:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000002',
      p_google_calendar_id => 'primary',
      p_event_summary => 'Replacement Slot',
      p_request_fingerprint =>
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )
  $$,
  'a distinct source may reserve the released slot'
);

SELECT lives_ok(
  $$
    SELECT public.confirm_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_booking_id => (
        SELECT booking.id
        FROM public.calendar_bookings AS booking
        WHERE booking.source_message_id =
          '40000000-0000-4000-a062-000000000002'
      ),
      p_google_event_id => 'google-event-a062',
      p_starts_at => '2039-09-10T14:00:00Z',
      p_ends_at => '2039-09-10T14:30:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000002'
    )
  $$,
  'the replacement reservation can be durably confirmed'
);

SELECT throws_ok(
  $$
    SELECT public.reserve_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_contact_id => '20000000-0000-4000-a062-000000000001',
      p_conversation_id => '30000000-0000-4000-a062-000000000001',
      p_source_message_id => '40000000-0000-4000-a062-000000000005',
      p_starts_at => '2039-09-10T14:00:00Z',
      p_ends_at => '2039-09-10T14:30:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000005',
      p_google_calendar_id => 'primary',
      p_event_summary => 'Confirmed Conflict',
      p_request_fingerprint =>
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    )
  $$,
  '23P01',
  'calendar_booking_slot_unavailable',
  'a confirmed local booking continues to block its slot'
);

SELECT lives_ok(
  $$
    SELECT public.reserve_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_contact_id => '20000000-0000-4000-a062-000000000001',
      p_conversation_id => '30000000-0000-4000-a062-000000000001',
      p_source_message_id => '40000000-0000-4000-a062-000000000002',
      p_starts_at => '2039-09-10T14:30:00Z',
      p_ends_at => '2039-09-10T15:00:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000099',
      p_google_calendar_id => 'primary',
      p_event_summary => 'Changed Retry Overlaps Adjacent Slot',
      p_request_fingerprint =>
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    )
  $$,
  'a confirmed retry returns its result before mutable input overlap checks'
);

SELECT lives_ok(
  $$
    SELECT public.reserve_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_contact_id => '20000000-0000-4000-a062-000000000001',
      p_conversation_id => '30000000-0000-4000-a062-000000000001',
      p_source_message_id => '40000000-0000-4000-a062-000000000005',
      p_starts_at => '2039-09-10T15:00:00Z',
      p_ends_at => '2039-09-10T15:30:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000005',
      p_google_calendar_id => 'primary',
      p_event_summary => 'Provider Shift Candidate',
      p_request_fingerprint =>
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    )
  $$,
  'a non-overlapping slot may proceed to provider confirmation'
);

SELECT throws_ok(
  $$
    SELECT public.confirm_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_booking_id => (
        SELECT booking.id
        FROM public.calendar_bookings AS booking
        WHERE booking.source_message_id =
          '40000000-0000-4000-a062-000000000005'
      ),
      p_google_event_id => 'google-shifted-a062',
      p_starts_at => '2039-09-10T14:45:00Z',
      p_ends_at => '2039-09-10T15:15:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000005'
    )
  $$,
  '23P01',
  'calendar_booking_slot_unavailable',
  'provider-returned times cannot move confirmation into an active slot'
);

SELECT lives_ok(
  $$
    SELECT public.reserve_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_contact_id => '20000000-0000-4000-a062-000000000001',
      p_conversation_id => '30000000-0000-4000-a062-000000000001',
      p_source_message_id => '40000000-0000-4000-a062-000000000006',
      p_starts_at => '2039-09-10T15:00:00Z',
      p_ends_at => '2039-09-10T15:30:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000006',
      p_google_calendar_id => 'secondary',
      p_event_summary => 'Failed Secondary Slot',
      p_request_fingerprint =>
        '6666666666666666666666666666666666666666666666666666666666666666'
    )
  $$,
  'a secondary-calendar reservation is created before a failed attempt'
);

SELECT lives_ok(
  $$
    SELECT public.fail_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_booking_id => (
        SELECT booking.id
        FROM public.calendar_bookings AS booking
        WHERE booking.source_message_id =
          '40000000-0000-4000-a062-000000000006'
      ),
      p_claim_token => '50000000-0000-4000-a062-000000000006',
      p_failure_reason => 'Provider request failed.'
    )
  $$,
  'the secondary-calendar attempt is durably failed'
);

SELECT lives_ok(
  $$
    SELECT public.reserve_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_contact_id => '20000000-0000-4000-a062-000000000001',
      p_conversation_id => '30000000-0000-4000-a062-000000000001',
      p_source_message_id => '40000000-0000-4000-a062-000000000007',
      p_starts_at => '2039-09-10T15:00:00Z',
      p_ends_at => '2039-09-10T15:30:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000007',
      p_google_calendar_id => 'secondary',
      p_event_summary => 'Live Secondary Conflict',
      p_request_fingerprint =>
        '7777777777777777777777777777777777777777777777777777777777777777'
    )
  $$,
  'another source can later occupy the failed secondary-calendar slot'
);

SELECT throws_ok(
  $$
    SELECT public.reserve_calendar_booking(
      p_business_id => '10000000-0000-4000-a062-000000000001',
      p_contact_id => '20000000-0000-4000-a062-000000000001',
      p_conversation_id => '30000000-0000-4000-a062-000000000001',
      p_source_message_id => '40000000-0000-4000-a062-000000000006',
      p_starts_at => '2039-09-10T15:00:00Z',
      p_ends_at => '2039-09-10T15:30:00Z',
      p_claim_token => '50000000-0000-4000-a062-000000000066',
      p_google_calendar_id => 'tertiary',
      p_event_summary => 'Changed Calendar Retry',
      p_request_fingerprint =>
        '6666666666666666666666666666666666666666666666666666666666666666'
    )
  $$,
  '23P01',
  'calendar_booking_slot_unavailable',
  'failed retry checks its durable calendar rather than mutable selected calendar'
);

RESET ROLE;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = '10000000-0000-4000-a062-000000000001'
      AND booking.source_message_id =
        '40000000-0000-4000-a062-000000000002'
  ),
  1,
  'confirmed idempotent retries cannot duplicate the booking row'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = '10000000-0000-4000-a062-000000000001'
      AND booking.google_calendar_id = 'primary'
      AND booking.status IN ('pending', 'confirmed')
  ),
  3,
  'confirmed, adjacent, and provider-shift candidate slots remain active on primary'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = '10000000-0000-4000-a062-000000000001'
      AND booking.status = 'failed'
  ),
  2,
  'released and superseded reservations remain as durable failed history'
);

DELETE FROM public.calendar_bookings
WHERE business_id = '10000000-0000-4000-a062-000000000001';

DELETE FROM public.google_calendar_tokens
WHERE id = '62000000-0000-4000-a062-000000000001'
  AND business_id = '10000000-0000-4000-a062-000000000001';

SELECT * FROM finish();

ROLLBACK;
