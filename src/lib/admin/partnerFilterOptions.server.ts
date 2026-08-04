import "server-only";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const ADMIN_PARTNER_FILTER_OPTIONS_COLUMNS =
  "id,name,businesses!businesses_partner_id_fkey!inner(id)";

export interface AdminPartnerFilterOption {
  id: string;
  name: string;
}

export class AdminPartnerFilterOptionsReadError extends Error {
  readonly code: "query_failed" | "invalid_response" | "inconsistent_response";
  override readonly cause?: unknown;

  constructor(
    code: AdminPartnerFilterOptionsReadError["code"],
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "AdminPartnerFilterOptionsReadError";
    this.code = code;
    this.cause = cause;
  }
}

const partnerFilterRowSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1),
    businesses: z
      .array(z.object({ id: z.string().uuid() }).strict())
      .min(1),
  })
  .strict();

/**
 * Lists every partner that currently owns at least one business. The caller
 * must authenticate the admin before invoking this service-role read.
 */
export async function loadAdminPartnerFilterOptions(): Promise<
  AdminPartnerFilterOption[]
> {
  const { data, error } = await supabaseAdmin
    .from("partners")
    .select(ADMIN_PARTNER_FILTER_OPTIONS_COLUMNS)
    .limit(1, { referencedTable: "businesses" });

  if (error) {
    throw new AdminPartnerFilterOptionsReadError(
      "query_failed",
      "Could not load admin partner filter options.",
      error,
    );
  }

  const parsed = z.array(partnerFilterRowSchema).safeParse(data);
  if (!parsed.success) {
    throw new AdminPartnerFilterOptionsReadError(
      "invalid_response",
      "Admin partner filter options returned an invalid response.",
      parsed.error,
    );
  }

  const optionsById = new Map<string, AdminPartnerFilterOption>();
  for (const row of parsed.data) {
    const existing = optionsById.get(row.id);
    if (existing && existing.name !== row.name) {
      throw new AdminPartnerFilterOptionsReadError(
        "inconsistent_response",
        "Admin partner filter display facts disagree.",
      );
    }

    optionsById.set(row.id, {
      id: row.id,
      name: row.name,
    });
  }

  return Array.from(optionsById.values()).sort(
    (left, right) =>
      left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
      left.name.localeCompare(right.name, "en") ||
      left.id.localeCompare(right.id),
  );
}
