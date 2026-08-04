export type AdminBusinessLifecycle = "active" | "scheduled" | "terminal";

export function getAdminBusinessLifecycle({
  deletedAt,
  deletionScheduledFor,
}: {
  deletedAt: string | null;
  deletionScheduledFor: string | null;
}): AdminBusinessLifecycle {
  if (deletedAt === null && deletionScheduledFor === null) return "active";
  if (deletedAt !== null && deletionScheduledFor !== null) return "scheduled";
  return "terminal";
}
