import { LegalDocLayout } from "@/components/legal/LegalDocLayout";
import { LegalSection } from "@/components/legal/legal-section";

const linkClass =
  "font-medium text-[#ff914d] underline-offset-2 transition-colors hover:text-[#ffb07a] hover:underline";

export default function PrivacyPage() {
  return (
    <LegalDocLayout
      title="Privacy Policy"
      siblingHref="/terms"
      siblingLabel="Terms of Service"
    >
      <LegalSection title="1. Introduction">
        <p>
          SimplAssist (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) is committed to
          protecting your privacy. This policy explains how we collect, use, and protect information
          when businesses use our platform and when their customers interact with our AI assistant.
        </p>
      </LegalSection>

      <LegalSection title="2. Information We Collect">
        <p>
          We collect business information provided during registration (business name, website,
          address, phone number, hours, services). We collect customer contact information when
          customers text or chat with the AI (phone numbers, conversation content). We collect usage
          data to improve our service.
        </p>
      </LegalSection>

      <LegalSection title="3. How We Use Your Information">
        <p>
          To power the AI assistant responses. To maintain conversation history in your CRM. To send
          SMS messages on behalf of your business via Twilio. To provide analytics and reporting in
          your dashboard. We do not sell your data to third parties.
        </p>
      </LegalSection>

      <LegalSection title="4. SMS Messaging">
        <p>
          By using SimplAssist, your business agrees to Twilio&apos;s messaging policies. Customers
          who receive automated SMS messages have consented by initiating contact. Standard message
          and data rates may apply. Customers can opt out by replying STOP at any time.
        </p>
      </LegalSection>

      <LegalSection title="5. Data Storage and Security">
        <p>
          All data is stored securely using Supabase (PostgreSQL). Conversations are encrypted in
          transit. We retain conversation data for as long as your account is active. You can
          request data deletion by contacting support.
        </p>
      </LegalSection>

      <LegalSection title="6. Third-Party Services">
        <p>
          SimplAssist integrates with Twilio (messaging), Anthropic (AI), Stripe (payments), and
          Supabase (database). Each service has its own privacy policy.
        </p>
      </LegalSection>

      <LegalSection title="7. Contact Us">
        <p>
          For privacy questions, contact us at{" "}
          <a href="mailto:privacy@simplassist.com" className={linkClass}>
            privacy@simplassist.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalDocLayout>
  );
}
