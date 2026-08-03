import { resolveBusinessEmailBrand } from "./businessEmailBrand.server";
import { sendBusinessEmail } from "./sender";

interface ApprovedInput {
  businessId: string;
  businessName: string;
  recipients: string[];
}

interface RejectedInput {
  businessId: string;
  businessName: string;
  rejectionReason: string | null;
  recipients: string[];
}

export function dedupeRecipients(
  emails: (string | null | undefined)[]
): string[] {
  const seen = new Set<string>();
  for (const e of emails) {
    if (!e) continue;
    const normalized = e.trim().toLowerCase();
    if (!normalized) continue;
    seen.add(normalized);
  }
  return Array.from(seen);
}

function htmlFromParagraphs(paragraphs: string[]): string {
  return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendSafe(args: {
  businessId: string;
  to: string[];
  context: string;
  content: (
    brand: Awaited<ReturnType<typeof resolveBusinessEmailBrand>>,
  ) => { subject: string; paragraphs: string[] };
}): Promise<void> {
  if (args.to.length === 0) {
    console.warn(
      `[email:registrationStatus] ${args.context}: no recipients, skipping`
    );
    return;
  }
  try {
    const brand = await resolveBusinessEmailBrand(args.businessId);
    const content = args.content(brand);
    await sendBusinessEmail({
      brand,
      context: `registrationStatus:${args.context}`,
      message: {
        to: args.to,
        subject: content.subject,
        text: content.paragraphs.join("\n\n"),
        html: htmlFromParagraphs(content.paragraphs),
      },
    });
  } catch (err) {
    console.error(
      `[email:registrationStatus] ${args.context} send failed:`,
      err
    );
  }
}

export async function sendBrandApprovedEmail(
  input: ApprovedInput
): Promise<void> {
  await sendSafe({
    businessId: input.businessId,
    to: input.recipients,
    context: "brand_approved",
    content: (brand) => ({
      subject: `Your ${brand.name} business is approved to send SMS`,
      paragraphs: [
        "Hi,",
        `Good news — the carrier review for ${input.businessName} is complete. Your business brand has been approved by The Campaign Registry.`,
        "Your campaign is the next step in the review process. We'll email you again as soon as the carriers approve it (usually 1–3 business days). Once your campaign is approved, your AI assistant will start replying to text messages automatically.",
        "No action needed from you. If you have questions, reply to this email.",
        `— The ${brand.name} Team`,
      ],
    }),
  });
}

export async function sendBrandRejectedEmail(
  input: RejectedInput
): Promise<void> {
  const reasonLine = input.rejectionReason
    ? `Reason from the carrier: ${input.rejectionReason}`
    : "The carrier did not provide a specific reason.";
  await sendSafe({
    businessId: input.businessId,
    to: input.recipients,
    context: "brand_rejected",
    content: (brand) => ({
      subject: `We need to update your ${brand.name} business registration`,
      paragraphs: [
        "Hi,",
        `The carrier review for ${input.businessName} came back without approval.`,
        reasonLine,
        `The most common causes are a mismatched legal business name, an incorrect EIN, or a website that doesn't match the registered business. Log in to ${brand.name} at ${new URL("/login", brand.publicOrigin)}, use Fix & resubmit to update your business verification details, and continue through to Review & Submit — we'll re-file your verification with the carrier automatically.`,
        "If you're not sure what to fix, reply to this email and we'll help.",
        `— The ${brand.name} Team`,
      ],
    }),
  });
}

export async function sendCampaignApprovedEmail(
  input: ApprovedInput
): Promise<void> {
  await sendSafe({
    businessId: input.businessId,
    to: input.recipients,
    context: "campaign_approved",
    content: (brand) => ({
      subject: `Your ${brand.name} SMS campaign is live`,
      paragraphs: [
        "Hi,",
        `Carriers have approved the SMS campaign for ${input.businessName}. Your AI assistant is now live and will reply to incoming text messages from your customers.`,
        `You can manage messages, contacts, and AI settings from your ${brand.name} dashboard: ${new URL("/dashboard", brand.publicOrigin)}`,
        `— The ${brand.name} Team`,
      ],
    }),
  });
}

export async function sendCampaignRejectedEmail(
  input: RejectedInput
): Promise<void> {
  const reasonLine = input.rejectionReason
    ? `Reason from the carrier: ${input.rejectionReason}`
    : "The carrier did not provide a specific reason.";
  await sendSafe({
    businessId: input.businessId,
    to: input.recipients,
    context: "campaign_rejected",
    content: (brand) => ({
      subject: `We need to update your ${brand.name} SMS campaign`,
      paragraphs: [
        "Hi,",
        `The carrier review for the SMS campaign on ${input.businessName} came back without approval.`,
        reasonLine,
        "This usually means the use-case description, opt-in language, or sample messages need adjustment. Common fixes:",
        "• Make sure your sample messages match what your AI will actually send.\n• Make sure the opt-in description describes how customers consent to texts (e.g. by texting your business or filling out a form).\n• Avoid words that look like they target restricted use cases (lending, gambling, cannabis, etc.).",
        `You can update these from the ${brand.name} dashboard at ${new URL("/dashboard", brand.publicOrigin)} and resubmit. Reply to this email if you need help.`,
        `— The ${brand.name} Team`,
      ],
    }),
  });
}
