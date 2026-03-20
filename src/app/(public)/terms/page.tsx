import { LegalDocLayout } from "@/components/legal/LegalDocLayout";
import { LegalSection } from "@/components/legal/legal-section";

const linkClass =
  "font-medium text-[#ff914d] underline-offset-2 transition-colors hover:text-[#ffb07a] hover:underline";

export default function TermsPage() {
  return (
    <LegalDocLayout
      title="Terms of Service"
      siblingHref="/privacy"
      siblingLabel="Privacy Policy"
    >
      <LegalSection title="1. Acceptance of Terms">
        <p>
          By creating a SimplAssist account, you agree to these terms. If you do not agree, do not
          use the service.
        </p>
      </LegalSection>

      <LegalSection title="2. Description of Service">
        <p>
          SimplAssist provides AI-powered customer communication tools for small businesses, including
          SMS auto-response, web chat widget, contact management, and related features.
        </p>
      </LegalSection>

      <LegalSection title="3. Account Responsibilities">
        <p>
          You are responsible for maintaining the security of your account credentials. You are
          responsible for all activity under your account. You must provide accurate business
          information during registration.
        </p>
      </LegalSection>

      <LegalSection title="4. Acceptable Use">
        <p>
          You agree to use SimplAssist only for legitimate business communication. You may not use
          the service to send spam, harass customers, or violate any applicable laws. You must
          comply with TCPA, CAN-SPAM, and other applicable messaging regulations.
        </p>
      </LegalSection>

      <LegalSection title="5. SMS Compliance">
        <p>
          Your business is responsible for obtaining proper consent from customers before sending
          marketing messages. SimplAssist provides tools for communication initiated by customers
          contacting your business. You are responsible for maintaining opt-out lists and honoring
          STOP requests.
        </p>
      </LegalSection>

      <LegalSection title="6. Subscription and Billing">
        <p>
          Services are billed monthly. You may cancel at any time. Refunds are not provided for
          partial months. SimplAssist reserves the right to change pricing with 30 days notice.
        </p>
      </LegalSection>

      <LegalSection title="7. Limitation of Liability">
        <p>
          SimplAssist is provided &ldquo;as is.&rdquo; We are not liable for any indirect,
          incidental, or consequential damages arising from use of the service. Our total liability
          shall not exceed the amount paid in the last 3 months.
        </p>
      </LegalSection>

      <LegalSection title="8. Termination">
        <p>
          We may terminate accounts that violate these terms. You may cancel your account at any time
          from your dashboard settings.
        </p>
      </LegalSection>

      <LegalSection title="9. Contact">
        <p>
          For questions about these terms, contact us at{" "}
          <a href="mailto:legal@simplassist.com" className={linkClass}>
            legal@simplassist.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalDocLayout>
  );
}
