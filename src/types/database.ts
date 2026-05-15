export type BusinessType =
  | "plumber"
  | "dentist"
  | "restaurant"
  | "car_wash"
  | "salon"
  | "hvac"
  | "auto_shop"
  | "general"
  | "other";

export type FAQSource = "scraped" | "manual" | "suggested";

export type AITone = "friendly" | "professional" | "balanced";

export type BusinessVoice = "we" | "business_name";

export type Language = "en" | "es" | "both";

export type BookingMode = "collect_info" | "schedule_direct";

export type Channel = "sms" | "web_chat";

export type ConversationStatus = "active" | "closed" | "handed_off";

export type MessageRole = "customer" | "assistant" | "human_agent" | "system";

export type SubscriptionPlan = "sms_only" | "sms_and_chat" | "full";

export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "trialing";

export type WidgetPosition = "bottom_right" | "bottom_left";

export type LeadCaptureTiming = "start" | "after_3_messages" | "on_booking";

export type BusinessEntityType =
  | "llc"
  | "c_corp"
  | "s_corp"
  | "nonprofit"
  | "partnership"
  | "sole_proprietor";

export type TaxIdType = "ein" | "ssn_last_4";

export type RegistrationStatus = "pending" | "approved" | "rejected";

// Matches the CHECK constraint on businesses.privacy_terms_mode in
// supabase/migrations/015_business_slug_and_compliance_mode.sql. Phase 6.
export type PrivacyTermsMode = "hosted" | "self_hosted" | "existing";

// DB column telnyx_registration_events.event_type is intentionally unconstrained
// text so Phase 4/11 can add new event types without a migration. App code
// should write through TELNYX_EVENT_TYPES to keep audit logs typo-free.
export const TELNYX_EVENT_TYPES = [
  "brand_submitted",
  "brand_status_changed",
  "campaign_submitted",
  "campaign_status_changed",
  "messaging_profile_created",
  "voice_application_created",
] as const;
export type TelnyxEventType = (typeof TELNYX_EVENT_TYPES)[number];

export type TelnyxResourceType =
  | "brand"
  | "campaign"
  | "messaging_profile"
  | "voice_application";

export interface Business {
  id: string;
  owner_id: string;
  name: string;
  business_type: BusinessType;
  business_type_other: string | null;
  website_url: string | null;
  phone_number: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  timezone: string;
  sms_consent_agreed: boolean;
  sms_consent_agreed_at: string | null;
  legal_business_name: string | null;
  business_entity_type: BusinessEntityType | null;
  business_registration_state: string | null;
  tax_id_type: TaxIdType | null;
  ein: string | null;
  last_4_ssn: string | null;
  registrant_mobile: string | null;
  authorized_rep_name: string | null;
  authorized_rep_title: string | null;
  authorized_rep_email: string | null;
  authorized_rep_phone: string | null;
  use_case_description: string | null;
  sample_messages: string[] | null;
  estimated_monthly_volume: string | null;
  opt_in_description: string | null;
  compliance_info_completed_at: string | null;
  slug: string;
  privacy_terms_mode: PrivacyTermsMode;
  privacy_url_override: string | null;
  terms_url_override: string | null;
  telnyx_brand_id: string | null;
  telnyx_campaign_id: string | null;
  telnyx_messaging_profile_id: string | null;
  telnyx_voice_application_id: string | null;
  brand_status: RegistrationStatus | null;
  brand_status_updated_at: string | null;
  brand_rejection_reason: string | null;
  campaign_status: RegistrationStatus | null;
  campaign_status_updated_at: string | null;
  campaign_rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelnyxRegistrationEvent {
  id: string;
  business_id: string;
  // Widened to string because the DB column is unconstrained; future phases
  // (Phase 4 webhook, Phase 11 OTP) will append types to TELNYX_EVENT_TYPES.
  event_type: string;
  telnyx_resource_type: TelnyxResourceType | null;
  telnyx_resource_id: string | null;
  status: string | null;
  rejection_reason: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
}

export interface BusinessHours {
  id: string;
  business_id: string;
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

export interface Service {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  price: string | null;
  is_active: boolean;
}

export interface FAQ {
  id: string;
  business_id: string;
  question: string;
  answer: string;
  source: FAQSource;
  is_active: boolean;
}

export interface AISettings {
  id: string;
  business_id: string;
  tone: AITone;
  business_voice: BusinessVoice;
  language: Language;
  sms_response_delay_seconds: number;
  guardrails: string[];
  booking_enabled: boolean;
  booking_mode: BookingMode;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  business_id: string;
  name: string | null;
  phone_number: string | null;
  email: string | null;
  session_id: string | null;
  source_channel: Channel;
  lead_score: number;
  notes: string | null;
  created_at: string;
  last_contacted_at: string;
}

export interface Conversation {
  id: string;
  business_id: string;
  contact_id: string;
  channel: Channel;
  status: ConversationStatus;
  is_ai_handling: boolean;
  started_at: string;
  last_message_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  business_id: string;
  role: MessageRole;
  content: string;
  channel: Channel;
  created_at: string;
}

export interface PhoneNumber {
  id: string;
  business_id: string;
  phone_number: string;
  telnyx_phone_number_id: string;
  is_active: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  business_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  created_at: string;
}

export interface GoogleCalendarToken {
  id: string;
  business_id: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  calendar_id: string;
  google_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface WidgetConfig {
  id: string;
  business_id: string;
  brand_color: string;
  position: WidgetPosition;
  welcome_message: string;
  show_logo: boolean;
  logo_url: string | null;
  lead_capture_enabled: boolean;
  lead_capture_timing: LeadCaptureTiming;
  quick_replies: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
