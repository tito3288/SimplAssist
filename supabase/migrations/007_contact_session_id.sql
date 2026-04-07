-- Add session_id to contacts for anonymous web chat visitor tracking
ALTER TABLE contacts ADD COLUMN session_id text;

-- Partial unique index: one contact per session per business
CREATE UNIQUE INDEX idx_contacts_business_session
  ON contacts(business_id, session_id)
  WHERE session_id IS NOT NULL;
