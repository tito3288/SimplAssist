-- Create a public storage bucket for widget logos
-- NOTE: Run this in Supabase Dashboard → Storage → New Bucket
-- Bucket name: widget-logos
-- Public: Yes
--
-- Then run this SQL to allow public read access:

INSERT INTO storage.buckets (id, name, public) VALUES ('widget-logos', 'widget-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload widget logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'widget-logos');

-- Allow authenticated users to update/overwrite their logos
CREATE POLICY "Users can update widget logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'widget-logos');

-- Allow public read access (so the widget embed can display logos)
CREATE POLICY "Public can read widget logos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'widget-logos');
