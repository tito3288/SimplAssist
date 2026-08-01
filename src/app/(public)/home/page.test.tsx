import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "font-test-variable" }),
}));
vi.mock("next/script", () => ({ default: () => null }));

import RootLayout from "../../layout";
import CanonicalHomepage, { metadata } from "../../page";
import { REVEAL_NO_SCRIPT_CSS } from "@/lib/theme-v2/reveal";
import {
  getHomepageJsonLd,
  HOME_DEFINITION,
  HOME_DESCRIPTION,
  HOME_FAQS,
  HOME_METADATA,
  HOME_TITLE,
} from "./seo";

function visibleText(html: string): string {
  return html
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:x27|39);/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function renderHomepage() {
  return renderToStaticMarkup(<CanonicalHomepage />);
}

type JsonRecord = Record<string, unknown>;

describe("canonical homepage SEO metadata", () => {
  it("uses the approved title and description with canonical social parity", () => {
    expect(metadata).toBe(HOME_METADATA);
    expect(HOME_TITLE).toHaveLength(56);
    expect(HOME_DESCRIPTION).toHaveLength(155);
    expect(HOME_TITLE).toBe(
      "SimplAssist — Missed-Call Text Back for Small Businesses"
    );
    expect(HOME_METADATA.alternates.canonical).toBe("/");

    expect(HOME_METADATA.openGraph).toMatchObject({
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      url: "/",
      images: [
        {
          url: "/social-preview.png",
          width: 1200,
          height: 630,
          alt: "SimplAssist",
        },
      ],
    });
    expect(HOME_METADATA.twitter).toMatchObject({
      card: "summary_large_image",
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      images: ["/social-preview.png"],
    });
  });
});

describe("canonical homepage static HTML", () => {
  it("renders one H1, the approved definition, and all visible FAQs", () => {
    const html = renderHomepage();
    const text = visibleText(html);
    const definitionSection = html.match(
      /<section id="what-is-simplassist"[\s\S]*?<\/section>/
    )?.[0];
    const faqSection = html.match(/<section id="faq"[\s\S]*?<\/section>/)?.[0];

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(definitionSection).toBeDefined();
    expect(visibleText(definitionSection ?? "")).toContain(HOME_DEFINITION);
    expect(text).toContain("missed call text back");
    expect(text).toContain("AI receptionist");
    expect(text).toContain("website chat widget");

    expect(faqSection).toBeDefined();
    expect(faqSection?.match(/<h3\b/g)).toHaveLength(HOME_FAQS.length);
    const faqText = visibleText(faqSection ?? "");
    for (const { question, answer } of HOME_FAQS) {
      expect(faqText).toContain(question);
      expect(faqText).toContain(answer);
    }
  });

  it("ships a no-JavaScript override for every initially hidden reveal", () => {
    const page = <CanonicalHomepage />;
    const pageHtml = renderToStaticMarkup(page);
    const documentHtml = renderToStaticMarkup(
      <RootLayout>{page}</RootLayout>
    );

    expect(pageHtml).toContain("sa-reveal");
    expect(pageHtml).toContain("opacity-0");
    expect(documentHtml).toContain(`<noscript><style>${REVEAL_NO_SCRIPT_CSS}</style></noscript>`);
    expect(REVEAL_NO_SCRIPT_CSS).toContain("opacity:1!important");
    expect(REVEAL_NO_SCRIPT_CSS).toContain("transform:none!important");
  });

  it("renders collapsed semantic FAQ disclosures with answers always in HTML", () => {
    const html = renderHomepage();
    const faqSection = html.match(/<section id="faq"[\s\S]*?<\/section>/)?.[0];

    expect(faqSection?.match(/<details\b/g)).toHaveLength(HOME_FAQS.length);
    expect(faqSection?.match(/<summary\b/g)).toHaveLength(HOME_FAQS.length);
    expect(faqSection?.match(/class="sa-faq-answer\b/g)).toHaveLength(
      HOME_FAQS.length
    );
    expect(faqSection).not.toMatch(/<details\b[^>]*\sopen(?:=|\s|>)/);

    for (const { answer } of HOME_FAQS) {
      expect(visibleText(faqSection ?? "")).toContain(answer);
    }
    expect(REVEAL_NO_SCRIPT_CSS).toContain(
      "details:not([open]) .sa-faq-answer{display:block!important}"
    );
  });

  it("server-renders the trusted technology strip before the footer", () => {
    const html = renderHomepage();
    const strip = html.match(
      /<section aria-labelledby="trusted-technology-heading"[\s\S]*?<\/section>/
    )?.[0];

    expect(strip).toBeDefined();
    expect(visibleText(strip ?? "")).toContain("Powered by");
    expect(strip?.match(/<img\b/g)).toHaveLength(4);
    for (const name of [
      "Stripe",
      "Google Calendar",
      "Anthropic",
      "Cloudflare",
    ]) {
      expect(strip).toContain(`alt="${name}"`);
    }
    expect(strip).toContain("grid-cols-2");
    expect(strip).toContain("sm:grid-cols-4");
    expect(strip).not.toContain("grayscale");
    expect(strip).not.toContain("group-hover");
    expect(html.indexOf('id="trusted-technology-heading"')).toBeLessThan(
      html.indexOf("<footer")
    );
  });
});

describe("homepage JSON-LD", () => {
  it("emits one valid graph with two purchasable offers and FAQ parity", () => {
    const html = renderHomepage();
    const jsonScript = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
    );

    expect(jsonScript).not.toBeNull();
    expect(html.match(/type="application\/ld\+json"/g)).toHaveLength(1);

    const data = JSON.parse(jsonScript?.[1] ?? "{}") as {
      "@context": string;
      "@graph": JsonRecord[];
    };
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@graph"].map((node) => node["@type"])).toEqual([
      "Organization",
      "SoftwareApplication",
      "FAQPage",
    ]);

    const organization = data["@graph"].find(
      (node) => node["@type"] === "Organization"
    );
    expect(organization).toMatchObject({
      name: "SimplAssist",
      url: "https://simplassist.com/",
      logo: "https://simplassist.com/logo-light.png",
    });

    const application = data["@graph"].find(
      (node) => node["@type"] === "SoftwareApplication"
    );
    expect(application).toMatchObject({
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
    });

    const offers = application?.offers as JsonRecord[];
    expect(offers).toHaveLength(2);
    expect(offers.map(({ name, price, priceCurrency }) => ({
      name,
      price,
      priceCurrency,
    }))).toEqual([
      { name: "SMS Only", price: 25, priceCurrency: "USD" },
      { name: "SMS + Web Chat", price: 45, priceCurrency: "USD" },
    ]);
    expect(offers.map((offer) => offer.name)).not.toContain("Full Suite");

    for (const offer of offers) {
      const specifications = offer.priceSpecification as JsonRecord[];
      expect(specifications).toHaveLength(2);
      expect(specifications).toContainEqual(
        expect.objectContaining({
          "@type": "UnitPriceSpecification",
          name: "Monthly subscription",
          price: offer.price,
          priceCurrency: "USD",
          billingDuration: "P1M",
        })
      );
      expect(specifications).toContainEqual({
        "@type": "PriceSpecification",
        name: "One-time SMS activation fee",
        price: 25,
        priceCurrency: "USD",
      });
    }

    const faqPage = data["@graph"].find(
      (node) => node["@type"] === "FAQPage"
    );
    expect(faqPage?.mainEntity).toEqual(
      HOME_FAQS.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: {
          "@type": "Answer",
          text: answer,
        },
      }))
    );

    const structuredDataKeys: string[] = [];
    JSON.stringify(getHomepageJsonLd(), (key, value) => {
      structuredDataKeys.push(key.toLowerCase());
      return value;
    });
    expect(structuredDataKeys).not.toContain("review");
    expect(structuredDataKeys).not.toContain("reviews");
    expect(structuredDataKeys).not.toContain("rating");
    expect(structuredDataKeys).not.toContain("aggregaterating");
  });
});
