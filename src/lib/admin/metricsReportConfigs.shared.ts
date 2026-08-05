import { z } from "zod";

const CANONICAL_EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const FIRST_OF_MONTH = /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])-01$/;

// Hosted PostgREST must keep db-max-rows at 1,000 or higher. Staying one row
// below that boundary lets the loader reject an embedded array of 1,000 as
// potentially truncated instead of accepting an incomplete configuration.
export const ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT = 999;

const canonicalUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), "UUID must be canonical");
const normalizedUuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const reportingStartsOnSchema = z.string().regex(FIRST_OF_MONTH);
const selectionModeSchema = z.enum(["all", "selected"]);
const canonicalEmailSchema = z
  .string()
  .max(254)
  .regex(CANONICAL_EMAIL)
  .refine(
    (value) => value === value.trim().toLowerCase(),
    "Email must be canonical",
  );
const normalizedEmailSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().max(254).regex(CANONICAL_EMAIL));

const saveRecipientSchema = z
  .object({
    email: normalizedEmailSchema,
    enabled: z.boolean(),
  })
  .strict();

export const adminMetricsReportRecipientSchema = z
  .object({
    email: canonicalEmailSchema,
    enabled: z.boolean(),
  })
  .strict();

const saveCommonShape = {
  selectionMode: selectionModeSchema,
  reportingStartsOn: reportingStartsOnSchema,
  enabled: z.boolean(),
  recipients: z
    .array(saveRecipientSchema)
    .max(ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT),
  selectedBusinessIds: z
    .array(normalizedUuidSchema)
    .max(ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT),
} as const;

export const adminMetricsReportConfigSaveRequestSchema = z
  .discriminatedUnion("scopeKind", [
    z
      .object({
        scopeKind: z.literal("direct"),
        ...saveCommonShape,
      })
      .strict(),
    z
      .object({
        scopeKind: z.literal("partner"),
        partnerId: normalizedUuidSchema,
        ...saveCommonShape,
      })
      .strict(),
  ])
  .superRefine((request, context) => {
    const recipientEmails = request.recipients.map(({ email }) => email);
    if (new Set(recipientEmails).size !== recipientEmails.length) {
      context.addIssue({
        code: "custom",
        message: "Recipient emails must be unique",
        path: ["recipients"],
      });
    }

    if (
      request.enabled &&
      !request.recipients.some((recipient) => recipient.enabled)
    ) {
      context.addIssue({
        code: "custom",
        message: "An enabled report requires an enabled recipient",
        path: ["recipients"],
      });
    }

    if (
      (request.selectionMode === "all" &&
        request.selectedBusinessIds.length !== 0) ||
      (request.selectionMode === "selected" &&
        request.selectedBusinessIds.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Business selection does not match the selection mode",
        path: ["selectedBusinessIds"],
      });
    }

    if (
      new Set(request.selectedBusinessIds).size !==
      request.selectedBusinessIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Selected businesses must be unique",
        path: ["selectedBusinessIds"],
      });
    }
  })
  .transform((request) => ({
    ...request,
    recipients: [...request.recipients].sort((left, right) =>
      left.email.localeCompare(right.email),
    ),
    selectedBusinessIds: [...request.selectedBusinessIds].sort(),
  }));

export const adminMetricsReportConfigSchema = z
  .object({
    id: canonicalUuidSchema,
    scopeKind: z.enum(["direct", "partner"]),
    partnerId: canonicalUuidSchema.nullable(),
    selectionMode: selectionModeSchema,
    reportingStartsOn: reportingStartsOnSchema,
    enabled: z.boolean(),
    recipients: z
      .array(adminMetricsReportRecipientSchema)
      .max(ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT),
    selectedBusinessIds: z
      .array(canonicalUuidSchema)
      .max(ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT),
  })
  .strict()
  .superRefine((config, context) => {
    if (
      (config.scopeKind === "direct" && config.partnerId !== null) ||
      (config.scopeKind === "partner" && config.partnerId === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Report scope identity is inconsistent",
        path: ["partnerId"],
      });
    }

    const recipientEmails = config.recipients.map(({ email }) => email);
    if (new Set(recipientEmails).size !== recipientEmails.length) {
      context.addIssue({
        code: "custom",
        message: "Recipient emails must be unique",
        path: ["recipients"],
      });
    }

    if (
      new Set(config.selectedBusinessIds).size !==
      config.selectedBusinessIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Selected businesses must be unique",
        path: ["selectedBusinessIds"],
      });
    }

    if (
      (config.selectionMode === "all" &&
        config.selectedBusinessIds.length !== 0) ||
      (config.selectionMode === "selected" &&
        config.selectedBusinessIds.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Business selection does not match the selection mode",
        path: ["selectedBusinessIds"],
      });
    }

    if (
      config.enabled &&
      !config.recipients.some((recipient) => recipient.enabled)
    ) {
      context.addIssue({
        code: "custom",
        message: "An enabled report requires an enabled recipient",
        path: ["recipients"],
      });
    }
  })
  .transform((config) => ({
    ...config,
    recipients: [...config.recipients].sort((left, right) =>
      left.email.localeCompare(right.email),
    ),
    selectedBusinessIds: [...config.selectedBusinessIds].sort(),
  }));

export const adminMetricsReportBusinessSchema = z
  .object({
    id: canonicalUuidSchema,
    name: z.string().trim().min(1),
  })
  .strict();

const directSettingsSchema = z
  .object({
    config: adminMetricsReportConfigSchema.nullable(),
    businesses: z.array(adminMetricsReportBusinessSchema),
  })
  .strict();

const partnerSettingsSchema = z
  .object({
    id: canonicalUuidSchema,
    name: z.string().trim().min(1),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    config: adminMetricsReportConfigSchema.nullable(),
    businesses: z.array(adminMetricsReportBusinessSchema),
  })
  .strict();

export const adminMetricsReportConfigSettingsSchema = z
  .object({
    direct: directSettingsSchema,
    partners: z.array(partnerSettingsSchema),
  })
  .strict()
  .superRefine((settings, context) => {
    if (
      settings.direct.config !== null &&
      (settings.direct.config.scopeKind !== "direct" ||
        settings.direct.config.partnerId !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Direct report configuration is inconsistent",
        path: ["direct", "config"],
      });
    }

    const partnerIds = new Set<string>();
    const businessIds = new Set<string>();
    for (const business of settings.direct.businesses) {
      if (businessIds.has(business.id)) {
        context.addIssue({
          code: "custom",
          message: "A business appears in more than one report scope",
          path: ["direct", "businesses"],
        });
      }
      businessIds.add(business.id);
    }

    settings.partners.forEach((partner, partnerIndex) => {
      if (partnerIds.has(partner.id)) {
        context.addIssue({
          code: "custom",
          message: "Partner scopes must be unique",
          path: ["partners", partnerIndex, "id"],
        });
      }
      partnerIds.add(partner.id);

      if (
        partner.config !== null &&
        (partner.config.scopeKind !== "partner" ||
          partner.config.partnerId !== partner.id)
      ) {
        context.addIssue({
          code: "custom",
          message: "Partner report configuration is inconsistent",
          path: ["partners", partnerIndex, "config"],
        });
      }

      for (const business of partner.businesses) {
        if (businessIds.has(business.id)) {
          context.addIssue({
            code: "custom",
            message: "A business appears in more than one report scope",
            path: ["partners", partnerIndex, "businesses"],
          });
        }
        businessIds.add(business.id);
      }
    });
  });

export type AdminMetricsReportConfigSaveRequest = z.infer<
  typeof adminMetricsReportConfigSaveRequestSchema
>;
export type AdminMetricsReportRecipient = z.infer<
  typeof adminMetricsReportRecipientSchema
>;
export type AdminMetricsReportConfig = z.infer<
  typeof adminMetricsReportConfigSchema
>;
export type AdminMetricsReportBusiness = z.infer<
  typeof adminMetricsReportBusinessSchema
>;
export type AdminMetricsReportConfigSettings = z.infer<
  typeof adminMetricsReportConfigSettingsSchema
>;
