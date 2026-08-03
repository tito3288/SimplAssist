import "server-only";

import { resolveBusinessEmailBrand } from "./businessEmailBrand.server";
import { sendBusinessEmail } from "./sender";

export type ConciergeSetupEmailInput = {
  businessId: string;
  businessName: string;
  recipient: string;
  setupUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validateSetupUrl(setupUrl: string, expectedOrigin: string): URL {
  const url = new URL(setupUrl);
  const expectedKeys = ["flow", "token_hash", "type"];
  const actualKeys = Array.from(url.searchParams.keys()).sort();
  if (
    url.origin !== expectedOrigin ||
    url.pathname !== "/api/auth/callback" ||
    url.username ||
    url.password ||
    url.hash ||
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    url.searchParams.getAll("flow").length !== 1 ||
    url.searchParams.getAll("token_hash").length !== 1 ||
    url.searchParams.getAll("type").length !== 1 ||
    url.searchParams.get("type") !== "recovery" ||
    url.searchParams.get("flow") !== "concierge" ||
    !url.searchParams.get("token_hash")?.trim()
  ) {
    throw new Error("Concierge setup URL is malformed");
  }
  return url;
}

export async function sendConciergeSetupEmail(
  input: ConciergeSetupEmailInput,
): Promise<void> {
  const brand = await resolveBusinessEmailBrand(input.businessId);
  const setupUrl = validateSetupUrl(input.setupUrl, brand.publicOrigin);
  const subject = `Set up your ${brand.name} account`;
  const lines = [
    "Hi,",
    `Your account for ${input.businessName} is ready on ${brand.name}.`,
    `Choose a password to finish setup: ${setupUrl.toString()}`,
    "This is a one-time setup link. If it has expired or was already used, contact your account administrator for a fresh link.",
    `— The ${brand.name} Team`,
  ];

  await sendBusinessEmail({
    brand,
    context: "conciergeSetup",
    sensitive: true,
    message: {
      to: [input.recipient],
      subject,
      text: lines.join("\n\n"),
      html: [
        `<p>${escapeHtml(lines[0])}</p>`,
        `<p>${escapeHtml(lines[1])}</p>`,
        `<p><a href="${escapeHtml(setupUrl.toString())}">Choose your password</a></p>`,
        `<p>${escapeHtml(lines[3])}</p>`,
        `<p>${escapeHtml(lines[4])}</p>`,
      ].join(""),
    },
  });
}
