import { z } from "zod";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

export const adminServiceControlReasonSchema = z
  .string()
  .refine(
    (value) => !CONTROL_CHARACTER.test(value),
    "Reason cannot contain control characters",
  )
  .transform((value) => value.trim())
  .pipe(
    z.string().refine((value) => {
      const characterCount = Array.from(value).length;
      return characterCount >= 8 && characterCount <= 500;
    }, "Reason must contain between 8 and 500 characters"),
  );

const serviceSchema = z.enum(["ai_replies", "texting", "bookings"]);
const operationalTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .nullable();

export const adminAccountServiceControlRequestSchema = z.discriminatedUnion(
  "action",
  [
    z
      .object({
        action: z.literal("suspend"),
        reason: adminServiceControlReasonSchema,
      })
      .strict(),
    z
      .object({
        action: z.literal("reactivate"),
        reason: adminServiceControlReasonSchema,
      })
      .strict(),
    z
      .object({
        action: z.literal("pause"),
        service: serviceSchema,
        reason: adminServiceControlReasonSchema.optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal("resume"),
        service: serviceSchema,
        reason: adminServiceControlReasonSchema.optional(),
      })
      .strict(),
  ],
);

export const adminOperationalControlSnapshotSchema = z
  .object({
    businessId: z.string().uuid(),
    operationsSuspendedAt: operationalTimestampSchema,
    aiRepliesPausedAt: operationalTimestampSchema,
    textingPausedAt: operationalTimestampSchema,
    bookingsPausedAt: operationalTimestampSchema,
  })
  .strict();

export const adminAccountServiceControlResponseSchema = z
  .object({
    changed: z.boolean(),
    adminEventId: z.string().uuid().nullable(),
    controls: adminOperationalControlSnapshotSchema,
  })
  .strict()
  .superRefine((response, context) => {
    if (response.changed !== (response.adminEventId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Operational-control audit result is inconsistent",
        path: ["adminEventId"],
      });
    }
  });

export type AdminOperationalControlSnapshot = z.infer<
  typeof adminOperationalControlSnapshotSchema
>;

export type AdminAccountServiceControlRequest = z.infer<
  typeof adminAccountServiceControlRequestSchema
>;

export type AdminAccountServiceControlResponse = z.infer<
  typeof adminAccountServiceControlResponseSchema
>;
