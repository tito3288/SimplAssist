-- ============================================================================
-- SimplAssist Initial Schema Migration
-- Multi-tenant SaaS database with Row Level Security
-- ============================================================================

-- ============================================================================
-- TABLES
-- ============================================================================

-- 1. Businesses (top-level tenant table)
CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  business_type text NOT NULL CHECK (business_type IN ('plumber','dentist','restaurant','car_wash','salon','hvac','auto_shop','general')),
  website_url text,
  phone_number text,
  address text,
  city text,
  state text,
  zip text,
  timezone text DEFAULT 'America/New_York',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Business Hours
CREATE TABLE business_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time time NOT NULL,
  close_time time NOT NULL,
  is_closed boolean DEFAULT false,
  UNIQUE(business_id, day_of_week)
);

-- 3. Services
CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 4. FAQs
CREATE TABLE faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  source text DEFAULT 'manual' CHECK (source IN ('scraped','manual','suggested')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 5. AI Settings
CREATE TABLE ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  tone text DEFAULT 'friendly' CHECK (tone IN ('friendly','professional','balanced')),
  business_voice text DEFAULT 'we' CHECK (business_voice IN ('we','business_name')),
  language text DEFAULT 'en' CHECK (language IN ('en','es','both')),
  sms_response_delay_seconds integer DEFAULT 0,
  sms_greeting text DEFAULT 'Thanks for reaching out! How can we help you today?',
  web_chat_greeting text DEFAULT 'Hi! How can we help you today?',
  guardrails text[] DEFAULT '{}',
  booking_enabled boolean DEFAULT false,
  booking_mode text DEFAULT 'collect_info' CHECK (booking_mode IN ('collect_info','schedule_direct')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 6. Contacts
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  name text,
  phone_number text,
  email text,
  source_channel text NOT NULL CHECK (source_channel IN ('sms','web_chat')),
  lead_score integer DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  last_contacted_at timestamptz DEFAULT now()
);

-- 7. Conversations
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('sms','web_chat')),
  status text DEFAULT 'active' CHECK (status IN ('active','closed','handed_off')),
  is_ai_handling boolean DEFAULT true,
  started_at timestamptz DEFAULT now(),
  last_message_at timestamptz DEFAULT now()
);

-- 8. Messages
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('customer','assistant','human_agent')),
  content text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms','web_chat')),
  created_at timestamptz DEFAULT now()
);

-- 9. Twilio Numbers
CREATE TABLE twilio_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  twilio_sid text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 10. Subscriptions
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text NOT NULL,
  plan text DEFAULT 'sms_only' CHECK (plan IN ('sms_only','sms_and_chat','full')),
  status text DEFAULT 'trialing' CHECK (status IN ('active','past_due','canceled','trialing')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 11. Widget Configs
CREATE TABLE widget_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  brand_color text DEFAULT '#0066FF',
  position text DEFAULT 'bottom_right' CHECK (position IN ('bottom_right','bottom_left')),
  welcome_message text DEFAULT 'Hi! How can we help you today?',
  show_logo boolean DEFAULT false,
  logo_url text,
  lead_capture_enabled boolean DEFAULT true,
  lead_capture_timing text DEFAULT 'after_3_messages' CHECK (lead_capture_timing IN ('start','after_3_messages','on_booking')),
  is_active boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_businesses_owner_id ON businesses(owner_id);
CREATE INDEX idx_contacts_business_id ON contacts(business_id);
CREATE INDEX idx_contacts_phone_number ON contacts(phone_number);
CREATE INDEX idx_conversations_business_id ON conversations(business_id);
CREATE INDEX idx_conversations_contact_id ON conversations(contact_id);
CREATE INDEX idx_conversations_last_message_at ON conversations(last_message_at DESC);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_business_id ON messages(business_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE twilio_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE widget_configs ENABLE ROW LEVEL SECURITY;

-- Businesses: owner can do everything
CREATE POLICY businesses_select ON businesses FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY businesses_insert ON businesses FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY businesses_update ON businesses FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY businesses_delete ON businesses FOR DELETE USING (owner_id = auth.uid());

-- Helper: macro for "business_id belongs to current user"
-- We'll use this subquery in all tenant-scoped policies:
--   business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())

-- Business Hours
CREATE POLICY business_hours_select ON business_hours FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY business_hours_insert ON business_hours FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY business_hours_update ON business_hours FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())) WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY business_hours_delete ON business_hours FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

-- Services
CREATE POLICY services_select ON services FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY services_insert ON services FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY services_update ON services FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())) WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY services_delete ON services FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

-- FAQs
CREATE POLICY faqs_select ON faqs FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY faqs_insert ON faqs FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY faqs_update ON faqs FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())) WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY faqs_delete ON faqs FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

-- AI Settings
CREATE POLICY ai_settings_select ON ai_settings FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY ai_settings_insert ON ai_settings FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY ai_settings_update ON ai_settings FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())) WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY ai_settings_delete ON ai_settings FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

-- Contacts
CREATE POLICY contacts_select ON contacts FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY contacts_insert ON contacts FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY contacts_update ON contacts FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())) WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

-- Conversations (owner + service_role access)
CREATE POLICY conversations_select ON conversations FOR SELECT USING (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  OR auth.role() = 'service_role'
);
CREATE POLICY conversations_insert ON conversations FOR INSERT WITH CHECK (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  OR auth.role() = 'service_role'
);
CREATE POLICY conversations_update ON conversations FOR UPDATE USING (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  OR auth.role() = 'service_role'
) WITH CHECK (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  OR auth.role() = 'service_role'
);
CREATE POLICY conversations_delete ON conversations FOR DELETE USING (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  OR auth.role() = 'service_role'
);

-- Messages (owner + service_role access)
CREATE POLICY messages_select ON messages FOR SELECT USING (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  OR auth.role() = 'service_role'
);
CREATE POLICY messages_insert ON messages FOR INSERT WITH CHECK (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  OR auth.role() = 'service_role'
);
CREATE POLICY messages_update ON messages FOR UPDATE USING (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  OR auth.role() = 'service_role'
) WITH CHECK (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  OR auth.role() = 'service_role'
);
CREATE POLICY messages_delete ON messages FOR DELETE USING (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  OR auth.role() = 'service_role'
);

-- Twilio Numbers
CREATE POLICY twilio_numbers_select ON twilio_numbers FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY twilio_numbers_insert ON twilio_numbers FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY twilio_numbers_update ON twilio_numbers FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())) WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY twilio_numbers_delete ON twilio_numbers FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

-- Subscriptions
CREATE POLICY subscriptions_select ON subscriptions FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY subscriptions_insert ON subscriptions FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY subscriptions_update ON subscriptions FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())) WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY subscriptions_delete ON subscriptions FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

-- Widget Configs
CREATE POLICY widget_configs_select ON widget_configs FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY widget_configs_insert ON widget_configs FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY widget_configs_update ON widget_configs FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())) WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY widget_configs_delete ON widget_configs FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER set_updated_at_businesses
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_ai_settings
  BEFORE UPDATE ON ai_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_widget_configs
  BEFORE UPDATE ON widget_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create business for new users
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.businesses (owner_id, name, business_type)
  VALUES (NEW.id, 'My Business', 'general');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
