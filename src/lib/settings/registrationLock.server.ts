import { NextResponse } from "next/server";

import { registrationHasStartedForRisk } from "@/lib/messaging/registration/riskScreening";
import { hasCarrierRejection } from "@/lib/onboarding/rejectionGuidance";
import {
  REGISTRATION_STATE_UNAVAILABLE_CODE,
  REGISTRATION_STATE_UNAVAILABLE_MESSAGE,
  SETTINGS_REGISTRATION_LOCK_CODE,
  SETTINGS_STATE_CHANGED_CODE,
  SETTINGS_STATE_CHANGED_MESSAGE,
  type SettingsRegistrationLockCopy,
} from "@/lib/settings/registrationLockCopy";
import type { Business } from "@/types/database";

export type SettingsRegistrationState = Pick<
  Business,
  | "telnyx_brand_id"
  | "brand_status"
  | "campaign_status"
  | "onboarding_registration_status"
>;

export const SETTINGS_REGISTRATION_STATE_COLUMNS = [
  "telnyx_brand_id",
  "brand_status",
  "campaign_status",
  "onboarding_registration_status",
].join(", ");

type RegistrationStateQuery = {
  eq: (
    column: string,
    value: string
  ) => RegistrationStateQuery;
  is: (column: string, value: null) => RegistrationStateQuery;
};

export function applyRegistrationStateSnapshot<
  Query extends RegistrationStateQuery,
>(query: Query, state: SettingsRegistrationState): Query {
  let guarded = query;

  for (const [column, value] of Object.entries(state)) {
    guarded = (value === null
      ? guarded.is(column, null)
      : guarded.eq(column, value)) as Query;
  }

  return guarded;
}

export function isSettingsRegistrationLocked(
  business: SettingsRegistrationState
): boolean {
  return (
    hasCarrierRejection(business.brand_status, business.campaign_status) ||
    (registrationHasStartedForRisk(business) &&
      business.onboarding_registration_status !== "failed")
  );
}

export function settingsRegistrationLockedResponse(
  copy: SettingsRegistrationLockCopy
) {
  return NextResponse.json(
    {
      code: SETTINGS_REGISTRATION_LOCK_CODE,
      error: copy.message,
    },
    { status: 403 }
  );
}

export function registrationStateUnavailableResponse() {
  return NextResponse.json(
    {
      code: REGISTRATION_STATE_UNAVAILABLE_CODE,
      error: REGISTRATION_STATE_UNAVAILABLE_MESSAGE,
    },
    { status: 503 }
  );
}

export function settingsStateChangedResponse() {
  return NextResponse.json(
    {
      code: SETTINGS_STATE_CHANGED_CODE,
      error: SETTINGS_STATE_CHANGED_MESSAGE,
    },
    { status: 409 }
  );
}
