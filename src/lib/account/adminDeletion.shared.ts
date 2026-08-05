import { z } from "zod";
import { adminServiceControlReasonSchema } from "@/lib/admin/accountServiceControls.shared";

const timestampSchema = z
  .string()
  .refine(
    (value) => value.length > 0 && Number.isFinite(Date.parse(value)),
    "Invalid timestamp",
  );

export const adminAccountDeletionRequestSchema = z
  .object({
    // Deliberately no trim, case conversion, minimum, or maximum. The RPC
    // compares this byte-for-byte with the current locked database name.
    confirmationName: z.string(),
    acknowledgeLiveResources: z.boolean(),
    reason: adminServiceControlReasonSchema,
  })
  .strict();

export const accountDeletionPreviewSchema = z
  .object({
    businessId: z.string().uuid(),
    businessName: z.string(),
    billingMode: z.enum(["stripe", "invoiced", "comped"]),
    partnerId: z.string().uuid().nullable(),
    partnerSlug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(63)
      .nullable(),
    lifecycleStage: z.enum(["onboarding", "launched", "suspended"]),
    deletionScheduledFor: timestampSchema.nullable(),
    subscriptionStatus: z
      .enum(["active", "past_due", "canceled", "trialing"])
      .nullable(),
    campaignStatus: z.enum(["pending", "approved", "rejected"]).nullable(),
    assignedPhoneCount: z.number().int().nonnegative(),
    hasPendingPhoneNumber: z.boolean(),
    provisioningJobCount: z.number().int().nonnegative(),
    provisioningOperationState: z.enum(["idle", "active", "unknown"]),
    requiresLiveAcknowledgement: z.boolean(),
  })
  .strict()
  .superRefine((preview, context) => {
    if ((preview.partnerId === null) !== (preview.partnerSlug === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Partner identity is inconsistent",
      });
    }
    if (
      (preview.lifecycleStage === "suspended") !==
      (preview.deletionScheduledFor !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Lifecycle state is inconsistent",
      });
    }
    const requiresLiveAcknowledgement =
      preview.subscriptionStatus === "active" ||
      preview.subscriptionStatus === "trialing" ||
      preview.subscriptionStatus === "past_due" ||
      preview.campaignStatus === "pending" ||
      preview.campaignStatus === "approved" ||
      preview.assignedPhoneCount > 0 ||
      preview.hasPendingPhoneNumber;
    if (preview.requiresLiveAcknowledgement !== requiresLiveAcknowledgement) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Live-resource acknowledgement state is inconsistent",
      });
    }
  });

export const adminAccountDeletionRunSchema = z
  .object({
    scheduled: z
      .object({
        businessId: z.string().uuid(),
        deletedAt: timestampSchema,
        deletionScheduledFor: timestampSchema,
        stripeAction: z
          .object({
            generation: z.number().int().positive(),
            status: z.enum(["pending", "applied", "blocked"]),
            appliedAction: z.enum(["pause", "resume", "cancel"]).nullable(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    preview: accountDeletionPreviewSchema,
    adminEventCreated: z.boolean(),
    previouslyScheduledByAdmin: z.boolean(),
  })
  .strict()
  .superRefine((run, context) => {
    if (
      run.scheduled.businessId !== run.preview.businessId ||
      run.scheduled.deletionScheduledFor !== run.preview.deletionScheduledFor ||
      run.preview.lifecycleStage !== "suspended" ||
      (run.adminEventCreated && run.previouslyScheduledByAdmin)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Deletion result is inconsistent",
      });
    }
  });

export type AdminAccountDeletionRequest = z.infer<
  typeof adminAccountDeletionRequestSchema
>;
export type AdminAccountDeletionPreview = z.infer<
  typeof accountDeletionPreviewSchema
>;
