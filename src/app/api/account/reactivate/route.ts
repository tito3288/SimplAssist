import { NextResponse } from "next/server";
import {
  AccountDeletionServiceError,
  accountDeletionErrorBody,
  reactivateCustomerAccount,
} from "@/lib/account/deletion.server";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";

export async function POST() {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return workspace.response;

  const { business, user } = workspace.access;

  try {
    await reactivateCustomerAccount({
      businessId: business.id,
      ownerId: user.id,
      billingMode: business.billing_mode,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const mapped =
      error instanceof AccountDeletionServiceError
        ? error
        : new AccountDeletionServiceError(
            "account_reactivation_failed",
            500,
            "Failed to reactivate account",
          );
    return NextResponse.json(accountDeletionErrorBody(mapped), {
      status: mapped.status,
    });
  }
}
