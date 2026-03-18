-- Allow 'other' as a business_type value and add column for custom text
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_business_type_check;
ALTER TABLE businesses ADD CONSTRAINT businesses_business_type_check
  CHECK (business_type IN ('plumber','dentist','restaurant','car_wash','salon','hvac','auto_shop','general','other'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_type_other text;
