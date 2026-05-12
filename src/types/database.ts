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

export type MessageRole = "customer" | "assistant" | "human_agent";

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
  created_at: string;
  updated_at: string;
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
