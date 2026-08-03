import { normalizeHostHeader } from "@/lib/branding/hostname";
import type { ActiveConnectedPartnerOption } from "./CreateClientForm";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseActiveConnectedPartnerOptions(rows: unknown): {
  partners: ActiveConnectedPartnerOption[];
  invalidRecordCount: number;
} {
  if (!Array.isArray(rows)) {
    return { partners: [], invalidRecordCount: 1 };
  }

  const partners: ActiveConnectedPartnerOption[] = [];
  const seenIds = new Set<string>();
  let invalidRecordCount = 0;

  for (const row of rows) {
    if (!isRecord(row)) {
      invalidRecordCount += 1;
      continue;
    }

    const { id, name, custom_domain, status, domain_status } = row;
    const normalizedDomain =
      typeof custom_domain === "string"
        ? normalizeHostHeader(custom_domain)
        : null;
    if (
      typeof id !== "string" ||
      !UUID.test(id) ||
      seenIds.has(id) ||
      typeof name !== "string" ||
      !name.trim() ||
      name !== name.trim() ||
      typeof custom_domain !== "string" ||
      normalizedDomain !== custom_domain ||
      status !== "active" ||
      domain_status !== "connected"
    ) {
      invalidRecordCount += 1;
      continue;
    }

    seenIds.add(id);
    partners.push({ id, name, customDomain: custom_domain });
  }

  return { partners, invalidRecordCount };
}
