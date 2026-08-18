BEGIN;

-- Phase 2 needs a durable selection before Stripe checkout exists, but this
-- value is deliberately not an entitlement. Direct billing remains
-- authoritative through subscriptions, while partner-managed billing remains
-- authoritative through businesses.partner_plan.
ALTER TABLE public.businesses
  ADD COLUMN onboarding_selected_plan text;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_onboarding_selected_plan_check
  CHECK (
    onboarding_selected_plan IS NULL
    OR onboarding_selected_plan IN (
      'sms_only',
      'sms_and_chat',
      'full',
      'chat_only'
    )
  ) NOT VALID;

ALTER TABLE public.businesses
  VALIDATE CONSTRAINT businesses_onboarding_selected_plan_check;

-- Install and validate the expanded state-machine boundary before removing
-- the established constraint. Keeping its established name avoids catalog and
-- parser drift for existing application and operational checks.
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_onboarding_step_plan_selection_candidate
  CHECK (
    onboarding_step IN (
      'plan_selection',
      'business_info',
      'business_hours',
      'services_faqs',
      'ai_settings',
      'legal_verification',
      'sms_use_case',
      'phone_number',
      'review_submit',
      'carrier_review',
      'complete'
    )
  ) NOT VALID;

ALTER TABLE public.businesses
  VALIDATE CONSTRAINT businesses_onboarding_step_plan_selection_candidate;

ALTER TABLE public.businesses
  DROP CONSTRAINT businesses_onboarding_step_check;

ALTER TABLE public.businesses
  RENAME CONSTRAINT businesses_onboarding_step_plan_selection_candidate
  TO businesses_onboarding_step_check;

COMMENT ON COLUMN public.businesses.onboarding_selected_plan IS
  'Owner-writable onboarding intent: sms_only, sms_and_chat, full, or chat_only. This is not an entitlement; direct subscriptions or partner_plan remain billing authority.';

COMMENT ON COLUMN public.businesses.onboarding_step IS
  'Explicit advisory/resumable onboarding step, including plan_selection. Server code must still derive access and completion from persisted authoritative facts.';

COMMIT;
