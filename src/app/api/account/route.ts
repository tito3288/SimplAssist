import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reconcileAccountDeletionStripeAction } from "@/lib/stripe/accountDeletionReconciler";

const DELETION_GRACE_PERIOD_MS = 60 * 24 * 60 * 60 * 1000;

type ScheduledStripeAction = {
  generation: number;
  status: "pending" | "applied" | "blocked";
};

type ScheduledDeletion = {
  deletionScheduledFor: string;
  stripeAction: ScheduledStripeAction | null;
};

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const now = new Date();
  const deletionDate = new Date(now.getTime() + DELETION_GRACE_PERIOD_MS);

  const { data: scheduled, error } = await supabaseAdmin.rpc(
    "schedule_account_deletion",
    {
      p_business_id: business.id,
      p_owner_id: user.id,
      p_deleted_at: now.toISOString(),
      p_deletion_scheduled_for: deletionDate.toISOString(),
    }
  );

  if (error) {
    console.error("[account] Delete scheduling error:", error);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }

  const deletion = parseScheduledDeletion(scheduled, business.id);
  if (!deletion) {
    console.error(
      `[account] Delete scheduling returned an invalid payload for business ${business.id}`
    );
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }

  if (deletion.stripeAction?.status === "pending") {
    try {
      const result = await reconcileAccountDeletionStripeAction({
        businessId: business.id,
        generation: deletion.stripeAction.generation,
      });

      if (result.outcome !== "applied") {
        console.warn(
          `[account] Stripe pause remains ${result.outcome} for business ${business.id}, generation ${deletion.stripeAction.generation}`
        );
      }
    } catch (stripeError) {
      console.error(
        `[account] Stripe pause reconciliation failed for business ${business.id}, generation ${deletion.stripeAction.generation}:`,
        stripeError
      );
    }
  } else if (deletion.stripeAction?.status === "blocked") {
    console.error(
      `[account] Stripe pause is blocked for business ${business.id}, generation ${deletion.stripeAction.generation}`
    );
  }

  return NextResponse.json({
    success: true,
    deletion_scheduled_for: deletion.deletionScheduledFor,
  });
}

function parseScheduledDeletion(
  value: unknown,
  expectedBusinessId: string
): ScheduledDeletion | null {
  if (
    !isRecord(value) ||
    value.business_id !== expectedBusinessId ||
    typeof value.deleted_at !== "string" ||
    typeof value.deletion_scheduled_for !== "string"
  ) {
    return null;
  }

  if (value.stripe_action === null) {
    return {
      deletionScheduledFor: value.deletion_scheduled_for,
      stripeAction: null,
    };
  }

  const stripeAction = value.stripe_action;
  if (
    !isRecord(stripeAction) ||
    stripeAction.business_id !== expectedBusinessId ||
    stripeAction.desired_action !== "pause" ||
    !Number.isSafeInteger(stripeAction.generation) ||
    (stripeAction.generation as number) < 1 ||
    !isStripeActionStatus(stripeAction.status)
  ) {
    return null;
  }

  return {
    deletionScheduledFor: value.deletion_scheduled_for,
    stripeAction: {
      generation: stripeAction.generation as number,
      status: stripeAction.status,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStripeActionStatus(
  value: unknown
): value is ScheduledStripeAction["status"] {
  return value === "pending" || value === "applied" || value === "blocked";
}
