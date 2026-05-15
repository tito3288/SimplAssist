import type { RegistrationStatus } from "@/types/database";

export interface MappedStatus {
  // null means "intermediate state — audit only, do not write to row, do not email".
  dbStatus: RegistrationStatus | null;
  isTerminal: boolean;
}

export interface BrandStatusInput {
  identityStatus?: string | null;
  status?: string | null;
}

export interface CampaignStatusInput {
  campaignStatus?: string | null;
  submissionStatus?: string | null;
}

// Brand mapping. Telnyx enums (verified against
// node_modules/telnyx/resources/messaging-10dlc/brand/brand.d.ts):
//   identityStatus: VERIFIED | UNVERIFIED | SELF_DECLARED | VETTED_VERIFIED
//   status:         OK | REGISTRATION_PENDING | REGISTRATION_FAILED
export function mapBrandStatus(input: BrandStatusInput): MappedStatus {
  const identity = input.identityStatus ?? null;
  const status = input.status ?? null;

  if (identity === "VERIFIED" || identity === "VETTED_VERIFIED") {
    return { dbStatus: "approved", isTerminal: true };
  }

  if (identity === "UNVERIFIED" && status === "REGISTRATION_FAILED") {
    return { dbStatus: "rejected", isTerminal: true };
  }

  if (identity === "UNVERIFIED" && status === "REGISTRATION_PENDING") {
    return { dbStatus: null, isTerminal: false };
  }

  if (identity === "SELF_DECLARED") {
    // Sole Proprietor OTP path — Phase 11 territory. Audit only here.
    console.warn(
      "[statusMapper] SELF_DECLARED brand status received — Phase 11 OTP flow, ignoring"
    );
    return { dbStatus: null, isTerminal: false };
  }

  if (identity === null && status === "OK") {
    // Heartbeat / metadata sync without status transition.
    return { dbStatus: null, isTerminal: false };
  }

  console.warn(
    `[statusMapper] unknown brand status: identityStatus=${identity} status=${status}`
  );
  return { dbStatus: null, isTerminal: false };
}

// Campaign mapping. Telnyx enums (verified against
// node_modules/telnyx/resources/messaging-10dlc/campaign/campaign.d.ts:204):
//   campaignStatus: TCR_PENDING | TCR_SUSPENDED | TCR_EXPIRED | TCR_ACCEPTED |
//                   TCR_FAILED | TELNYX_ACCEPTED | TELNYX_FAILED | MNO_PENDING |
//                   MNO_ACCEPTED | MNO_REJECTED | MNO_PROVISIONED |
//                   MNO_PROVISIONING_FAILED
//   submissionStatus: CREATED | FAILED | PENDING
export function mapCampaignStatus(input: CampaignStatusInput): MappedStatus {
  const campaign = input.campaignStatus ?? null;
  const submission = input.submissionStatus ?? null;

  switch (campaign) {
    case "MNO_PROVISIONED":
    case "MNO_ACCEPTED":
      return { dbStatus: "approved", isTerminal: true };

    case "TCR_ACCEPTED":
    case "TELNYX_ACCEPTED":
    case "TCR_PENDING":
    case "MNO_PENDING":
      return { dbStatus: null, isTerminal: false };

    case "TCR_FAILED":
    case "TELNYX_FAILED":
    case "MNO_REJECTED":
    case "MNO_PROVISIONING_FAILED":
    case "TCR_SUSPENDED":
    case "TCR_EXPIRED":
      return { dbStatus: "rejected", isTerminal: true };

    case null:
      // Early failure can arrive before any campaignStatus is set.
      if (submission === "FAILED") {
        return { dbStatus: "rejected", isTerminal: true };
      }
      return { dbStatus: null, isTerminal: false };

    default:
      console.warn(
        `[statusMapper] unknown campaign status: campaignStatus=${campaign} submissionStatus=${submission}`
      );
      return { dbStatus: null, isTerminal: false };
  }
}

// Telnyx puts rejection text under various keys depending on the resource and
// payload shape. Try the documented spots in order and fall back to null.
export function extractRejectionReason(
  payload: Record<string, unknown> | null | undefined
): string | null {
  if (!payload) return null;

  const direct = pickString(payload, [
    "rejectionReason",
    "rejection_reason",
    "failureReason",
    "failure_reason",
    "reason",
  ]);
  if (direct) return direct;

  const errors = payload.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0];
    if (typeof first === "object" && first !== null) {
      const obj = first as Record<string, unknown>;
      const msg = pickString(obj, ["description", "detail", "message", "title"]);
      if (msg) return msg;
    }
    if (typeof first === "string") return first;
  }

  return null;
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}
