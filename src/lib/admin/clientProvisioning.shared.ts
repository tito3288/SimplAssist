import { z } from "zod";

const CANONICAL_EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const normalizedEmailSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().max(254).regex(CANONICAL_EMAIL));

const normalizedBusinessNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(200));

export const createPartnerClientSchema = z
  .object({
    email: normalizedEmailSchema,
    businessName: normalizedBusinessNameSchema,
    partnerId: z.string().uuid(),
    billingMode: z.enum(["invoiced", "comped"]),
    partnerPlan: z.enum(["sms_only", "sms_and_chat", "full"]),
    sendSetupEmailNow: z.boolean().optional().default(false),
  })
  .strict();

export const retryPartnerClientSchema = z
  .object({
    sendSetupEmailNow: z.boolean().optional().default(false),
  })
  .strict();

export const provisioningIdSchema = z.string().uuid();

export const provisioningStatusSchema = z.enum([
  "pending",
  "auth_created",
  "business_prepared",
  "assigned",
  "admin_setup",
  "invite_pending",
  "setup_email_sent",
  "needs_attention",
  "dismissed",
]);

export type ProvisioningStatus = z.infer<typeof provisioningStatusSchema>;

export const PROVISIONING_STATUS_PRESENTATION = {
  pending: { label: "Pending", tone: "neutral" },
  auth_created: { label: "Account created", tone: "info" },
  business_prepared: { label: "Business prepared", tone: "info" },
  assigned: { label: "Ready for setup", tone: "info" },
  admin_setup: { label: "Admin setup link generated", tone: "warning" },
  invite_pending: { label: "Setup delivery needs attention", tone: "danger" },
  setup_email_sent: { label: "Setup email sent", tone: "success" },
  needs_attention: { label: "Needs attention", tone: "danger" },
  dismissed: { label: "Dismissed", tone: "neutral" },
} as const satisfies Record<
  ProvisioningStatus,
  {
    label: string;
    tone: "neutral" | "info" | "warning" | "success" | "danger";
  }
>;

export const publicProvisioningJobSchema = z
  .object({
    id: z.string().uuid(),
    email: normalizedEmailSchema,
    businessName: normalizedBusinessNameSchema,
    partnerId: z.string().uuid(),
    partnerName: z.string().trim().min(1),
    billingMode: z.enum(["invoiced", "comped"]),
    partnerPlan: z.enum(["sms_only", "sms_and_chat", "full"]),
    status: provisioningStatusSchema,
    lastErrorCode: z.string().nullable(),
    authUserId: z.string().uuid().nullable(),
    businessId: z.string().uuid().nullable(),
    setupEmailSentAt: z.string().nullable(),
    inviteAttemptCount: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const provisioningPartnerAvailabilitySchema = z.enum([
  "active_connected",
  "inactive",
  "domain_pending",
  "unavailable",
]);

export const provisioningOperationStateSchema = z.enum([
  "idle",
  "active",
  "unknown",
]);

export const provisioningDismissalStateSchema = z.enum([
  "dismissible",
  "restore",
  "has_resources",
  "in_progress",
  "outcome_unknown",
  "not_dismissible",
]);

const httpsOriginSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.origin === value &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
});

export const adminProvisioningRecordSchema = z
  .object({
    provisioning: publicProvisioningJobSchema,
    accountBusinessId: z.string().uuid().nullable(),
    partnerAvailability: provisioningPartnerAvailabilitySchema,
    partnerOrigin: httpsOriginSchema.nullable(),
    operationState: provisioningOperationStateSchema,
    dismissalState: provisioningDismissalStateSchema,
    dismissedAt: z.string().nullable(),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      (record.provisioning.businessId !== null &&
        record.accountBusinessId !== record.provisioning.businessId) ||
      (record.provisioning.businessId === null &&
        record.provisioning.authUserId === null &&
        record.accountBusinessId !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Account business linkage is inconsistent",
      });
    }
    if (
      (record.partnerAvailability === "active_connected") !==
      (record.partnerOrigin !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Partner availability is inconsistent",
      });
    }
    if (
      (record.provisioning.status === "dismissed") !==
        (record.dismissedAt !== null) ||
      (record.provisioning.status === "dismissed") !==
        (record.dismissalState === "restore")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dismissal state is inconsistent",
      });
    }
    if (
      (record.operationState === "active") !==
      (record.dismissalState === "in_progress")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Active operation state is inconsistent",
      });
    }
    if (
      (record.operationState === "unknown") !==
      (record.dismissalState === "outcome_unknown")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unknown operation state is inconsistent",
      });
    }
  });

export const provisioningLifecycleResponseSchema = z
  .object({
    provisioningId: z.string().uuid(),
    status: provisioningStatusSchema,
  })
  .strict();

export type CreatePartnerClientInput = z.infer<
  typeof createPartnerClientSchema
>;
export type RetryPartnerClientInput = z.infer<typeof retryPartnerClientSchema>;
export type PublicProvisioningJob = z.infer<typeof publicProvisioningJobSchema>;
export type AdminProvisioningRecord = z.infer<
  typeof adminProvisioningRecordSchema
>;
export type ProvisioningPartnerAvailability = z.infer<
  typeof provisioningPartnerAvailabilitySchema
>;
export type ProvisioningDismissalState = z.infer<
  typeof provisioningDismissalStateSchema
>;
export type ProvisioningLifecycleResponse = z.infer<
  typeof provisioningLifecycleResponseSchema
>;

export type ProvisioningRouteResponse = {
  provisioning: PublicProvisioningJob;
  adminSetupUrl?: string;
};

export type SetupEmailRouteResponse = {
  provisioning: PublicProvisioningJob;
};
