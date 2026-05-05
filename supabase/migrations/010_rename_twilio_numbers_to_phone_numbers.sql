-- Phase E: rename twilio_numbers -> phone_numbers and twilio_sid -> telnyx_phone_number_id.
-- Provider-agnostic naming so a future provider switch never requires another rename.

ALTER TABLE twilio_numbers RENAME TO phone_numbers;
ALTER TABLE phone_numbers RENAME COLUMN twilio_sid TO telnyx_phone_number_id;

-- RLS policies are tied to the old table name; drop them and recreate under the new name.
DROP POLICY twilio_numbers_select ON phone_numbers;
DROP POLICY twilio_numbers_insert ON phone_numbers;
DROP POLICY twilio_numbers_update ON phone_numbers;
DROP POLICY twilio_numbers_delete ON phone_numbers;

CREATE POLICY phone_numbers_select ON phone_numbers FOR SELECT USING (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
);
CREATE POLICY phone_numbers_insert ON phone_numbers FOR INSERT WITH CHECK (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
);
CREATE POLICY phone_numbers_update ON phone_numbers FOR UPDATE USING (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
) WITH CHECK (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
);
CREATE POLICY phone_numbers_delete ON phone_numbers FOR DELETE USING (
  business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
);
