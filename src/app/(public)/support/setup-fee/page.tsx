import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocLayout } from "@/components/legal/LegalDocLayout";
import { LegalSection } from "@/components/legal/legal-section";
import { inlineLink, ink, statusWarning } from "@/lib/theme-v2/theme";
import { SETUP_FEE_CENTS } from "@/lib/stripe/config";
import { SUPPORT_EMAIL, supportHref } from "@/lib/support/constants";
import { cn } from "@/lib/utils";

/**
 * /support/setup-fee — the deep-dive explainer behind the "Learn more about
 * this fee" link on the onboarding Review & Pay step. Public and indexable,
 * like /support: someone mid-checkout must be able to open it without auth.
 * The amount is derived from SETUP_FEE_CENTS so this page can never disagree
 * with what checkout charges.
 */

const FEE = SETUP_FEE_CENTS / 100;

const linkClass = `${inlineLink} underline-offset-2 hover:underline`;

export const metadata: Metadata = {
  title: `The $${FEE} setup fee, explained — SimplAssist`,
  description: `Every detail of SimplAssist's one-time $${FEE} setup and SMS activation fee: carrier registration, The Campaign Registry, compliance pages, and why it is non-refundable.`,
};

/** Bolded lead-in for a definition-style paragraph. */
function Term({ children }: { children: React.ReactNode }) {
  return <strong className={ink}>{children}</strong>;
}

export default function SetupFeePage() {
  return (
    <LegalDocLayout
      title={`The $${FEE} setup & SMS activation fee, explained`}
      lastUpdated="July 2026"
      siblingHref={supportHref()}
      siblingLabel="Contact support"
    >
      <LegalSection title="The short version">
        <p>
          Before any business in the United States is allowed to send automated
          text messages, the mobile carriers require that business to be
          registered, verified, and approved. The one-time ${FEE} fee funds
          that registration process end to end: the fees charged by the
          registration authorities and carriers, the activation of your
          business phone number, and the compliance work required for your
          messages to be accepted and delivered instead of filtered as spam.
        </p>
        <p>
          Because the registration fees are charged by third parties the moment
          your business is submitted for review — and those third parties do
          not return them — this fee is non-refundable once registration
          begins. The details of all of this are below.
        </p>
      </LegalSection>

      <LegalSection title="Why business texting requires registration at all">
        <p>
          The carriers draw a hard line between two kinds of text messages.
          Person-to-person (P2P) messaging is two humans texting each other
          from their phones. Application-to-person (A2P) messaging is any
          message sent by software on behalf of a business — appointment
          confirmations, auto-replies to missed calls, web chat follow-ups.
          Everything SimplAssist sends for you is A2P.
        </p>
        <p>
          For years, spammers abused ordinary local phone numbers to blast
          unwanted A2P messages, so U.S. carriers responded by building a
          framework called <Term>10DLC</Term> (&quot;10-Digit Long Code&quot; —
          industry shorthand for a standard 10-digit local phone number
          approved for business messaging). Under 10DLC, every business sending
          automated messages must register <em>who it is</em> and{" "}
          <em>what it sends</em> before carriers will deliver its traffic.
          Messages from unregistered numbers are aggressively filtered,
          blocked, and in some cases fined by the carriers.
        </p>
        <p>
          This is not a SimplAssist rule — it is an industry-wide requirement
          that applies to every company sending business text messages in the
          U.S., from the smallest local shop to the largest airline.
        </p>
      </LegalSection>

      <LegalSection title="Who The Campaign Registry is">
        <p>
          <Term>The Campaign Registry (TCR)</Term> is the central registry the
          U.S. mobile network operators jointly appointed to run the 10DLC
          system. TCR collects the identity of every registered business (a
          &quot;Brand&quot; in their terminology) and the description of every
          approved messaging use case (a &quot;Campaign&quot;), coordinates the
          vetting of both, and passes the results to the carriers. TCR and its
          vetting partners charge fees for brand registration and campaign
          review — these are real third-party charges incurred for your
          business specifically, and they are a core part of what the setup fee
          covers.
        </p>
      </LegalSection>

      <LegalSection title="What the fee covers, in detail">
        <p>
          <Term>1. Brand registration.</Term> Your business identity — legal
          name, EIN, address, and contact details — is submitted to The
          Campaign Registry, which verifies it against government and business
          records. This is how carriers know that messages from your number
          come from a real, identifiable business rather than an anonymous
          sender. TCR charges a registration fee for every brand filed.
        </p>
        <p>
          <Term>2. Campaign registration and carrier vetting.</Term> Alongside
          your identity, we register <em>what</em> you send: a description of
          your use case, sample messages, expected volume, and how customers
          opt in and out of receiving texts. This campaign is reviewed by the
          registry&apos;s vetting partners and by the carriers themselves
          before any message is allowed through. Campaign review carries its
          own third-party fees, which the setup fee covers. (Campaigns also
          carry small ongoing carrier fees after approval — those are included
          in your monthly plan, not billed separately.)
        </p>
        <p>
          <Term>3. Phone number activation.</Term> Your business phone number
          is provisioned, attached to your approved campaign, and activated for
          both calling and messaging. A number that is not linked to an
          approved campaign cannot legally carry A2P traffic, so this linking
          step is what actually switches your texting on.
        </p>
        <p>
          <Term>4. Carrier-required compliance pages.</Term> Carrier reviewers
          check that your business publishes a privacy policy, terms of
          service, and clear opt-in/opt-out disclosures before they approve
          your campaign. We create and host these pages for your business as
          part of setup, and they remain live for as long as you use
          SimplAssist — reviewers and customers can verify them at any time.
        </p>
        <p>
          <Term>5. Verification and filing work.</Term> Before anything is
          submitted, we review your registration details for the issues that
          most commonly cause rejections — mismatched legal names, EIN
          formatting, incomplete use-case descriptions — and prepare the filing
          so it has the best chance of first-pass approval.
        </p>
      </LegalSection>

      <LegalSection title="Which carriers this covers">
        <p>
          Registration through The Campaign Registry covers the mobile network
          operators that participate in the 10DLC program directly:{" "}
          <Term>AT&amp;T</Term>, <Term>T-Mobile</Term>, <Term>Verizon</Term>,
          U.S. Cellular, and the infrastructure providers (ClearSky and Interop
          Technologies) that route messaging for smaller regional networks.
        </p>
        <p>
          It also covers the carriers your customers are most likely to
          actually name — Cricket, Metro by T-Mobile, Visible, Mint Mobile,
          Boost Mobile, Straight Talk, and the other prepaid brands. These
          companies do not own their own networks; they run on AT&amp;T,
          T-Mobile, or Verizon infrastructure, so one registration with the big
          three reaches all of them automatically. In practice, a single
          approved 10DLC registration covers effectively every mobile phone in
          the United States.
        </p>
      </LegalSection>

      <LegalSection title="Why the fee is non-refundable">
        <div className={cn("rounded-[16px] p-4 text-sm", statusWarning)}>
          <p className="font-semibold">This fee is non-refundable.</p>
          <p className="mt-2 leading-relaxed">
            The Campaign Registry and participating carriers charge their
            registration and vetting fees as soon as your business is submitted
            for review, and those charges are not returned — even if a
            registration is rejected. Because the money is spent with third
            parties the moment the process starts, we are unable to refund the
            setup fee once registration begins.
          </p>
        </div>
        <p>
          The other side of that coin: if your registration is rejected, we do
          not charge you again. We diagnose the rejection reason, correct the
          filing or appeal the decision with the carriers, and resubmit at no
          additional charge until your business is approved.
        </p>
      </LegalSection>

      <LegalSection title="How long approval takes">
        <p>
          Most registrations are approved within a few business days of
          payment. Some filings are flagged for additional review — common for
          newly formed businesses or use cases the carriers scrutinize more
          closely — which can extend the process to a few weeks. You do not
          need to do anything during the wait: we monitor your registration
          status continuously, keep your onboarding progress saved, and notify
          you the moment your number is cleared to send.
        </p>
      </LegalSection>

      <LegalSection title="Terms you might see">
        <p>
          <Term>A2P</Term> — Application-to-person: messages sent by software
          on behalf of a business, as opposed to person-to-person texting.
        </p>
        <p>
          <Term>10DLC</Term> — 10-Digit Long Code: the carriers&apos;
          registration framework for sending A2P messages over standard local
          phone numbers.
        </p>
        <p>
          <Term>TCR / The Campaign Registry</Term> — The central registry the
          carriers use to collect and vet business registrations.
        </p>
        <p>
          <Term>Brand</Term> — Your registered business identity within TCR:
          legal name, EIN, address, and contacts.
        </p>
        <p>
          <Term>Campaign</Term> — Your registered messaging use case: what you
          send, to whom, at what volume, and how recipients opt in and out.
        </p>
        <p>
          <Term>MNO</Term> — Mobile Network Operator: a carrier that owns its
          own network (AT&amp;T, T-Mobile, Verizon).
        </p>
        <p>
          <Term>MVNO</Term> — Mobile Virtual Network Operator: a carrier brand
          that rents capacity on an MNO&apos;s network (Cricket, Mint, Visible,
          Metro, Boost).
        </p>
      </LegalSection>

      <LegalSection title="Still have questions?">
        <p>
          We are happy to walk through any of this before you pay. Reach us
          through the{" "}
          <Link href={supportHref("billing")} className={linkClass}>
            support page
          </Link>{" "}
          or email{" "}
          <span className={`select-all font-medium ${ink}`}>
            {SUPPORT_EMAIL}
          </span>
          .
        </p>
      </LegalSection>
    </LegalDocLayout>
  );
}
