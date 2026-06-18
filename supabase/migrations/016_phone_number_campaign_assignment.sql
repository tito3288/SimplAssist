-- Phase 6.5: track Telnyx 10DLC phone-number campaign assignment.
--
-- Campaign approval is not enough for live SMS. Each purchased number must also
-- be assigned to the approved 10DLC campaign. These nullable task/details fields
-- let the app block sends until Telnyx confirms assignment, while preserving
-- existing test rows without destructive data changes.

ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS telnyx_campaign_assignment_status text NOT NULL DEFAULT 'unassigned'
    CHECK (telnyx_campaign_assignment_status IN ('unassigned','pending','assigned','failed')),
  ADD COLUMN IF NOT EXISTS telnyx_campaign_assignment_task_id text,
  ADD COLUMN IF NOT EXISTS telnyx_campaign_assignment_campaign_id text,
  ADD COLUMN IF NOT EXISTS telnyx_campaign_assignment_failure_reason text,
  ADD COLUMN IF NOT EXISTS telnyx_campaign_assignment_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS telnyx_campaign_assigned_at timestamptz;

COMMENT ON COLUMN phone_numbers.telnyx_campaign_assignment_status IS
  'Local status for linking this number to the business 10DLC campaign. SMS sends require assigned.';

COMMENT ON COLUMN phone_numbers.telnyx_campaign_assignment_task_id IS
  'Telnyx async task ID returned by phoneNumberAssignmentByProfile.assign.';

COMMENT ON COLUMN phone_numbers.telnyx_campaign_assignment_campaign_id IS
  'Telnyx campaign ID this phone number is expected to be assigned to.';

COMMENT ON COLUMN phone_numbers.telnyx_campaign_assignment_failure_reason IS
  'Last assignment failure reason. Transient failures are retried lazily; different-campaign failures require support.';

COMMENT ON COLUMN phone_numbers.telnyx_campaign_assignment_updated_at IS
  'Last time SimplAssist checked or changed local assignment state.';

COMMENT ON COLUMN phone_numbers.telnyx_campaign_assigned_at IS
  'Time SimplAssist observed Telnyx assignmentStatus=ASSIGNED for this number.';

ALTER TABLE telnyx_registration_events
  DROP CONSTRAINT IF EXISTS telnyx_registration_events_telnyx_resource_type_check;

ALTER TABLE telnyx_registration_events
  ADD CONSTRAINT telnyx_registration_events_telnyx_resource_type_check
  CHECK (
    telnyx_resource_type IN (
      'brand',
      'campaign',
      'messaging_profile',
      'voice_application',
      'phone_number_assignment'
    )
  );
