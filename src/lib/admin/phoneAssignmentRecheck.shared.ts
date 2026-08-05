import { z } from "zod";

export const adminPhoneAssignmentRecheckRequestSchema = z
  .object({})
  .strict();

export const adminPhoneAssignmentRecheckResponseSchema = z
  .object({
    requested: z.literal(true),
  })
  .strict();

export const adminPhoneAssignmentRecheckAuditResultSchema = z
  .object({
    business_id: z.string().uuid(),
    admin_event_id: z.string().uuid(),
    requested_at: z.string().datetime({ offset: true }),
  })
  .strict();

export type AdminPhoneAssignmentRecheckRequest = z.infer<
  typeof adminPhoneAssignmentRecheckRequestSchema
>;

export type AdminPhoneAssignmentRecheckResponse = z.infer<
  typeof adminPhoneAssignmentRecheckResponseSchema
>;
