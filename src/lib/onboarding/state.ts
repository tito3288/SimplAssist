import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSmsReadinessForBusiness } from "@/lib/messaging/lookup";
import type {
  A2pRiskChecklistAnswer,
  A2pRiskFinding,
  A2pRiskReviewStatus,
  AITone,
  BusinessEntityType,
  BusinessType,
  BusinessVoice,
  CampaignAssignmentStatus,
  Language,
  OnboardingRegistrationStatus,
  OnboardingStep,
  PrivacyTermsMode,
  RegistrationStatus,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/types/database";
import {
  hashA2pRiskInput,
  registrationHasStartedForRisk,
} from "@/lib/messaging/registration/riskScreening";
import {
  ONBOARDING_STEPS,
  onboardingStepNumber,
  type OnboardingAiSettings,
  type OnboardingBrandVerification,
  type OnboardingBusinessInfo,
  type OnboardingFaq,
  type OnboardingHours,
  type OnboardingService,
  type OnboardingState,
} from "./types";

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type BusinessRow = {
  id: string;
  owner_id: string;
  name: string | null;
  business_type: BusinessType | null;
  business_type_other: string | null;
  website_url: string | null;
  phone_number: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  sms_consent_agreed: boolean | null;
  legal_business_name: string | null;
  business_entity_type: BusinessEntityType | null;
  business_registration_state: string | null;
  tax_id_type: string | null;
  ein: string | null;
  authorized_rep_name: string | null;
  authorized_rep_title: string | null;
  authorized_rep_email: string | null;
  authorized_rep_phone: string | null;
  use_case_description: string | null;
  sample_messages: string[] | null;
  estimated_monthly_volume: string | null;
  opt_in_description: string | null;
  compliance_info_completed_at: string | null;
  pending_phone_number: string | null;
  pending_phone_number_area_code: string | null;
  pending_phone_number_selected_at: string | null;
  pending_phone_number_failure_reason: string | null;
  telnyx_submission_disabled: boolean | null;
  onboarding_step: OnboardingStep | null;
  onboarding_completed_at: string | null;
  onboarding_last_saved_at: string | null;
  onboarding_registration_status: OnboardingRegistrationStatus | null;
  onboarding_registration_started_at: string | null;
  onboarding_registration_submitted_at: string | null;
  onboarding_registration_error: string | null;
  a2p_risk_review_status: A2pRiskReviewStatus | null;
  a2p_risk_review_input_hash: string | null;
  a2p_risk_review_message: string | null;
  a2p_risk_review_reason: string | null;
  a2p_risk_review_findings: A2pRiskFinding[] | null;
  a2p_risk_review_customer_answer: A2pRiskChecklistAnswer | null;
  a2p_risk_review_customer_selections: string[] | null;
  a2p_risk_review_scanned_at: string | null;
  a2p_risk_review_notified_at: string | null;
  a2p_risk_review_reviewed_at: string | null;
  a2p_risk_review_reviewed_by: string | null;
  a2p_risk_review_override_note: string | null;
  privacy_terms_mode: PrivacyTermsMode;
  telnyx_brand_id: string | null;
  telnyx_campaign_id: string | null;
  telnyx_messaging_profile_id: string | null;
  brand_status: RegistrationStatus | null;
  brand_status_updated_at: string | null;
  brand_rejection_reason: string | null;
  campaign_status: RegistrationStatus | null;
  campaign_status_updated_at: string | null;
  campaign_rejection_reason: string | null;
};

type HoursRow = {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean | null;
};

type ServiceRow = {
  name: string;
  description: string | null;
  price: string | null;
};

type FaqRow = {
  question: string;
  answer: string;
};

type AiSettingsRow = {
  tone: AITone | null;
  business_voice: BusinessVoice | null;
  language: Language | null;
  sms_response_delay_seconds: number | null;
  guardrails: string[] | null;
  booking_enabled: boolean | null;
  booking_mode: "collect_info" | "schedule_direct" | null;
};

type WidgetConfigRow = {
  welcome_message: string | null;
};

type PhoneNumberRow = {
  phone_number: string;
  telnyx_campaign_assignment_status: CampaignAssignmentStatus;
  telnyx_campaign_assignment_failure_reason: string | null;
};

type SubscriptionRow = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  setup_fee_paid_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
};

export async function getOnboardingStateForOwner(
  ownerId: string
): Promise<OnboardingState | null> {
  const { data: business, error } = await supabaseAdmin
    .from("businesses")
    .select(
      [
        "id",
        "owner_id",
        "name",
        "business_type",
        "business_type_other",
        "website_url",
        "phone_number",
        "email",
        "address",
        "city",
        "state",
        "zip",
        "sms_consent_agreed",
        "legal_business_name",
        "business_entity_type",
        "business_registration_state",
        "tax_id_type",
        "ein",
        "authorized_rep_name",
        "authorized_rep_title",
        "authorized_rep_email",
        "authorized_rep_phone",
        "use_case_description",
        "sample_messages",
        "estimated_monthly_volume",
        "opt_in_description",
        "compliance_info_completed_at",
        "pending_phone_number",
        "pending_phone_number_area_code",
        "pending_phone_number_selected_at",
        "pending_phone_number_failure_reason",
        "telnyx_submission_disabled",
        "onboarding_step",
        "onboarding_completed_at",
        "onboarding_last_saved_at",
        "onboarding_registration_status",
        "onboarding_registration_started_at",
        "onboarding_registration_submitted_at",
        "onboarding_registration_error",
        "a2p_risk_review_status",
        "a2p_risk_review_input_hash",
        "a2p_risk_review_message",
        "a2p_risk_review_reason",
        "a2p_risk_review_findings",
        "a2p_risk_review_customer_answer",
        "a2p_risk_review_customer_selections",
        "a2p_risk_review_scanned_at",
        "a2p_risk_review_notified_at",
        "a2p_risk_review_reviewed_at",
        "a2p_risk_review_reviewed_by",
        "a2p_risk_review_override_note",
        "privacy_terms_mode",
        "telnyx_brand_id",
        "telnyx_campaign_id",
        "telnyx_messaging_profile_id",
        "brand_status",
        "brand_status_updated_at",
        "brand_rejection_reason",
        "campaign_status",
        "campaign_status_updated_at",
        "campaign_rejection_reason",
      ].join(", ")
    )
    .eq("owner_id", ownerId)
    .single<BusinessRow>();

  if (error || !business) {
    return null;
  }

  return getOnboardingStateForBusiness(business);
}

export async function getOnboardingStateForBusinessId(
  businessId: string
): Promise<OnboardingState | null> {
  const { data: business, error } = await supabaseAdmin
    .from("businesses")
    .select(
      [
        "id",
        "owner_id",
        "name",
        "business_type",
        "business_type_other",
        "website_url",
        "phone_number",
        "email",
        "address",
        "city",
        "state",
        "zip",
        "sms_consent_agreed",
        "legal_business_name",
        "business_entity_type",
        "business_registration_state",
        "tax_id_type",
        "ein",
        "authorized_rep_name",
        "authorized_rep_title",
        "authorized_rep_email",
        "authorized_rep_phone",
        "use_case_description",
        "sample_messages",
        "estimated_monthly_volume",
        "opt_in_description",
        "compliance_info_completed_at",
        "pending_phone_number",
        "pending_phone_number_area_code",
        "pending_phone_number_selected_at",
        "pending_phone_number_failure_reason",
        "telnyx_submission_disabled",
        "onboarding_step",
        "onboarding_completed_at",
        "onboarding_last_saved_at",
        "onboarding_registration_status",
        "onboarding_registration_started_at",
        "onboarding_registration_submitted_at",
        "onboarding_registration_error",
        "a2p_risk_review_status",
        "a2p_risk_review_input_hash",
        "a2p_risk_review_message",
        "a2p_risk_review_reason",
        "a2p_risk_review_findings",
        "a2p_risk_review_customer_answer",
        "a2p_risk_review_customer_selections",
        "a2p_risk_review_scanned_at",
        "a2p_risk_review_notified_at",
        "a2p_risk_review_reviewed_at",
        "a2p_risk_review_reviewed_by",
        "a2p_risk_review_override_note",
        "privacy_terms_mode",
        "telnyx_brand_id",
        "telnyx_campaign_id",
        "telnyx_messaging_profile_id",
        "brand_status",
        "brand_status_updated_at",
        "brand_rejection_reason",
        "campaign_status",
        "campaign_status_updated_at",
        "campaign_rejection_reason",
      ].join(", ")
    )
    .eq("id", businessId)
    .single<BusinessRow>();

  if (error || !business) {
    return null;
  }

  return getOnboardingStateForBusiness(business);
}

async function getOnboardingStateForBusiness(
  business: BusinessRow
): Promise<OnboardingState> {
  const [
    { data: hours },
    { data: services },
    { data: faqs },
    { data: aiSettings },
    { data: widgetConfig },
    { data: phoneNumber },
    { data: subscription },
  ] = await Promise.all([
    supabaseAdmin
      .from("business_hours")
      .select("day_of_week, open_time, close_time, is_closed")
      .eq("business_id", business.id)
      .order("day_of_week", { ascending: true })
      .returns<HoursRow[]>(),
    supabaseAdmin
      .from("services")
      .select("name, description, price")
      .eq("business_id", business.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .returns<ServiceRow[]>(),
    supabaseAdmin
      .from("faqs")
      .select("question, answer")
      .eq("business_id", business.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .returns<FaqRow[]>(),
    supabaseAdmin
      .from("ai_settings")
      .select(
        "tone, business_voice, language, sms_response_delay_seconds, guardrails, booking_enabled, booking_mode"
      )
      .eq("business_id", business.id)
      .maybeSingle<AiSettingsRow>(),
    supabaseAdmin
      .from("widget_configs")
      .select("welcome_message")
      .eq("business_id", business.id)
      .maybeSingle<WidgetConfigRow>(),
    supabaseAdmin
      .from("phone_numbers")
      .select(
        "phone_number, telnyx_campaign_assignment_status, telnyx_campaign_assignment_failure_reason"
      )
      .eq("business_id", business.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<PhoneNumberRow>(),
    supabaseAdmin
      .from("subscriptions")
      .select("plan, status, setup_fee_paid_at, current_period_start, current_period_end")
      .eq("business_id", business.id)
      .maybeSingle<SubscriptionRow>(),
  ]);

  const smsReadiness = await getSmsReadinessForBusiness(business.id);
  const normalizedHours = normalizeHours(hours ?? []);
  const normalizedServices = normalizeServices(services ?? []);
  const normalizedFaqs = normalizeFaqs(faqs ?? []);
  const normalizedAiSettings = normalizeAiSettings(
    aiSettings ?? null,
    widgetConfig ?? null,
    business.name ?? "Your Business"
  );
  const brandVerification = normalizeBrandVerification(business);
  const registrationStarted = registrationHasStarted(business);
  const riskReview = normalizeRiskReview({
    business,
    services: normalizedServices,
    faqs: normalizedFaqs,
    registrationStarted,
  });
  const activePhone = smsReadiness.phoneNumber ?? phoneNumber?.phone_number ?? null;
  const phone = activePhone ?? business.pending_phone_number ?? null;
  const derivedStep = deriveOnboardingStep({
    business,
    hours: normalizedHours,
    services: normalizedServices,
    aiSettings: normalizedAiSettings,
    phoneNumber: phone,
    smsReady: smsReadiness.smsReady,
    riskCleared:
      riskReview.status === "passed" || riskReview.status === "admin_approved",
  });
  const completedAt =
    smsReadiness.smsReady && !business.onboarding_completed_at
      ? new Date().toISOString()
      : business.onboarding_completed_at;

  await syncStoredProgress({
    business,
    derivedStep,
    completedAt,
    smsReady: smsReadiness.smsReady,
  });

  return {
    businessId: business.id,
    currentStep: derivedStep,
    currentStepNumber: onboardingStepNumber(derivedStep),
    totalSteps: ONBOARDING_STEPS.length,
    dashboardReady: smsReadiness.smsReady,
    completedAt,
    lastSavedAt: business.onboarding_last_saved_at,
    businessInfo: normalizeBusinessInfo(business),
    businessHours: normalizedHours,
    servicesAndFaqs: {
      services: normalizedServices,
      faqs: normalizedFaqs,
    },
    aiSettings: normalizedAiSettings,
    brandVerification,
    phoneNumber: phone,
    activePhoneNumber: activePhone,
    pendingPhoneNumber: business.pending_phone_number,
    pendingPhoneNumberFailureReason: business.pending_phone_number_failure_reason,
    smsConsentAgreed: Boolean(business.sms_consent_agreed),
    billing: {
      plan: subscription?.plan ?? null,
      status: subscription?.status ?? null,
      setupFeePaidAt: subscription?.setup_fee_paid_at ?? null,
      currentPeriodStart: subscription?.current_period_start ?? null,
      currentPeriodEnd: subscription?.current_period_end ?? null,
    },
    registration: {
      status: normalizeRegistrationStatus(business),
      startedAt: business.onboarding_registration_started_at,
      submittedAt: business.onboarding_registration_submitted_at,
      error: business.onboarding_registration_error,
      brandStatus: business.brand_status,
      brandStatusUpdatedAt: business.brand_status_updated_at,
      brandRejectionReason: business.brand_rejection_reason,
      campaignStatus: business.campaign_status,
      campaignStatusUpdatedAt: business.campaign_status_updated_at,
      campaignRejectionReason: business.campaign_rejection_reason,
      assignmentStatus:
        smsReadiness.assignmentStatus ??
        phoneNumber?.telnyx_campaign_assignment_status ??
        null,
      assignmentFailureReason:
        smsReadiness.assignmentFailureReason ??
        phoneNumber?.telnyx_campaign_assignment_failure_reason ??
        null,
      smsReady: smsReadiness.smsReady,
      smsBlockReason: smsReadiness.blockReason,
      riskReview,
    },
  };
}

function normalizeBusinessInfo(business: BusinessRow): OnboardingBusinessInfo {
  return {
    name: business.name ?? "",
    business_type: business.business_type ?? "general",
    business_type_other: business.business_type_other ?? "",
    website: business.website_url ?? "",
    phone: business.phone_number ?? "",
    email: business.email ?? "",
    address: business.address ?? "",
    city: business.city ?? "",
    state: business.state ?? "",
    zip: business.zip ?? "",
  };
}

function normalizeHours(rows: HoursRow[]): OnboardingHours[] {
  if (rows.length === 0) return [];

  return rows
    .filter((row) => row.day_of_week >= 0 && row.day_of_week <= 6)
    .map((row) => ({
      day: DAYS[row.day_of_week] ?? "monday",
      is_closed: Boolean(row.is_closed),
      open_time: toTimeInput(row.open_time),
      close_time: toTimeInput(row.close_time),
    }));
}

function normalizeServices(rows: ServiceRow[]): OnboardingService[] {
  return rows.map((row) => ({
    name: row.name,
    description: row.description ?? "",
    price: row.price ?? "",
  }));
}

function normalizeFaqs(rows: FaqRow[]): OnboardingFaq[] {
  return rows.map((row) => ({
    question: row.question,
    answer: row.answer,
  }));
}

function normalizeAiSettings(
  ai: AiSettingsRow | null,
  widget: WidgetConfigRow | null,
  businessName: string
): OnboardingAiSettings | null {
  if (!ai) return null;

  return {
    tone: ai.tone ?? "balanced",
    business_voice: ai.business_voice ?? "we",
    language: ai.language ?? "en",
    response_delay_seconds: ai.sms_response_delay_seconds ?? 5,
    web_greeting:
      widget?.welcome_message ??
      `Hi! I'm ${businessName}'s assistant. Ask me anything about our services.`,
    guardrails: (ai.guardrails ?? []).join("\n"),
    booking_enabled: Boolean(ai.booking_enabled),
    booking_mode: ai.booking_mode ?? "collect_info",
  };
}

function normalizeBrandVerification(
  business: BusinessRow
): OnboardingBrandVerification | null {
  if (
    !business.legal_business_name &&
    !business.ein &&
    !business.authorized_rep_name &&
    !business.use_case_description
  ) {
    return null;
  }

  return {
    legal_business_name: business.legal_business_name ?? "",
    business_entity_type: business.business_entity_type,
    business_registration_state: business.business_registration_state ?? "",
    ein: business.ein ?? "",
    authorized_rep_name: business.authorized_rep_name ?? "",
    authorized_rep_title: business.authorized_rep_title ?? "",
    authorized_rep_email: business.authorized_rep_email ?? "",
    authorized_rep_phone: business.authorized_rep_phone ?? "",
    use_case_description: business.use_case_description ?? "",
    estimated_monthly_volume: business.estimated_monthly_volume ?? "",
    sample_messages: business.sample_messages ?? [],
    opt_in_description: business.opt_in_description ?? "",
  };
}

function normalizeRiskReview(args: {
  business: BusinessRow;
  services: OnboardingService[];
  faqs: OnboardingFaq[];
  registrationStarted: boolean;
}) {
  const { business, services, faqs, registrationStarted } = args;
  const currentInputHash = hashA2pRiskInput({
    businessId: business.id,
    businessName: business.name ?? "Your Business",
    businessType: business.business_type,
    businessTypeOther: business.business_type_other,
    websiteUrl: business.website_url,
    services: services.map((service) => ({
      name: service.name,
      description: service.description ?? null,
    })),
    faqs: faqs.map((faq) => ({
      question: faq.question,
      answer: faq.answer,
    })),
    useCaseDescription: business.use_case_description ?? "",
    sampleMessages: business.sample_messages ?? [],
    optInDescription: business.opt_in_description ?? "",
    checklistAnswer: business.a2p_risk_review_customer_answer,
    checklistSelections: business.a2p_risk_review_customer_selections ?? [],
  });
  const storedStatus = business.a2p_risk_review_status;
  const hashMatches =
    Boolean(business.a2p_risk_review_input_hash) &&
    business.a2p_risk_review_input_hash === currentInputHash;
  const effectiveStatus: A2pRiskReviewStatus = registrationStarted
    ? (storedStatus ?? "not_started")
    : hashMatches
      ? (storedStatus ?? "not_started")
      : "not_started";

  return {
    status: effectiveStatus,
    storedStatus,
    inputHash: business.a2p_risk_review_input_hash,
    currentInputHash,
    message: hashMatches ? business.a2p_risk_review_message : null,
    reason: hashMatches ? business.a2p_risk_review_reason : null,
    findings: hashMatches ? business.a2p_risk_review_findings ?? [] : [],
    checklistAnswer: business.a2p_risk_review_customer_answer,
    checklistSelections: business.a2p_risk_review_customer_selections ?? [],
    scannedAt: hashMatches ? business.a2p_risk_review_scanned_at : null,
    notifiedAt: hashMatches ? business.a2p_risk_review_notified_at : null,
    reviewedAt: hashMatches ? business.a2p_risk_review_reviewed_at : null,
    reviewedBy: hashMatches ? business.a2p_risk_review_reviewed_by : null,
    overrideNote: hashMatches ? business.a2p_risk_review_override_note : null,
    registrationStarted,
  };
}

function deriveOnboardingStep(args: {
  business: BusinessRow;
  hours: OnboardingHours[];
  services: OnboardingService[];
  aiSettings: OnboardingAiSettings | null;
  phoneNumber: string | null;
  smsReady: boolean;
  riskCleared: boolean;
}): OnboardingStep {
  const {
    business,
    hours,
    services,
    aiSettings,
    phoneNumber,
    smsReady,
    riskCleared,
  } = args;

  if (smsReady || business.onboarding_completed_at) return "complete";

  if (
    business.onboarding_registration_status === "failed" &&
    business.pending_phone_number_failure_reason
  ) {
    return "phone_number";
  }

  if (registrationHasStarted(business)) {
    return "carrier_review";
  }

  if (!hasBusinessInfo(business)) return "business_info";
  if (hours.length < 7) return "business_hours";
  if (services.length === 0) return "services_faqs";
  if (!aiSettings) return "ai_settings";
  if (!hasLegalVerification(business)) return "legal_verification";
  if (!hasCompletedComplianceInfo(business, riskCleared)) return "sms_use_case";
  if (!phoneNumber) return "phone_number";

  return "review_submit";
}

function hasBusinessInfo(business: BusinessRow): boolean {
  return Boolean(
    business.name &&
      business.name !== "My Business" &&
      business.business_type &&
      business.phone_number &&
      business.email &&
      business.address &&
      business.city &&
      business.state &&
      business.zip
  );
}

function hasLegalVerification(business: BusinessRow): boolean {
  return Boolean(
    business.legal_business_name &&
      business.business_entity_type &&
      business.business_registration_state &&
      business.ein &&
      business.authorized_rep_name &&
      business.authorized_rep_title &&
      business.authorized_rep_email &&
      business.authorized_rep_phone
  );
}

function hasCompletedComplianceInfo(
  business: BusinessRow,
  riskCleared: boolean
): boolean {
  return Boolean(
    riskCleared &&
      business.compliance_info_completed_at &&
      business.use_case_description &&
      business.estimated_monthly_volume &&
      business.opt_in_description &&
      business.sample_messages &&
      business.sample_messages.length >= 3
  );
}

function registrationHasStarted(business: BusinessRow): boolean {
  return registrationHasStartedForRisk(business);
}

function normalizeRegistrationStatus(
  business: BusinessRow
): OnboardingRegistrationStatus {
  if (business.onboarding_registration_status) {
    return business.onboarding_registration_status;
  }
  return business.telnyx_brand_id ? "submitted" : "not_started";
}

async function syncStoredProgress(args: {
  business: BusinessRow;
  derivedStep: OnboardingStep;
  completedAt: string | null;
  smsReady: boolean;
}): Promise<void> {
  const { business, derivedStep, completedAt, smsReady } = args;
  const update: Record<string, unknown> = {};

  if (business.onboarding_step !== derivedStep) {
    update.onboarding_step = derivedStep;
  }

  if (smsReady && !business.onboarding_completed_at && completedAt) {
    update.onboarding_completed_at = completedAt;
    update.onboarding_last_saved_at = completedAt;
  }

  const shouldMarkSubmittedFromExistingTelnyxId =
    Boolean(business.telnyx_brand_id) &&
    (business.onboarding_registration_status == null ||
      (business.onboarding_registration_status === "not_started" &&
        !business.onboarding_registration_started_at &&
        !business.onboarding_registration_error));

  if (shouldMarkSubmittedFromExistingTelnyxId) {
    update.onboarding_registration_status = "submitted";
    update.onboarding_registration_submitted_at =
      business.onboarding_registration_submitted_at ??
      business.campaign_status_updated_at ??
      business.brand_status_updated_at ??
      new Date().toISOString();
    update.onboarding_registration_error = null;
  }

  if (Object.keys(update).length === 0) return;

  const { error } = await supabaseAdmin
    .from("businesses")
    .update(update)
    .eq("id", business.id);

  if (error) {
    console.error(
      `[onboarding:state] Failed to sync progress for business ${business.id}:`,
      error
    );
  }
}

function toTimeInput(value: string): string {
  return value.slice(0, 5);
}
