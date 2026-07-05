import type {
  AITone,
  BusinessEntityType,
  BusinessType,
  BusinessVoice,
  CampaignAssignmentStatus,
  Language,
  OnboardingRegistrationStatus,
  OnboardingStep,
  RegistrationStatus,
  SmsBlockReason,
} from "@/types/database";

export type { OnboardingStep } from "@/types/database";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  "business_info",
  "business_hours",
  "services_faqs",
  "ai_settings",
  "legal_verification",
  "sms_use_case",
  "phone_number",
  "review_submit",
  "carrier_review",
];

export const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  business_info: "Business Info",
  business_hours: "Business Hours",
  services_faqs: "Services & FAQs",
  ai_settings: "AI Settings",
  legal_verification: "Business Verification",
  sms_use_case: "SMS Use Case",
  phone_number: "Phone Number",
  review_submit: "Review & Submit",
  carrier_review: "Carrier Review",
  complete: "Complete",
};

export interface OnboardingBusinessInfo {
  name: string;
  business_type: BusinessType;
  business_type_other?: string;
  website?: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface OnboardingHours {
  day: string;
  is_closed: boolean;
  open_time: string;
  close_time: string;
}

export interface OnboardingService {
  name: string;
  description?: string;
  price?: string;
}

export interface OnboardingFaq {
  question: string;
  answer: string;
}

export interface OnboardingServicesAndFaqs {
  services: OnboardingService[];
  faqs: OnboardingFaq[];
}

export interface OnboardingAiSettings {
  tone: AITone;
  business_voice: BusinessVoice;
  language: Language;
  response_delay_seconds: number;
  web_greeting: string;
  guardrails?: string;
  booking_enabled: boolean;
  booking_mode?: "collect_info" | "schedule_direct";
}

export interface OnboardingBrandVerification {
  legal_business_name?: string;
  business_entity_type?: BusinessEntityType | null;
  business_registration_state?: string;
  ein?: string;
  authorized_rep_name?: string;
  authorized_rep_title?: string;
  authorized_rep_email?: string;
  authorized_rep_phone?: string;
  use_case_description?: string;
  estimated_monthly_volume?: string;
  sample_messages?: string[];
  opt_in_description?: string;
}

export interface OnboardingRegistrationSnapshot {
  status: OnboardingRegistrationStatus;
  startedAt: string | null;
  submittedAt: string | null;
  error: string | null;
  brandStatus: RegistrationStatus | null;
  brandStatusUpdatedAt: string | null;
  brandRejectionReason: string | null;
  campaignStatus: RegistrationStatus | null;
  campaignStatusUpdatedAt: string | null;
  campaignRejectionReason: string | null;
  assignmentStatus: CampaignAssignmentStatus | null;
  assignmentFailureReason: string | null;
  smsReady: boolean;
  smsBlockReason: SmsBlockReason | null;
}

export interface OnboardingState {
  businessId: string;
  currentStep: OnboardingStep;
  currentStepNumber: number;
  totalSteps: number;
  dashboardReady: boolean;
  completedAt: string | null;
  lastSavedAt: string | null;
  businessInfo: OnboardingBusinessInfo;
  businessHours: OnboardingHours[];
  servicesAndFaqs: OnboardingServicesAndFaqs;
  aiSettings: OnboardingAiSettings | null;
  brandVerification: OnboardingBrandVerification | null;
  phoneNumber: string | null;
  smsConsentAgreed: boolean;
  registration: OnboardingRegistrationSnapshot;
}

export function onboardingStepNumber(step: OnboardingStep): number {
  if (step === "complete") return ONBOARDING_STEPS.length;
  const index = ONBOARDING_STEPS.indexOf(step);
  return index === -1 ? 1 : index + 1;
}
