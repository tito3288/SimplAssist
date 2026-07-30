BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(12);

-- Simulate rows that existed before 039: the runtime lead guard and identity
-- promotion trigger did not exist while those contacts and messages were
-- written. These trigger state changes and every fixture roll back at the end.
ALTER TABLE public.contacts
  DISABLE TRIGGER guard_contact_lead_fields;
ALTER TABLE public.contacts
  DISABLE TRIGGER promote_contact_info_lead;

INSERT INTO auth.users (id, email)
VALUES (
  '00000000-0000-4000-a039-000000000101',
  'hot-lead-backfill-039@example.test'
);

UPDATE public.businesses
SET id = '10000000-0000-4000-a039-000000000101',
    name = 'Hot Lead Backfill 039',
    slug = 'hot-lead-backfill-039'
WHERE owner_id = '00000000-0000-4000-a039-000000000101';

INSERT INTO public.contacts (
  id,
  business_id,
  name,
  phone_number,
  email,
  provided_phone_number,
  source_channel,
  lead_score,
  created_at,
  last_contacted_at
) VALUES
  (
    '20000000-0000-4000-a039-000000000101',
    '10000000-0000-4000-a039-000000000101',
    NULL,
    NULL,
    NULL,
    NULL,
    'web_chat',
    7,
    '2039-01-01T10:00:00Z',
    '2039-01-02T10:00:00Z'
  ),
  (
    '20000000-0000-4000-a039-000000000102',
    '10000000-0000-4000-a039-000000000101',
    NULL,
    NULL,
    NULL,
    NULL,
    'web_chat',
    6,
    '2039-01-01T10:00:00Z',
    '2039-01-02T10:00:00Z'
  ),
  (
    '20000000-0000-4000-a039-000000000103',
    '10000000-0000-4000-a039-000000000101',
    NULL,
    NULL,
    NULL,
    NULL,
    'web_chat',
    4,
    '2039-01-01T10:00:00Z',
    '2039-01-02T10:00:00Z'
  ),
  (
    '20000000-0000-4000-a039-000000000104',
    '10000000-0000-4000-a039-000000000101',
    NULL,
    NULL,
    NULL,
    NULL,
    'web_chat',
    3,
    '2039-01-01T10:00:00Z',
    '2039-01-02T10:00:00Z'
  ),
  (
    '20000000-0000-4000-a039-000000000105',
    '10000000-0000-4000-a039-000000000101',
    NULL,
    NULL,
    ' Legacy.Person@Example.COM ',
    NULL,
    'web_chat',
    0,
    '2039-01-01T10:00:00Z',
    '2039-01-02T10:00:00Z'
  ),
  (
    '20000000-0000-4000-a039-000000000106',
    '10000000-0000-4000-a039-000000000101',
    NULL,
    NULL,
    'not-an-email',
    NULL,
    'web_chat',
    0,
    '2039-01-01T10:00:00Z',
    '2039-01-02T10:00:00Z'
  ),
  (
    '20000000-0000-4000-a039-000000000107',
    '10000000-0000-4000-a039-000000000101',
    NULL,
    NULL,
    NULL,
    NULL,
    'web_chat',
    0,
    '2039-01-01T10:00:00Z',
    '2039-01-02T10:00:00Z'
  ),
  (
    '20000000-0000-4000-a039-000000000108',
    '10000000-0000-4000-a039-000000000101',
    NULL,
    '+13175550108',
    NULL,
    NULL,
    'sms',
    0,
    '2039-01-01T10:00:00Z',
    '2039-01-02T10:00:00Z'
  ),
  (
    '20000000-0000-4000-a039-000000000109',
    '10000000-0000-4000-a039-000000000101',
    NULL,
    NULL,
    NULL,
    NULL,
    'web_chat',
    0,
    '2039-01-01T10:00:00Z',
    '2039-01-02T10:00:00Z'
  ),
  (
    '20000000-0000-4000-a039-000000000110',
    '10000000-0000-4000-a039-000000000101',
    NULL,
    NULL,
    NULL,
    NULL,
    'web_chat',
    0,
    '2039-01-01T10:00:00Z',
    '2039-01-02T10:00:00Z'
  ),
  (
    '20000000-0000-4000-a039-000000000111',
    '10000000-0000-4000-a039-000000000101',
    NULL,
    NULL,
    NULL,
    NULL,
    'web_chat',
    0,
    '2039-01-01T10:00:00Z',
    '2039-01-02T10:00:00Z'
  );

INSERT INTO public.conversations (
  id,
  business_id,
  contact_id,
  channel,
  status,
  is_ai_handling
) VALUES
  (
    '30000000-0000-4000-a039-000000000106',
    '10000000-0000-4000-a039-000000000101',
    '20000000-0000-4000-a039-000000000106',
    'web_chat',
    'active',
    true
  ),
  (
    '30000000-0000-4000-a039-000000000107',
    '10000000-0000-4000-a039-000000000101',
    '20000000-0000-4000-a039-000000000107',
    'web_chat',
    'active',
    true
  ),
  (
    '30000000-0000-4000-a039-000000000108',
    '10000000-0000-4000-a039-000000000101',
    '20000000-0000-4000-a039-000000000108',
    'sms',
    'active',
    true
  ),
  (
    '30000000-0000-4000-a039-000000000109',
    '10000000-0000-4000-a039-000000000101',
    '20000000-0000-4000-a039-000000000109',
    'web_chat',
    'active',
    true
  ),
  (
    '30000000-0000-4000-a039-000000000110',
    '10000000-0000-4000-a039-000000000101',
    '20000000-0000-4000-a039-000000000110',
    'web_chat',
    'active',
    true
  ),
  (
    '30000000-0000-4000-a039-000000000111',
    '10000000-0000-4000-a039-000000000101',
    '20000000-0000-4000-a039-000000000111',
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
  channel,
  created_at
) VALUES
  (
    '40000000-0000-4000-a039-000000000106',
    '30000000-0000-4000-a039-000000000106',
    '10000000-0000-4000-a039-000000000101',
    'customer',
    'Keep the legacy field, but email me at transcript@example.test.',
    'web_chat',
    '2039-01-03T10:00:00Z'
  ),
  (
    '40000000-0000-4000-a039-000000000107',
    '30000000-0000-4000-a039-000000000107',
    '10000000-0000-4000-a039-000000000101',
    'customer',
    'You can reach me at (317) 555-0107.',
    'web_chat',
    '2039-01-03T10:00:00Z'
  ),
  (
    '40000000-0000-4000-a039-000000000108',
    '30000000-0000-4000-a039-000000000108',
    '10000000-0000-4000-a039-000000000101',
    'customer',
    'This is urgent.',
    'sms',
    '2039-01-03T10:00:00Z'
  ),
  (
    '40000000-0000-4000-a039-000000000109',
    '30000000-0000-4000-a039-000000000109',
    '10000000-0000-4000-a039-000000000101',
    'customer',
    'How much does this service cost?',
    'web_chat',
    '2039-01-03T10:00:00Z'
  ),
  (
    '40000000-0000-4000-a039-000000000110',
    '30000000-0000-4000-a039-000000000110',
    '10000000-0000-4000-a039-000000000101',
    'customer',
    'Hello there.',
    'web_chat',
    '2039-01-03T10:00:00Z'
  ),
  (
    '40000000-0000-4000-a039-000000000112',
    '30000000-0000-4000-a039-000000000110',
    '10000000-0000-4000-a039-000000000101',
    'customer',
    'Can somebody assist?',
    'web_chat',
    '2039-01-03T10:01:00Z'
  ),
  (
    '40000000-0000-4000-a039-000000000111',
    '30000000-0000-4000-a039-000000000111',
    '10000000-0000-4000-a039-000000000101',
    'assistant',
    'URGENT: email assistant@example.test or call (317) 555-0111 for a quote.',
    'web_chat',
    '2039-01-03T10:00:00Z'
  );

-- Exact 039 historical extraction backfill.
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

-- Exact 039 historical tier-classification backfill.
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

ALTER TABLE public.contacts
  ENABLE TRIGGER guard_contact_lead_fields;
ALTER TABLE public.contacts
  ENABLE TRIGGER promote_contact_info_lead;

-- 1
SELECT is(
  (
    SELECT lead_status
    FROM public.contacts
    WHERE id = '20000000-0000-4000-a039-000000000101'
  ),
  'hot',
  'legacy lead_score 7 backfills to HOT'
);

-- 2
SELECT is(
  (
    SELECT lead_status
    FROM public.contacts
    WHERE id = '20000000-0000-4000-a039-000000000102'
  ),
  'warm',
  'legacy lead_score 6 backfills to WARM'
);

-- 3
SELECT is(
  (
    SELECT lead_status
    FROM public.contacts
    WHERE id = '20000000-0000-4000-a039-000000000103'
  ),
  'warm',
  'legacy lead_score 4 backfills to WARM'
);

-- 4
SELECT is(
  (
    SELECT lead_status
    FROM public.contacts
    WHERE id = '20000000-0000-4000-a039-000000000104'
  ),
  'normal',
  'legacy lead_score below 4 backfills to NORMAL'
);

-- 5
SELECT ok(
  (
    SELECT lead_status = 'hot'
       AND email = ' Legacy.Person@Example.COM '
    FROM public.contacts
    WHERE id = '20000000-0000-4000-a039-000000000105'
  ),
  'valid stored email backfills HOT without rewriting its legacy value'
);

-- 6
SELECT ok(
  (
    SELECT lead_status = 'hot'
       AND email = 'not-an-email'
    FROM public.contacts
    WHERE id = '20000000-0000-4000-a039-000000000106'
  ),
  'valid customer transcript email backfills HOT while preserving invalid stored email'
);

-- 7
SELECT ok(
  (
    SELECT lead_status = 'hot'
       AND provided_phone_number = '+13175550107'
    FROM public.contacts
    WHERE id = '20000000-0000-4000-a039-000000000107'
  ),
  'customer transcript phone is persisted and backfills HOT'
);

-- 8
SELECT is(
  (
    SELECT lead_status
    FROM public.contacts
    WHERE id = '20000000-0000-4000-a039-000000000108'
  ),
  'hot',
  'urgent customer intent plus existing identity backfills HOT'
);

-- 9
SELECT is(
  (
    SELECT lead_status
    FROM public.contacts
    WHERE id = '20000000-0000-4000-a039-000000000109'
  ),
  'warm',
  'customer service intent backfills WARM'
);

-- 10
SELECT is(
  (
    SELECT lead_status
    FROM public.contacts
    WHERE id = '20000000-0000-4000-a039-000000000110'
  ),
  'warm',
  'two customer messages with a question backfill WARM'
);

-- 11
SELECT ok(
  (
    SELECT lead_status = 'normal'
       AND email IS NULL
       AND provided_phone_number IS NULL
    FROM public.contacts
    WHERE id = '20000000-0000-4000-a039-000000000111'
  ),
  'assistant-only identity and intent text is ignored by backfill'
);

-- 12
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.lead_events
    WHERE business_id = '10000000-0000-4000-a039-000000000101'
      AND event_type = 'became_hot'
  ),
  0,
  'historical backfill emits no became-HOT audit events'
);

SELECT * FROM finish();

ROLLBACK;
