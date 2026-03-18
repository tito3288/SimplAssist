import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <nav className="flex items-center px-6 py-4 max-w-7xl mx-auto">
        <Link
          href="/home"
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: March 2026</p>

        <div className="mt-12 space-y-10">
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">1. Introduction</h2>
            <p className="text-slate-600 leading-relaxed">
              SimplAssist (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) is committed
              to protecting your privacy. This policy explains how we collect, use, and protect
              information when businesses use our platform and when their customers interact with our
              AI assistant.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">
              2. Information We Collect
            </h2>
            <p className="text-slate-600 leading-relaxed">
              We collect business information provided during registration (business name, website,
              address, phone number, hours, services). We collect customer contact information when
              customers text or chat with the AI (phone numbers, conversation content). We collect
              usage data to improve our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">
              3. How We Use Your Information
            </h2>
            <p className="text-slate-600 leading-relaxed">
              To power the AI assistant responses. To maintain conversation history in your CRM. To
              send SMS messages on behalf of your business via Twilio. To provide analytics and
              reporting in your dashboard. We do not sell your data to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">4. SMS Messaging</h2>
            <p className="text-slate-600 leading-relaxed">
              By using SimplAssist, your business agrees to Twilio&apos;s messaging policies.
              Customers who receive automated SMS messages have consented by initiating contact.
              Standard message and data rates may apply. Customers can opt out by replying STOP at
              any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">
              5. Data Storage and Security
            </h2>
            <p className="text-slate-600 leading-relaxed">
              All data is stored securely using Supabase (PostgreSQL). Conversations are encrypted in
              transit. We retain conversation data for as long as your account is active. You can
              request data deletion by contacting support.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">
              6. Third-Party Services
            </h2>
            <p className="text-slate-600 leading-relaxed">
              SimplAssist integrates with Twilio (messaging), Anthropic (AI), Stripe (payments), and
              Supabase (database). Each service has its own privacy policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">7. Contact Us</h2>
            <p className="text-slate-600 leading-relaxed">
              For privacy questions, contact us at{" "}
              <a
                href="mailto:privacy@simplassist.com"
                className="text-blue-600 hover:text-blue-700"
              >
                privacy@simplassist.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
