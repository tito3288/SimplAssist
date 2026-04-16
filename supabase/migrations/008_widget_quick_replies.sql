-- Add quick_replies column to widget_configs
ALTER TABLE widget_configs
  ADD COLUMN quick_replies text[] NOT NULL DEFAULT ARRAY[
    'Book a free consultation',
    'What services do you offer?',
    'What areas do you cover?'
  ]::text[];
