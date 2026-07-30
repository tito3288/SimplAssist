BEGIN;

CREATE TABLE public.knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,

  question_text text NOT NULL,

  normalized_question text GENERATED ALWAYS AS (
    public.normalize_ai_knowledge_key(question_text)
  ) STORED,

  ai_response_text text NOT NULL,

  channel text NOT NULL,

  conversation_id uuid
    REFERENCES public.conversations(id) ON DELETE SET NULL,

  source_message_id uuid
    REFERENCES public.messages(id) ON DELETE SET NULL,

  occurrence_count bigint NOT NULL DEFAULT 1,

  status text NOT NULL DEFAULT 'open',

  resolved_faq_id uuid
    REFERENCES public.faqs(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT knowledge_gaps_question_not_blank
    CHECK (normalized_question <> ''),

  CONSTRAINT knowledge_gaps_response_not_blank
    CHECK (public.normalize_ai_knowledge_key(ai_response_text) <> ''),

  CONSTRAINT knowledge_gaps_channel_check
    CHECK (channel IN ('sms', 'web_chat')),

  CONSTRAINT knowledge_gaps_occurrence_count_check
    CHECK (occurrence_count > 0),

  CONSTRAINT knowledge_gaps_status_check
    CHECK (status IN ('open', 'resolved', 'dismissed')),

  CONSTRAINT knowledge_gaps_resolved_link_status_check
    CHECK (resolved_faq_id IS NULL OR status = 'resolved')
);

COMMENT ON TABLE public.knowledge_gaps IS
  'Owner-reviewed aggregates of customer questions the AI could not fully answer.';

COMMENT ON COLUMN public.knowledge_gaps.normalized_question IS
  'Trimmed, whitespace-collapsed, case-folded key used to deduplicate open gaps.';

COMMENT ON COLUMN public.knowledge_gaps.channel IS
  'Channel of the most recent occurrence represented by this row.';

COMMENT ON COLUMN public.knowledge_gaps.conversation_id IS
  'Conversation containing the most recent occurrence, when still retained.';

COMMENT ON COLUMN public.knowledge_gaps.source_message_id IS
  'Triggering customer message for the most recent occurrence, when still retained.';

CREATE UNIQUE INDEX knowledge_gaps_open_business_question_unique
  ON public.knowledge_gaps (business_id, normalized_question)
  WHERE status = 'open';

CREATE INDEX knowledge_gaps_business_status_sort_idx
  ON public.knowledge_gaps (
    business_id,
    status,
    occurrence_count DESC,
    last_seen_at DESC
  );

CREATE INDEX knowledge_gaps_conversation_idx
  ON public.knowledge_gaps (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX knowledge_gaps_source_message_idx
  ON public.knowledge_gaps (source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE INDEX knowledge_gaps_resolved_faq_idx
  ON public.knowledge_gaps (resolved_faq_id)
  WHERE resolved_faq_id IS NOT NULL;

CREATE FUNCTION public.guard_knowledge_gap_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'resolved' AND NEW.resolved_faq_id IS NULL THEN
      RAISE EXCEPTION 'A newly resolved knowledge gap must link an FAQ'
        USING ERRCODE = '23514',
              CONSTRAINT = 'knowledge_gaps_resolved_faq_required';
    END IF;
  ELSE
    IF OLD.status IN ('resolved', 'dismissed')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Terminal knowledge-gap statuses cannot be reopened'
        USING ERRCODE = '23514',
              CONSTRAINT = 'knowledge_gaps_terminal_status_immutable';
    END IF;

    IF OLD.status = 'open'
       AND NEW.status = 'resolved'
       AND NEW.resolved_faq_id IS NULL THEN
      RAISE EXCEPTION 'A resolved knowledge gap must link an FAQ'
        USING ERRCODE = '23514',
              CONSTRAINT = 'knowledge_gaps_resolved_faq_required';
    END IF;

    IF NEW IS DISTINCT FROM OLD THEN
      NEW.updated_at := now();
    ELSE
      NEW.updated_at := OLD.updated_at;
    END IF;
  END IF;

  IF NEW.conversation_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.conversations AS conversation
       WHERE conversation.id = NEW.conversation_id
         AND conversation.business_id = NEW.business_id
         AND conversation.channel = NEW.channel
     ) THEN
    RAISE EXCEPTION 'Knowledge-gap conversation does not match its business and channel'
      USING ERRCODE = '23514',
            CONSTRAINT = 'knowledge_gaps_conversation_match';
  END IF;

  IF NEW.source_message_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.messages AS message
       WHERE message.id = NEW.source_message_id
         AND message.business_id = NEW.business_id
         AND message.role = 'customer'
         AND message.channel = NEW.channel
         AND (
           NEW.conversation_id IS NULL
           OR message.conversation_id = NEW.conversation_id
         )
     ) THEN
    RAISE EXCEPTION 'Knowledge-gap source message does not match its business, conversation, and channel'
      USING ERRCODE = '23514',
            CONSTRAINT = 'knowledge_gaps_source_message_match';
  END IF;

  IF NEW.resolved_faq_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.faqs AS faq
       WHERE faq.id = NEW.resolved_faq_id
         AND faq.business_id = NEW.business_id
     ) THEN
    RAISE EXCEPTION 'Knowledge-gap FAQ does not belong to the same business'
      USING ERRCODE = '23514',
            CONSTRAINT = 'knowledge_gaps_resolved_faq_match';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_knowledge_gap_mutation
BEFORE INSERT OR UPDATE ON public.knowledge_gaps
FOR EACH ROW
EXECUTE FUNCTION public.guard_knowledge_gap_mutation();

REVOKE ALL
  ON FUNCTION public.guard_knowledge_gap_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.knowledge_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_gaps_select
ON public.knowledge_gaps
FOR SELECT
USING (
  business_id IN (
    SELECT id
    FROM public.businesses
    WHERE owner_id = auth.uid()
  )
);

CREATE POLICY knowledge_gaps_update
ON public.knowledge_gaps
FOR UPDATE
USING (
  business_id IN (
    SELECT id
    FROM public.businesses
    WHERE owner_id = auth.uid()
  )
)
WITH CHECK (
  business_id IN (
    SELECT id
    FROM public.businesses
    WHERE owner_id = auth.uid()
  )
);

REVOKE ALL
  ON TABLE public.knowledge_gaps
  FROM PUBLIC, anon, authenticated;

GRANT SELECT
  ON TABLE public.knowledge_gaps
  TO authenticated;

GRANT UPDATE (status, resolved_faq_id)
  ON TABLE public.knowledge_gaps
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.knowledge_gaps
  TO service_role;

CREATE FUNCTION public.record_knowledge_gap(
  p_business_id uuid,
  p_source_message_id uuid,
  p_ai_response_text text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_question_text text;
  v_channel text;
  v_conversation_id uuid;
  v_gap_id uuid;
BEGIN
  SELECT
    message.content,
    message.channel,
    message.conversation_id
  INTO
    v_question_text,
    v_channel,
    v_conversation_id
  FROM public.messages AS message
  JOIN public.conversations AS conversation
    ON conversation.id = message.conversation_id
  WHERE message.id = p_source_message_id
    AND message.business_id = p_business_id
    AND message.role = 'customer'
    AND conversation.business_id = p_business_id
    AND conversation.channel = message.channel;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source customer message was not found for this business'
      USING ERRCODE = '22023';
  END IF;

  IF public.normalize_ai_knowledge_key(v_question_text) = '' THEN
    RAISE EXCEPTION 'Knowledge-gap question cannot be blank'
      USING ERRCODE = '22023';
  END IF;

  IF public.normalize_ai_knowledge_key(p_ai_response_text) = '' THEN
    RAISE EXCEPTION 'Knowledge-gap AI response cannot be blank'
      USING ERRCODE = '22023';
  END IF;

  -- A delivery retry for the same durable customer message is not a new
  -- occurrence, even if the original aggregate has since become terminal.
  SELECT gap.id
  INTO v_gap_id
  FROM public.knowledge_gaps AS gap
  WHERE gap.business_id = p_business_id
    AND gap.source_message_id = p_source_message_id
  ORDER BY gap.created_at DESC, gap.id
  LIMIT 1;

  IF FOUND THEN
    RETURN v_gap_id;
  END IF;

  INSERT INTO public.knowledge_gaps AS existing (
    business_id,
    question_text,
    ai_response_text,
    channel,
    conversation_id,
    source_message_id
  )
  VALUES (
    p_business_id,
    v_question_text,
    p_ai_response_text,
    v_channel,
    v_conversation_id,
    p_source_message_id
  )
  ON CONFLICT (business_id, normalized_question)
    WHERE status = 'open'
  DO UPDATE SET
    occurrence_count =
      existing.occurrence_count
      + CASE
          WHEN existing.source_message_id
               IS DISTINCT FROM EXCLUDED.source_message_id
            THEN 1
          ELSE 0
        END,
    question_text =
      CASE
        WHEN existing.source_message_id
             IS DISTINCT FROM EXCLUDED.source_message_id
          THEN EXCLUDED.question_text
        ELSE existing.question_text
      END,
    ai_response_text =
      CASE
        WHEN existing.source_message_id
             IS DISTINCT FROM EXCLUDED.source_message_id
          THEN EXCLUDED.ai_response_text
        ELSE existing.ai_response_text
      END,
    channel =
      CASE
        WHEN existing.source_message_id
             IS DISTINCT FROM EXCLUDED.source_message_id
          THEN EXCLUDED.channel
        ELSE existing.channel
      END,
    conversation_id =
      CASE
        WHEN existing.source_message_id
             IS DISTINCT FROM EXCLUDED.source_message_id
          THEN EXCLUDED.conversation_id
        ELSE existing.conversation_id
      END,
    source_message_id =
      CASE
        WHEN existing.source_message_id
             IS DISTINCT FROM EXCLUDED.source_message_id
          THEN EXCLUDED.source_message_id
        ELSE existing.source_message_id
      END,
    last_seen_at =
      CASE
        WHEN existing.source_message_id
             IS DISTINCT FROM EXCLUDED.source_message_id
          THEN now()
        ELSE existing.last_seen_at
      END
  RETURNING id INTO v_gap_id;

  RETURN v_gap_id;
END;
$$;

REVOKE ALL
  ON FUNCTION public.record_knowledge_gap(uuid, uuid, text)
  FROM PUBLIC;

REVOKE EXECUTE
  ON FUNCTION public.record_knowledge_gap(uuid, uuid, text)
  FROM anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.record_knowledge_gap(uuid, uuid, text)
  TO service_role;

CREATE FUNCTION public.resolve_knowledge_gap_with_faq(
  p_gap_id uuid,
  p_question text,
  p_answer text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_question text := btrim(coalesce(p_question, ''));
  v_answer text := btrim(coalesce(p_answer, ''));
  v_faq_id uuid;
BEGIN
  IF public.normalize_ai_knowledge_key(v_question) = '' THEN
    RAISE EXCEPTION 'Active FAQ question cannot be blank'
      USING ERRCODE = '23514',
            CONSTRAINT = 'faqs_active_question_not_blank';
  END IF;

  IF public.normalize_ai_knowledge_key(v_answer) = '' THEN
    RAISE EXCEPTION 'Active FAQ answer cannot be blank'
      USING ERRCODE = '23514',
            CONSTRAINT = 'faqs_active_answer_not_blank';
  END IF;

  IF char_length(v_answer) > 2000 THEN
    RAISE EXCEPTION 'Active FAQ answer cannot exceed 2000 characters'
      USING ERRCODE = '23514',
            CONSTRAINT = 'faqs_active_answer_max_length';
  END IF;

  SELECT gap.business_id
  INTO v_business_id
  FROM public.knowledge_gaps AS gap
  WHERE gap.id = p_gap_id
    AND gap.status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Knowledge gap is not open or is not accessible'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.faqs (
    business_id,
    question,
    answer,
    source,
    is_active
  )
  VALUES (
    v_business_id,
    v_question,
    v_answer,
    'suggested',
    true
  )
  RETURNING id INTO v_faq_id;

  UPDATE public.knowledge_gaps
  SET
    status = 'resolved',
    resolved_faq_id = v_faq_id
  WHERE id = p_gap_id
    AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Knowledge gap changed before it could be resolved'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_faq_id;
END;
$$;

REVOKE ALL
  ON FUNCTION public.resolve_knowledge_gap_with_faq(uuid, text, text)
  FROM PUBLIC;

REVOKE EXECUTE
  ON FUNCTION public.resolve_knowledge_gap_with_faq(uuid, text, text)
  FROM anon;

GRANT EXECUTE
  ON FUNCTION public.resolve_knowledge_gap_with_faq(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.record_knowledge_gap(uuid, uuid, text) IS
  'Service-role-only capture of a model-signaled knowledge gap, with atomic open-gap deduplication.';

COMMENT ON FUNCTION public.resolve_knowledge_gap_with_faq(uuid, text, text) IS
  'Atomically creates an active suggested FAQ and resolves the owning business knowledge gap.';

COMMIT;
