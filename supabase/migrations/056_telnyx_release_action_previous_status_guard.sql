BEGIN;

-- Migration 034's broader action-shape check permits NULL through SQL's
-- three-valued CHECK semantics. Phone actions need the prior local state in
-- order to restore it safely if a release run is canceled.
DO $migration_056_previous_status_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.telnyx_resource_release_actions AS action
    WHERE action.resource_type IN (
      'phone_number_assignment',
      'phone_number'
    )
      AND action.previous_resource_status IS NULL
  ) THEN
    RAISE EXCEPTION
      'migration_056_phone_release_action_previous_status_requires_review'
      USING ERRCODE = '23514';
  END IF;
END;
$migration_056_previous_status_preflight$;

-- Preserve the original value-shape constraint and add only the missing
-- non-null invariant. NOT VALID avoids an implicit table scan while the
-- constraint is installed; the explicit validation below still fails the
-- migration closed if a conflicting historical row appears.
ALTER TABLE public.telnyx_resource_release_actions
  ADD CONSTRAINT telnyx_release_actions_phone_previous_status_required
  CHECK (
    resource_type NOT IN (
      'phone_number_assignment',
      'phone_number'
    )
    OR previous_resource_status IS NOT NULL
  ) NOT VALID;

ALTER TABLE public.telnyx_resource_release_actions
  VALIDATE CONSTRAINT
    telnyx_release_actions_phone_previous_status_required;

COMMIT;
