BEGIN;

-- Owners may opt out, while every new and existing widget starts with the
-- recommended proactive greeting preference enabled. Public runtime delivery
-- remains independently fail-closed behind a server-only application switch.
ALTER TABLE public.widget_configs
  ADD COLUMN proactive_invitation_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.widget_configs.proactive_invitation_enabled IS
  'Owner preference for automatically revealing the saved welcome message. Public delivery also requires the server-only runtime gate.';

-- The column inherits widget_configs row-level security and existing table
-- privileges; this migration intentionally creates no new policy or grant.

COMMIT;
