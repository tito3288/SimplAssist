import type { Metadata } from "next";

export const SITE_ORIGIN = "https://simplassist.com";

export const HOME_TITLE =
  "SimplAssist — Missed-Call Text Back for Small Businesses";

export const HOME_DESCRIPTION =
  "SimplAssist provides small businesses with missed call text back from $25/month, plus AI conversations, website chat, and appointment booking at $45/month.";

export const HOME_DEFINITION =
  "SimplAssist is a missed call text back service for small businesses, with plans starting at $25/month. Its $45/month plan adds an AI receptionist for SMS and web chat, a website chat widget, and Google Calendar appointment booking.";

export const HOME_FAQS = [
  {
    question: "What is missed call text back?",
    answer:
      "Missed call text back automatically sends a text message to anyone whose call your business couldn't answer — so instead of hitting voicemail and moving on, the caller gets an instant reply and can keep the conversation going by SMS.",
  },
  {
    question: "What is SimplAssist?",
    answer:
      "SimplAssist is a customer communication service built for small businesses. The $25/month SMS Only plan gives you missed call text back and a shared inbox, and the $45/month plan adds an AI receptionist for SMS and web chat, a website chat widget, and appointment booking synced with Google Calendar.",
  },
  {
    question: "How does SimplAssist's missed call text back work?",
    answer:
      "When someone calls and you can't pick up, SimplAssist automatically sends them a branded text inviting them to reply. Their replies land in your shared inbox, and on the $45/month plan your AI receptionist can carry the conversation for you.",
  },
  {
    question: "How much does SimplAssist cost?",
    answer:
      "SMS Only is $25/month with 500 included SMS parts, and SMS + Web Chat is $45/month with 1,500 included SMS parts. There's a one-time $25 setup fee when you activate paid SMS, which covers your carrier registration. Full Suite is coming soon and can't be purchased just yet.",
  },
  {
    question: "What kinds of businesses is SimplAssist for?",
    answer:
      "SimplAssist is built for small businesses and small teams that get customer calls or website inquiries — the ones too busy serving customers to catch every call. It handles missed-call follow-up, web chat, a shared inbox, and appointment booking, so you get front-desk coverage without hiring a full-time front desk.",
  },
  {
    question: "Does the AI answer with my business's real information?",
    answer:
      "Yes — your AI only speaks from what you've given it. On the SMS + Web Chat plan, SimplAssist loads your business profile, active services, saved FAQs, business hours, and AI settings before every answer, and it's instructed never to invent facts about your business.",
  },
  {
    question: "How long does setup take?",
    answer:
      "Most SMS registrations are approved within a few business days of payment, though additional carrier review can sometimes stretch that to a few weeks — that timeline is set by the phone carriers, not by us. Texting goes live as soon as carrier approval and your phone-number assignment are complete. Learn more about what the one-time $25 setup fee covers.",
    answerLink: {
      text: "what the one-time $25 setup fee covers.",
      href: "/support/setup-fee",
    },
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes — you can cancel anytime, and there are no contracts. The one-time $25 setup fee is non-refundable once carrier registration begins, since it covers that registration process itself.",
  },
] as const;

const socialPreview = {
  url: "/social-preview.png",
  width: 1200,
  height: 630,
  alt: "SimplAssist",
};

export const HOME_METADATA = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: "/",
    type: "website",
    images: [socialPreview],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    images: [socialPreview.url],
  },
} satisfies Metadata;

const monthlyPriceSpecification = (price: number) => ({
  "@type": "UnitPriceSpecification",
  name: "Monthly subscription",
  price,
  priceCurrency: "USD",
  billingDuration: "P1M",
  unitText: "MONTH",
});

const activationPriceSpecification = {
  "@type": "PriceSpecification",
  name: "One-time SMS activation fee",
  price: 25,
  priceCurrency: "USD",
};

export function getHomepageJsonLd() {
  const organizationId = `${SITE_ORIGIN}/#organization`;
  const applicationId = `${SITE_ORIGIN}/#software-application`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: "SimplAssist",
        url: `${SITE_ORIGIN}/`,
        logo: `${SITE_ORIGIN}/logo-light.png`,
      },
      {
        "@type": "SoftwareApplication",
        "@id": applicationId,
        name: "SimplAssist",
        description: HOME_DESCRIPTION,
        url: `${SITE_ORIGIN}/`,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        publisher: { "@id": organizationId },
        offers: [
          {
            "@type": "Offer",
            name: "SMS Only",
            url: `${SITE_ORIGIN}/#pricing`,
            price: 25,
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
            priceSpecification: [
              monthlyPriceSpecification(25),
              activationPriceSpecification,
            ],
          },
          {
            "@type": "Offer",
            name: "SMS + Web Chat",
            url: `${SITE_ORIGIN}/#pricing`,
            price: 45,
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
            priceSpecification: [
              monthlyPriceSpecification(45),
              activationPriceSpecification,
            ],
          },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_ORIGIN}/#faq`,
        mainEntity: HOME_FAQS.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: {
            "@type": "Answer",
            text: answer,
          },
        })),
      },
    ],
  };
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
