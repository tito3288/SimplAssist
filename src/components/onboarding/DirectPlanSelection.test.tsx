import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BrandProvider } from "@/components/branding/BrandProvider";
import type { RequestBrand } from "@/lib/branding/types";
import DirectPlanSelection, {
  reconcileDirectPlanSelection,
} from "./DirectPlanSelection";

vi.mock("@/components/waitlist/FullSuiteWaitlistButton", () => ({
  FullSuiteWaitlistButton: () => <button>Notify Me When It Launches</button>,
}));

const PARTNER_BRAND: RequestBrand = {
  source: "partner_host",
  isPreview: false,
  brand: {
    kind: "partner",
    partnerId: "11111111-1111-4111-8111-111111111111",
    slug: "alpha-dog",
    name: "Alpha Dog Agency",
    publicOrigin: "https://alpha-dog.example.test",
    logoLightUrl: null,
    logoDarkUrl: null,
    faviconUrl: null,
    colors: {
      primary: "#123456",
      primaryHover: "#123457",
      primaryActive: "#123458",
      accent: "#123459",
      primaryDark: "#abcdef",
      primaryHoverDark: "#abcdee",
      primaryActiveDark: "#abcded",
      accentDark: "#abcdec",
    },
  },
};

function renderSelection(args: {
  initialPlan: "chat_only" | "sms_and_chat" | null;
  chatOnlyAvailable: boolean;
}) {
  return renderToStaticMarkup(
    <BrandProvider requestBrand={PARTNER_BRAND}>
      <DirectPlanSelection
        {...args}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />
    </BrandProvider>,
  );
}

function radio(markup: string, value: string): string | undefined {
  return (markup.match(/<input\b[^>]*>/g) ?? []).find((input) =>
    input.includes(`value="${value}"`),
  );
}

describe("DirectPlanSelection", () => {
  it("renders enabled Chat Only beside existing plans with partner copy and no setup fee", () => {
    const markup = renderSelection({
      initialPlan: "chat_only",
      chatOnlyAvailable: true,
    });

    expect(markup).toContain("Choose your Alpha Dog Agency plan");
    expect(markup).toContain("Chat Only");
    expect(markup).toContain("Starter / SMS Only");
    expect(markup).toContain("Growth / SMS + Web Chat");
    expect(markup).toContain("Pro / Full Suite");
    expect(markup).not.toContain("SimplAssist");
    expect(markup).toContain("$10 today");
    expect(markup).toContain("200 AI replies/month");
    expect(markup).toContain("No setup or SMS activation fee");
    expect(radio(markup, "chat_only")).toContain('checked=""');
  });

  it("does not render Chat Only when the server availability flag is false", () => {
    const markup = renderSelection({
      initialPlan: "chat_only",
      chatOnlyAvailable: false,
    });

    expect(radio(markup, "chat_only")).toBeUndefined();
    expect(markup).not.toContain("No setup or SMS activation fee");
    expect(radio(markup, "sms_and_chat")).toContain('checked=""');
  });

  it("keeps Growth selected and recommended by default when Chat Only is enabled", () => {
    const markup = renderSelection({
      initialPlan: null,
      chatOnlyAvailable: true,
    });

    expect(radio(markup, "sms_and_chat")).toContain('checked=""');
    expect(radio(markup, "chat_only")).not.toContain('checked=""');
    expect(markup).toContain("Recommended");
  });

  it("resets a mounted Chat Only selection when availability is withdrawn", () => {
    expect(
      reconcileDirectPlanSelection({
        currentPlan: "chat_only",
        initialPlan: "chat_only",
        selectablePlans: ["sms_only", "sms_and_chat", "full"],
      }),
    ).toBe("sms_and_chat");
  });
});
