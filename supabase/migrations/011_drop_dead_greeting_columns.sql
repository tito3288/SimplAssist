-- Drop dead greeting columns from ai_settings.
--
-- sms_greeting: collected from users via Settings + Onboarding forms but never
-- read by any send path (engine.ts, webhook handlers, missed-call helper, AI
-- prompt builder). Editing it had zero observable effect. The "tone" enum
-- already covers AI style configuration in a better-typed way, so there's no
-- need to keep the column for future use.
--
-- web_chat_greeting: same dead-UI pattern, but doubly redundant. The actual
-- web chat greeting customers see lives on widget_configs.welcome_message,
-- which IS wired into the embedded chat widget (src/app/widget/embed.js).
-- The Settings page already had a help line pointing users to the Widget
-- settings, acknowledging the column was orphaned.

ALTER TABLE ai_settings DROP COLUMN sms_greeting;
ALTER TABLE ai_settings DROP COLUMN web_chat_greeting;
