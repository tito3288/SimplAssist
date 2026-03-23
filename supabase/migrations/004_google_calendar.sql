-- Google Calendar OAuth tokens for direct appointment scheduling
CREATE TABLE google_calendar_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expiry timestamptz NOT NULL,
  calendar_id text DEFAULT 'primary',
  google_email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE google_calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY google_calendar_tokens_select ON google_calendar_tokens
  FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY google_calendar_tokens_insert ON google_calendar_tokens
  FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY google_calendar_tokens_update ON google_calendar_tokens
  FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()))
  WITH CHECK (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY google_calendar_tokens_delete ON google_calendar_tokens
  FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

CREATE TRIGGER set_updated_at_google_calendar_tokens
  BEFORE UPDATE ON google_calendar_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
