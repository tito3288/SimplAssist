-- Persist the one-time dashboard discovery nudge for call forwarding.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS call_forwarding_nudge_resolved_at timestamptz;

-- Businesses with a forwarding destination or enabled forwarding have already
-- discovered the setting, so do not show them the new dashboard nudge.
UPDATE public.businesses
SET call_forwarding_nudge_resolved_at = now()
WHERE call_forwarding_nudge_resolved_at IS NULL
  AND (
    call_forwarding_enabled IS TRUE
    OR forward_to_number IS NOT NULL
  );

COMMENT ON COLUMN public.businesses.call_forwarding_nudge_resolved_at IS
  'Set when the owner dismisses, follows, or otherwise interacts with the one-time call-forwarding discovery nudge.';
