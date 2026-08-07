import "server-only";

import type { BusinessEmailBrand } from "./businessEmailBrand.server";
import { sendBusinessEmail } from "./sender";

export type PasswordResetEmailInput = {
  brand: BusinessEmailBrand;
  recipient: string;
  resetUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validateResetUrl(resetUrl: string, expectedOrigin: string): URL {
  const url = new URL(resetUrl);
  const expectedKeys = ["flow", "state", "token_hash", "type"];
  const actualKeys = Array.from(url.searchParams.keys()).sort();

  if (
    url.origin !== expectedOrigin ||
    url.pathname !== "/api/auth/callback" ||
    url.username ||
    url.password ||
    url.hash ||
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    expectedKeys.some((key) => url.searchParams.getAll(key).length !== 1) ||
    url.searchParams.get("flow") !== "reset" ||
    url.searchParams.get("type") !== "recovery" ||
    !isTrimmedValue(url.searchParams.get("token_hash")) ||
    !isTrimmedValue(url.searchParams.get("state"))
  ) {
    throw new Error("Password reset URL is malformed");
  }

  return url;
}

function isTrimmedValue(value: string | null): value is string {
  return Boolean(value && value === value.trim());
}

export async function sendPasswordResetEmail(
  input: PasswordResetEmailInput,
): Promise<void> {
  const resetUrl = validateResetUrl(input.resetUrl, input.brand.publicOrigin);
  const subject = `Reset your ${input.brand.name} password`;
  const lines = [
    "Hi,",
    `We received a request to reset your ${input.brand.name} password.`,
    `Choose a new password: ${resetUrl.toString()}`,
    "This is a one-time link. If it has expired or was already used, request another reset email from the sign-in page.",
    `— The ${input.brand.name} Team`,
  ];

  await sendBusinessEmail({
    brand: input.brand,
    context: "passwordReset",
    sensitive: true,
    message: {
      to: [input.recipient],
      subject,
      text: lines.join("\n\n"),
      html: [
        `<p>${escapeHtml(lines[0])}</p>`,
        `<p>${escapeHtml(lines[1])}</p>`,
        `<p><a href="${escapeHtml(resetUrl.toString())}">Choose a new password</a></p>`,
        `<p>${escapeHtml(lines[3])}</p>`,
        `<p>${escapeHtml(lines[4])}</p>`,
      ].join(""),
    },
  });
}
