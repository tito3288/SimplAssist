export type BusinessType =
  | "plumber"
  | "dentist"
  | "restaurant"
  | "car_wash"
  | "salon"
  | "hvac"
  | "auto_shop"
  | "general";

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

export interface Business {
  id: string;
  owner_id: string;
  name: string;
  business_type: BusinessType;
  website_url: string | null;
  phone_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  timezone: string;
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
  sms_greeting: string;
  web_chat_greeting: string;
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

export interface TwilioNumber {
  id: string;
  business_id: string;
  phone_number: string;
  twilio_sid: string;
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
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
