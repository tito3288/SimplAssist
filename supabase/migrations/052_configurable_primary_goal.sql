BEGIN;

-- ---------------------------------------------------------------------------
-- Business goal configuration.
--
-- The temporary DEFAULT backfills every row present at migration cutover
-- without firing businesses' generic updated_at trigger. Dropping the default
-- before commit means every business created after cutover receives NULL and
-- must explicitly answer the onboarding question.
-- ---------------------------------------------------------------------------

ALTER TABLE public.businesses
  ADD COLUMN primary_goal text DEFAULT 'book',
  ADD COLUMN goal_url text;

ALTER TABLE public.businesses
  ALTER COLUMN primary_goal DROP DEFAULT;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_primary_goal_check
  CHECK (
    primary_goal IS NULL
    OR primary_goal IN ('book', 'signup', 'quote', 'callback')
  ),

  ADD CONSTRAINT businesses_goal_url_https_check
  CHECK (
    goal_url IS NULL
    OR (
      goal_url = btrim(goal_url)
      AND char_length(goal_url) BETWEEN 9 AND 2048
      AND goal_url
        ~ '^https://[^[:space:]/?#]+([/?#][^[:space:]]*)?$'
    )
  ),

  ADD CONSTRAINT businesses_signup_goal_url_required
  CHECK (
    primary_goal IS DISTINCT FROM 'signup'
    OR goal_url IS NOT NULL
    OR cleanup_pii_scrubbed_at IS NOT NULL
  ),

  ADD CONSTRAINT businesses_scrubbed_goal_url_null
  CHECK (
    cleanup_pii_scrubbed_at IS NULL
    OR goal_url IS NULL
  );

COMMENT ON COLUMN public.businesses.primary_goal IS
  'Primary customer outcome. NULL means a post-cutover business has not explicitly completed the required goal choice; businesses present at cutover were grandfathered to book. No database default is intentional.';

COMMENT ON COLUMN public.businesses.goal_url IS
  'Single HTTPS destination offered for signup goals. Customer-supplied identifying data that is removed during permanent account cleanup.';

-- Permanent cleanup retains the business row as a tombstone. Keep the
-- categorical primary_goal for anonymous historical interpretation, but
-- remove the customer-supplied URL atomically when the existing cleanup
-- lifecycle marks PII as scrubbed.
CREATE FUNCTION public.scrub_business_goal_url_on_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.cleanup_pii_scrubbed_at IS NOT NULL THEN
    NEW.goal_url := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER scrub_business_goal_url_on_cleanup
BEFORE INSERT OR UPDATE
ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.scrub_business_goal_url_on_cleanup();

REVOKE ALL
  ON FUNCTION public.scrub_business_goal_url_on_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Authoritative goal-event ledger.
--
-- Provenance columns are nullable only so an event and its honest historical
-- count survive later deletion of the related contact, conversation, or
-- message. The insert validator requires every reference initially.
-- ---------------------------------------------------------------------------

CREATE TABLE public.goal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,

  contact_id uuid
    REFERENCES public.contacts(id) ON DELETE SET NULL,

  conversation_id uuid
    REFERENCES public.conversations(id) ON DELETE SET NULL,

  source_message_id uuid
    REFERENCES public.messages(id) ON DELETE SET NULL,

  assistant_message_id uuid
    REFERENCES public.messages(id) ON DELETE SET NULL,

  goal_at_event text NOT NULL,
  event_type text NOT NULL,
  channel text NOT NULL,

  occurred_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT goal_events_goal_check
    CHECK (
      goal_at_event IN ('book', 'signup', 'quote', 'callback')
    ),

  CONSTRAINT goal_events_type_check
    CHECK (event_type = 'link_sent'),

  CONSTRAINT goal_events_channel_check
    CHECK (channel IN ('sms', 'web_chat')),

  CONSTRAINT goal_events_link_sent_goal_check
    CHECK (
      event_type <> 'link_sent'
      OR goal_at_event = 'signup'
    ),

  CONSTRAINT goal_events_idempotency_key_check
    CHECK (
      idempotency_key = btrim(idempotency_key)
      AND char_length(idempotency_key) BETWEEN 1 AND 256
    )
);

COMMENT ON TABLE public.goal_events IS
  'Authoritative customer-visible history of finalized primary-goal actions. Contains no message content, URL, phone number, or provider delivery identifier.';

COMMENT ON COLUMN public.goal_events.goal_at_event IS
  'Primary goal captured for the handled inbound turn. It is intentionally not derived later from businesses.primary_goal.';

COMMENT ON COLUMN public.goal_events.occurred_at IS
  'Successful action time supplied by the post-delivery recorder; retained separately from database insertion time.';

COMMENT ON COLUMN public.goal_events.idempotency_key IS
  'Opaque per-business finalization key. Must not contain URLs, contact data, message content, or raw provider identifiers.';

CREATE UNIQUE INDEX goal_events_business_idempotency_unique
  ON public.goal_events (business_id, idempotency_key);

CREATE UNIQUE INDEX goal_events_assistant_type_unique
  ON public.goal_events (assistant_message_id, event_type)
  WHERE assistant_message_id IS NOT NULL;

CREATE INDEX goal_events_business_occurred_idx
  ON public.goal_events (business_id, occurred_at DESC, id DESC);

CREATE INDEX goal_events_contact_idx
  ON public.goal_events (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX goal_events_conversation_idx
  ON public.goal_events (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX goal_events_source_message_idx
  ON public.goal_events (source_message_id)
  WHERE source_message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Initial and continuing tenant integrity.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.validate_goal_event_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND (
       NEW.contact_id IS NULL
       OR NEW.conversation_id IS NULL
       OR NEW.source_message_id IS NULL
       OR NEW.assistant_message_id IS NULL
     ) THEN
    RAISE EXCEPTION
      'goal event requires contact, conversation, source message, and assistant message linkage'
      USING ERRCODE = '23514',
            CONSTRAINT = 'goal_events_initial_linkage_required';
  END IF;

  IF NEW.contact_id IS NOT NULL THEN
    PERFORM 1
    FROM public.contacts AS contact
    WHERE contact.id = NEW.contact_id
      AND contact.business_id = NEW.business_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'goal event contact tenant mismatch'
        USING ERRCODE = '23514',
              CONSTRAINT = 'goal_events_contact_match';
    END IF;
  END IF;

  IF NEW.conversation_id IS NOT NULL THEN
    PERFORM 1
    FROM public.conversations AS conversation
    WHERE conversation.id = NEW.conversation_id
      AND conversation.business_id = NEW.business_id
      AND (
        NEW.contact_id IS NULL
        OR conversation.contact_id = NEW.contact_id
      )
      AND conversation.channel = NEW.channel
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'goal event conversation tenant mismatch'
        USING ERRCODE = '23514',
              CONSTRAINT = 'goal_events_conversation_match';
    END IF;
  END IF;

  IF NEW.source_message_id IS NOT NULL THEN
    PERFORM 1
    FROM public.messages AS message
    WHERE message.id = NEW.source_message_id
      AND message.business_id = NEW.business_id
      AND message.conversation_id = NEW.conversation_id
      AND message.channel = NEW.channel
      AND message.role = 'customer'
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'goal event source message tenant mismatch'
        USING ERRCODE = '23514',
              CONSTRAINT = 'goal_events_source_message_match';
    END IF;
  END IF;

  IF NEW.assistant_message_id IS NOT NULL THEN
    PERFORM 1
    FROM public.messages AS message
    WHERE message.id = NEW.assistant_message_id
      AND message.business_id = NEW.business_id
      AND message.conversation_id = NEW.conversation_id
      AND message.channel = NEW.channel
      AND message.role = 'assistant'
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'goal event assistant message tenant mismatch'
        USING ERRCODE = '23514',
              CONSTRAINT = 'goal_events_assistant_message_match';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_goal_event_tenant
BEFORE INSERT OR UPDATE
ON public.goal_events
FOR EACH ROW
EXECUTE FUNCTION public.validate_goal_event_tenant();

REVOKE ALL
  ON FUNCTION public.validate_goal_event_tenant()
  FROM PUBLIC, anon, authenticated, service_role;

-- Core event history is immutable. Only provenance references may move from
-- a retained value to NULL as their parent records are deleted.
CREATE FUNCTION public.guard_goal_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(
       NEW.id,
       NEW.business_id,
       NEW.goal_at_event,
       NEW.event_type,
       NEW.channel,
       NEW.occurred_at,
       NEW.idempotency_key,
       NEW.created_at
     ) IS DISTINCT FROM ROW(
       OLD.id,
       OLD.business_id,
       OLD.goal_at_event,
       OLD.event_type,
       OLD.channel,
       OLD.occurred_at,
       OLD.idempotency_key,
       OLD.created_at
     )
     OR (
       NEW.contact_id IS DISTINCT FROM OLD.contact_id
       AND NOT (
         OLD.contact_id IS NOT NULL
         AND NEW.contact_id IS NULL
       )
     )
     OR (
       NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
       AND NOT (
         OLD.conversation_id IS NOT NULL
         AND NEW.conversation_id IS NULL
       )
     )
     OR (
       NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
       AND NOT (
         OLD.source_message_id IS NOT NULL
         AND NEW.source_message_id IS NULL
       )
     )
     OR (
       NEW.assistant_message_id IS DISTINCT FROM OLD.assistant_message_id
       AND NOT (
         OLD.assistant_message_id IS NOT NULL
         AND NEW.assistant_message_id IS NULL
       )
     ) THEN
    RAISE EXCEPTION
      'goal event history is immutable; retained linkages may only be cleared'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_goal_event_mutation
BEFORE UPDATE
ON public.goal_events
FOR EACH ROW
EXECUTE FUNCTION public.guard_goal_event_mutation();

REVOKE ALL
  ON FUNCTION public.guard_goal_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

-- Prevent initially valid event provenance from drifting when an authenticated
-- owner updates linkage-bearing parent records.
CREATE FUNCTION public.guard_contact_goal_event_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(NEW.id, NEW.business_id)
     IS DISTINCT FROM ROW(OLD.id, OLD.business_id)
     AND EXISTS (
       SELECT 1
       FROM public.goal_events
       WHERE contact_id = OLD.id
     ) THEN
    RAISE EXCEPTION
      'contact linkage is immutable while goal events exist'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_conversation_goal_event_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(NEW.id, NEW.business_id, NEW.contact_id, NEW.channel)
     IS DISTINCT FROM
        ROW(OLD.id, OLD.business_id, OLD.contact_id, OLD.channel)
     AND EXISTS (
       SELECT 1
       FROM public.goal_events
       WHERE conversation_id = OLD.id
     ) THEN
    RAISE EXCEPTION
      'conversation linkage is immutable while goal events exist'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_message_goal_event_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(NEW.id, NEW.business_id, NEW.conversation_id, NEW.role, NEW.channel)
     IS DISTINCT FROM
        ROW(OLD.id, OLD.business_id, OLD.conversation_id, OLD.role, OLD.channel)
     AND EXISTS (
       SELECT 1
       FROM public.goal_events
       WHERE source_message_id = OLD.id
          OR assistant_message_id = OLD.id
     ) THEN
    RAISE EXCEPTION
      'message linkage is immutable while goal events exist'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_contact_goal_event_linkage
BEFORE UPDATE OF id, business_id
ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.guard_contact_goal_event_linkage();

CREATE TRIGGER guard_conversation_goal_event_linkage
BEFORE UPDATE OF id, business_id, contact_id, channel
ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.guard_conversation_goal_event_linkage();

CREATE TRIGGER guard_message_goal_event_linkage
BEFORE UPDATE OF id, business_id, conversation_id, role, channel
ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.guard_message_goal_event_linkage();

REVOKE ALL
  ON FUNCTION public.guard_contact_goal_event_linkage()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL
  ON FUNCTION public.guard_conversation_goal_event_linkage()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL
  ON FUNCTION public.guard_message_goal_event_linkage()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Retention.
--
-- Conversation deletion preserves the count and contact linkage, but removes
-- the no-longer-valid conversation/message navigation. Contact deletion
-- preserves the event while clearing every navigational reference.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.unlink_goal_events_before_conversation_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.businesses AS business
    WHERE business.id = OLD.business_id
  ) THEN
    UPDATE public.goal_events
    SET conversation_id = NULL,
        source_message_id = NULL,
        assistant_message_id = NULL
    WHERE conversation_id = OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER unlink_goal_events_before_conversation_delete
BEFORE DELETE
ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.unlink_goal_events_before_conversation_delete();

CREATE FUNCTION public.unlink_goal_events_before_contact_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.businesses AS business
    WHERE business.id = OLD.business_id
  ) THEN
    UPDATE public.goal_events
    SET contact_id = NULL,
        conversation_id = NULL,
        source_message_id = NULL,
        assistant_message_id = NULL
    WHERE contact_id = OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER unlink_goal_events_before_contact_delete
BEFORE DELETE
ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.unlink_goal_events_before_contact_delete();

REVOKE ALL
  ON FUNCTION public.unlink_goal_events_before_conversation_delete()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL
  ON FUNCTION public.unlink_goal_events_before_contact_delete()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Owner-readable, service-written access.
-- ---------------------------------------------------------------------------

ALTER TABLE public.goal_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY goal_events_select
ON public.goal_events
FOR SELECT
TO authenticated
USING (
  business_id IN (
    SELECT id
    FROM public.businesses
    WHERE owner_id = auth.uid()
  )
);

REVOKE ALL
  ON TABLE public.goal_events
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
  ON TABLE public.goal_events
  TO authenticated;

GRANT SELECT, INSERT
  ON TABLE public.goal_events
  TO service_role;

COMMIT;
