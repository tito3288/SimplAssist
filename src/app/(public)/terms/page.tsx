import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
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
        <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: March 2026</p>

        <div className="mt-12 space-y-10">
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">1. Acceptance of Terms</h2>
            <p className="text-slate-600 leading-relaxed">
              By creating a SimplAssist account, you agree to these terms. If you do not agree, do
              not use the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">
              2. Description of Service
            </h2>
            <p className="text-slate-600 leading-relaxed">
              SimplAssist provides AI-powered customer communication tools for small businesses,
              including SMS auto-response, web chat widget, contact management, and related features.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">
              3. Account Responsibilities
            </h2>
            <p className="text-slate-600 leading-relaxed">
              You are responsible for maintaining the security of your account credentials. You are
              responsible for all activity under your account. You must provide accurate business
              information during registration.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">4. Acceptable Use</h2>
            <p className="text-slate-600 leading-relaxed">
              You agree to use SimplAssist only for legitimate business communication. You may not
              use the service to send spam, harass customers, or violate any applicable laws. You
              must comply with TCPA, CAN-SPAM, and other applicable messaging regulations.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">5. SMS Compliance</h2>
            <p className="text-slate-600 leading-relaxed">
              Your business is responsible for obtaining proper consent from customers before sending
              marketing messages. SimplAssist provides tools for communication initiated by customers
              contacting your business. You are responsible for maintaining opt-out lists and
              honoring STOP requests.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">
              6. Subscription and Billing
            </h2>
            <p className="text-slate-600 leading-relaxed">
              Services are billed monthly. You may cancel at any time. Refunds are not provided for
              partial months. SimplAssist reserves the right to change pricing with 30 days notice.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">
              7. Limitation of Liability
            </h2>
            <p className="text-slate-600 leading-relaxed">
              SimplAssist is provided &ldquo;as is.&rdquo; We are not liable for any indirect,
              incidental, or consequential damages arising from use of the service. Our total
              liability shall not exceed the amount paid in the last 3 months.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">8. Termination</h2>
            <p className="text-slate-600 leading-relaxed">
              We may terminate accounts that violate these terms. You may cancel your account at any
              time from your dashboard settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">9. Contact</h2>
            <p className="text-slate-600 leading-relaxed">
              For questions about these terms, contact us at{" "}
              <a href="mailto:legal@simplassist.com" className="text-blue-600 hover:text-blue-700">
                legal@simplassist.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
