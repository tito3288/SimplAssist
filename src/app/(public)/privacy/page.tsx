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

      <LegalSection title="4. SMS and Text Messaging">
        <p className="mb-4">
          SimplAssist sends automated text messages on behalf of businesses using our platform.
          These messages are sent via Twilio, a third-party messaging service. By using SimplAssist,
          your business agrees to Twilio&apos;s messaging policies and applicable telecommunications
          regulations.
        </p>

        <p className="mb-4 font-semibold">
          Consent to Receive Text Messages
        </p>
        <p className="mb-4">
          By calling, texting, or chatting with a business powered by SimplAssist, you (the
          end user/customer) consent to receive automated text messages at the phone number you
          provided. These messages may include responses to your inquiry, appointment confirmations,
          follow-up communications, and other messages related to the business you contacted.
          Consent is not a condition of purchase.
        </p>

        <p className="mb-4 font-semibold">
          Opting Out
        </p>
        <p className="mb-4">
          You can opt out of receiving text messages at any time by replying <strong>STOP</strong> to
          any message. After opting out, you will receive one final confirmation message and no
          further texts will be sent. To resume messages, text <strong>START</strong> to the same
          number.
        </p>

        <p className="mb-4 font-semibold">
          Getting Help
        </p>
        <p className="mb-4">
          For assistance, reply <strong>HELP</strong> to any message, or contact SimplAssist support
          at{" "}
          <a href="mailto:support@simplassist.com" className={linkClass}>
            support@simplassist.com
          </a>
          .
        </p>

        <p className="mb-4 font-semibold">
          Message Frequency and Rates
        </p>
        <p>
          Message frequency varies based on your interaction with the business. Message and data
          rates may apply depending on your mobile carrier and plan. SimplAssist is not responsible
          for any charges from your carrier.
        </p>
      </LegalSection>

      <LegalSection title="5. Data Storage and Security">
        <p>
          All data is stored securely using Supabase (PostgreSQL). Conversations are encrypted in
          transit. We retain conversation data for as long as your account is active. You can
          request data deletion by contacting support.
        </p>
      </LegalSection>

      <LegalSection title="6. Account Deletion and Data Retention">
        <p className="mb-4">
          You may delete your account at any time from the Settings page. Upon deletion,
          your account enters a 60-day grace period during which you can log back in
          and reactivate your account with all data intact.
        </p>
        <p className="mb-4">
          After 60 days, your data is permanently processed as follows: personal information
          (names, email addresses, phone numbers) is removed from all records. Conversation
          content is erased. Anonymous, aggregated metadata (lead scores, message counts,
          timestamps) may be retained for service improvement and analytics.
        </p>
        <p>
          Business configuration data (services, FAQs, business hours, AI settings,
          phone numbers, calendar connections, and widget settings) is permanently deleted.
          Your authentication credentials are permanently removed.
        </p>
      </LegalSection>

      <LegalSection title="7. Third-Party Services">
        <p>
          SimplAssist integrates with Twilio (messaging), Anthropic (AI), Stripe (payments), and
          Supabase (database). Each service has its own privacy policy.
        </p>
      </LegalSection>

      <LegalSection title="8. Contact Us">
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
