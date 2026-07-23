import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reconcileAccountDeletionStripeAction } from "@/lib/stripe/accountDeletionReconciler";

const STRIPE_RESUME_RETRYABLE_MESSAGE =
  "We couldn't resume billing right now. Your account remains scheduled for deletion. Please try again.";
const STRIPE_RESUME_BLOCKED_MESSAGE =
  "We couldn't resume billing automatically. Your account remains scheduled for deletion. Please contact support.";

type PreparedStripeAction = {
  generation: number;
  status: "pending" | "applied" | "blocked";
  appliedAction: "pause" | "resume" | "cancel" | null;
};

type PreparedReactivation = {
  alreadyActive: boolean;
  stripeAction: PreparedStripeAction | null;
  reservationToken: string | null;
  reservationExpiresAt: string | null;
};

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id, deleted_at, deletion_scheduled_for")
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    return NextResponse.json(
      { error: "Account not found or not scheduled for deletion" },
      { status: 404 }
    );
  }

  const { data: preparedData, error: prepareError } = await supabaseAdmin.rpc(
    "prepare_account_reactivation",
    {
      p_business_id: business.id,
      p_owner_id: user.id,
    }
  );

  if (prepareError) {
    if (prepareError.code === "55000") {
      return NextResponse.json(
        { error: "Account has been permanently deleted and cannot be reactivated" },
        { status: 410 }
      );
    }

    console.error("[account/reactivate] Preparation error:", prepareError);
    return NextResponse.json(
      { error: "Failed to reactivate account" },
      { status: 500 }
    );
  }

  const prepared = parsePreparedReactivation(preparedData, business.id);
  if (!prepared) {
    console.error(
      `[account/reactivate] Preparation returned an invalid payload for business ${business.id}`
    );
    return NextResponse.json(
      { error: "Failed to reactivate account" },
      { status: 500 }
    );
  }

  if (prepared.alreadyActive) {
    return NextResponse.json({ success: true });
  }

  const stripeAction = prepared.stripeAction;
  if (stripeAction?.status === "blocked") {
    return stripeResumeError("stripe_resume_blocked");
  }

  if (stripeAction?.status === "pending") {
    try {
      const result = await reconcileAccountDeletionStripeAction({
        businessId: business.id,
        generation: stripeAction.generation,
      });

      if (result.outcome === "blocked") {
        return stripeResumeError("stripe_resume_blocked");
      }
      if (
        result.outcome !== "applied" ||
        (result.appliedAction !== "resume" && result.appliedAction !== "cancel")
      ) {
        return stripeResumeError("stripe_resume_retryable");
      }
    } catch (stripeError) {
      console.error(
        `[account/reactivate] Stripe resume reconciliation failed for business ${business.id}, generation ${stripeAction.generation}:`,
        stripeError
      );
      return stripeResumeError("stripe_resume_retryable");
    }
  }

  const { data: completed, error: completionError } = await supabaseAdmin.rpc(
    "complete_account_reactivation",
    {
      p_business_id: business.id,
      p_owner_id: user.id,
      p_generation: stripeAction?.generation ?? null,
      p_reactivation_reservation_token: prepared.reservationToken,
    }
  );

  if (completionError || completed !== true) {
    console.error(
      `[account/reactivate] Completion failed for business ${business.id}:`,
      completionError ?? "invalid completion response"
    );
    return NextResponse.json(
      { error: "Failed to reactivate account" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

function stripeResumeError(
  code: "stripe_resume_retryable" | "stripe_resume_blocked"
) {
  return NextResponse.json(
    {
      error:
        code === "stripe_resume_blocked"
          ? STRIPE_RESUME_BLOCKED_MESSAGE
          : STRIPE_RESUME_RETRYABLE_MESSAGE,
      code,
    },
    { status: 503 }
  );
}

function parsePreparedReactivation(
  value: unknown,
  expectedBusinessId: string
): PreparedReactivation | null {
  if (
    !isRecord(value) ||
    value.business_id !== expectedBusinessId ||
    typeof value.already_active !== "boolean"
  ) {
    return null;
  }

  if (value.already_active) {
    return value.stripe_action === null
      ? {
          alreadyActive: true,
          stripeAction: null,
          reservationToken: null,
          reservationExpiresAt: null,
        }
      : null;
  }

  if (
    typeof value.deletion_scheduled_for !== "string" ||
    !isUuid(value.reactivation_reservation_token) ||
    typeof value.reactivation_reservation_expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.reactivation_reservation_expires_at))
  ) {
    return null;
  }
  if (value.stripe_action === null) {
    return {
      alreadyActive: false,
      stripeAction: null,
      reservationToken: value.reactivation_reservation_token,
      reservationExpiresAt: value.reactivation_reservation_expires_at,
    };
  }

  const stripeAction = value.stripe_action;
  if (
    !isRecord(stripeAction) ||
    stripeAction.business_id !== expectedBusinessId ||
    stripeAction.desired_action !== "resume" ||
    !Number.isSafeInteger(stripeAction.generation) ||
    (stripeAction.generation as number) < 1 ||
    !isStripeActionStatus(stripeAction.status) ||
    !isNullableStripeAction(stripeAction.applied_action)
  ) {
    return null;
  }

  if (
    stripeAction.status === "applied" &&
    stripeAction.applied_action !== "resume" &&
    stripeAction.applied_action !== "cancel"
  ) {
    return null;
  }

  return {
    alreadyActive: false,
    reservationToken: value.reactivation_reservation_token,
    reservationExpiresAt: value.reactivation_reservation_expires_at,
    stripeAction: {
      generation: stripeAction.generation as number,
      status: stripeAction.status,
      appliedAction: stripeAction.applied_action,
    },
  };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStripeActionStatus(
  value: unknown
): value is PreparedStripeAction["status"] {
  return value === "pending" || value === "applied" || value === "blocked";
}

function isNullableStripeAction(
  value: unknown
): value is PreparedStripeAction["appliedAction"] {
  return (
    value === null ||
    value === "pause" ||
    value === "resume" ||
    value === "cancel"
  );
}
