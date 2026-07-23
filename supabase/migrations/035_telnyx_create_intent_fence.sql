BEGIN;

-- Exactly one unresolved create intent may exist per business/resource kind.
-- This is the database half of the profile/voice recover-before-create fence:
-- overlapping stale launch attempts cannot both authorize a provider POST.
CREATE UNIQUE INDEX IF NOT EXISTS
  telnyx_registration_events_active_create_intent_unique
ON public.telnyx_registration_events (business_id, event_type)
WHERE status = 'started'
  AND event_type IN (
    'messaging_profile_create_intent',
    'voice_application_create_intent'
  );

COMMENT ON INDEX
  public.telnyx_registration_events_active_create_intent_unique IS
  'Allows only one unresolved Telnyx profile/voice create intent per business and resource kind.';

COMMIT;
