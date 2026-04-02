-- Add SMS consent tracking columns to businesses table
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS sms_consent_agreed boolean DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS sms_consent_agreed_at timestamptz;
