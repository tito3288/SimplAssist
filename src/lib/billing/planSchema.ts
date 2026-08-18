import { z } from "zod";
import { SUBSCRIPTION_PLAN_IDS } from "@/types/database";

/**
 * Shared runtime reader for persisted plan identifiers. Mutation routes must
 * still apply their direct-sale or partner-assignment acquisition gate after
 * this schema recognizes a plan.
 */
export const subscriptionPlanSchema = z.enum(SUBSCRIPTION_PLAN_IDS);
