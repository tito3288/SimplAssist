import { NextResponse } from "next/server";
import {
  AccountDeletionServiceError,
  accountDeletionErrorBody,
  scheduleCustomerAccountDeletion,
} from "@/lib/account/deletion.server";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";

export async function DELETE() {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return workspace.response;

  const { business, user } = workspace.access;

  try {
    const deletion = await scheduleCustomerAccountDeletion({
      businessId: business.id,
      ownerId: user.id,
      billingMode: business.billing_mode,
    });

    return NextResponse.json({
      success: true,
      deletion_scheduled_for: deletion.deletionScheduledFor,
    });
  } catch (error) {
    const mapped =
      error instanceof AccountDeletionServiceError
        ? error
        : new AccountDeletionServiceError(
            "account_deletion_failed",
            500,
            "Failed to delete account",
          );
    return NextResponse.json(accountDeletionErrorBody(mapped), {
      status: mapped.status,
    });
  }
}
