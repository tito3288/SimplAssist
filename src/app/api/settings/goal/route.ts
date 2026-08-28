import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import {
  buildPrimaryGoalUpdate,
  type PrimaryGoalUpdate,
} from "@/lib/goals/primaryGoal";
import { hasCarrierRejection } from "@/lib/onboarding/rejectionGuidance";
import {
  SETTINGS_REGISTRATION_STATE_COLUMNS,
  applyRegistrationStateSnapshot,
  isSettingsRegistrationLocked,
  registrationStateUnavailableResponse,
  settingsRegistrationLockedResponse,
  settingsStateChangedResponse,
  type SettingsRegistrationState,
} from "@/lib/settings/registrationLock.server";
import { GOAL_SIGNUP_LOCK_COPY } from "@/lib/settings/registrationLockCopy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Business } from "@/types/database";

const GoalSettingsUpdateSchema = z.discriminatedUnion("primary_goal", [
  z.object({ primary_goal: z.literal("book") }).strict(),
  z
    .object({
      primary_goal: z.literal("signup"),
      goal_url: z.string(),
    })
    .strict(),
]);

type GoalSettingsState = SettingsRegistrationState &
  Pick<Business, "primary_goal">;

const GOAL_SETTINGS_STATE_COLUMNS = `${SETTINGS_REGISTRATION_STATE_COLUMNS}, primary_goal`;

async function loadGoalSettingsState(businessId: string, ownerId: string) {
  try {
    return await supabaseAdmin
      .from("businesses")
      .select(GOAL_SETTINGS_STATE_COLUMNS)
      .eq("id", businessId)
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .maybeSingle<GoalSettingsState>();
  } catch (error) {
    return { data: null, error };
  }
}

function registrationStateOf(
  state: GoalSettingsState
): SettingsRegistrationState {
  return {
    telnyx_brand_id: state.telnyx_brand_id,
    brand_status: state.brand_status,
    campaign_status: state.campaign_status,
    onboarding_registration_status: state.onboarding_registration_status,
  };
}

function signupTransitionIsLocked(
  current: GoalSettingsState,
  requested: PrimaryGoalUpdate
): boolean {
  return (
    isSettingsRegistrationLocked(current) &&
    current.primary_goal !== "signup" &&
    requested.primary_goal === "signup"
  );
}

function rejectedCarrierFilingChangeIsLocked(
  current: GoalSettingsState,
  requested: PrimaryGoalUpdate
): boolean {
  return (
    hasCarrierRejection(current.brand_status, current.campaign_status) &&
    (current.primary_goal === "signup" || requested.primary_goal === "signup")
  );
}

export async function POST(request: NextRequest) {
  const workspaceGate = await requireWorkspaceRouteAccess();
  if (!workspaceGate.ok) return workspaceGate.response;

  if (!workspaceGate.access.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = GoalSettingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid goal settings" },
      { status: 400 }
    );
  }

  const update = buildPrimaryGoalUpdate({
    primary_goal: parsed.data.primary_goal,
    goal_url:
      parsed.data.primary_goal === "signup" ? parsed.data.goal_url : null,
  });
  if (!update) {
    return NextResponse.json(
      { error: "Invalid goal settings" },
      { status: 400 }
    );
  }

  const businessId = workspaceGate.access.business.id;
  const ownerId = workspaceGate.access.user.id;
  const { data: current, error: currentError } =
    await loadGoalSettingsState(businessId, ownerId);

  if (currentError || !current) {
    console.error(
      `[settings:goal] Failed to load current state for business ${businessId}`
    );
    return registrationStateUnavailableResponse();
  }

  if (
    signupTransitionIsLocked(current, update) ||
    rejectedCarrierFilingChangeIsLocked(current, update)
  ) {
    return settingsRegistrationLockedResponse(GOAL_SIGNUP_LOCK_COPY);
  }

  // A book update intentionally omits goal_url so switching away from signup
  // retains the URL if the customer later switches back.
  let updateQuery = supabaseAdmin
    .from("businesses")
    .update(update)
    .eq("id", businessId)
    .eq("owner_id", ownerId)
    .is("deleted_at", null);

  updateQuery = applyRegistrationStateSnapshot(
    updateQuery,
    registrationStateOf(current)
  );
  updateQuery =
    current.primary_goal === null
      ? updateQuery.is("primary_goal", null)
      : updateQuery.eq("primary_goal", current.primary_goal);

  const { data: updatedBusiness, error: updateError } = await updateQuery
    .select("id")
    .maybeSingle<{ id: string }>();

  if (updateError) {
    console.error(
      `[settings:goal] Failed to update goal for business ${businessId}`
    );
    return NextResponse.json(
      { error: "Failed to save goal settings" },
      { status: 500 }
    );
  }

  if (!updatedBusiness) {
    const { data: latest, error: latestError } =
      await loadGoalSettingsState(businessId, ownerId);

    if (latestError || !latest) {
      console.error(
        `[settings:goal] Failed to reload current state for business ${businessId}`
      );
      return registrationStateUnavailableResponse();
    }

    if (
      rejectedCarrierFilingChangeIsLocked(latest, update) ||
      (!hasCarrierRejection(latest.brand_status, latest.campaign_status) &&
        isSettingsRegistrationLocked(latest))
    ) {
      return settingsRegistrationLockedResponse(GOAL_SIGNUP_LOCK_COPY);
    }

    return settingsStateChangedResponse();
  }

  return NextResponse.json({ success: true });
}
