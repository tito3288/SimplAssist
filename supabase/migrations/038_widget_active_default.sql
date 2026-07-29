-- New widget configurations launch active by default. This changes only the
-- default for future inserts; existing widget_configs rows remain untouched.
ALTER TABLE public.widget_configs
  ALTER COLUMN is_active SET DEFAULT true;
