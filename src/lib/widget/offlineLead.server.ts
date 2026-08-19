import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildWidgetLeadSubmissionFingerprint,
  buildWidgetMessageFingerprint,
  buildWidgetSourceProviderEventId,
} from "./idempotency.server";

export class WidgetOfflineLeadConflictError extends Error {
  constructor() {
    super("widget_offline_lead_conflict");
    this.name = "WidgetOfflineLeadConflictError";
  }
}

export class WidgetOfflineLeadStateError extends Error {
  readonly retryable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WidgetOfflineLeadStateError";
  }
}

export async function recordWidgetOfflineLead(input: {
  businessId: string;
  sessionId: string;
  clientLeadId: string;
  sourceClientMessageId: string;
  message: string;
  visitorName?: string;
  visitorEmail?: string;
}): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc(
    "record_widget_offline_lead",
    {
      p_business_id: input.businessId,
      p_session_id: input.sessionId,
      p_client_lead_id: input.clientLeadId,
      p_source_provider_event_id: buildWidgetSourceProviderEventId({
        businessId: input.businessId,
        clientMessageId: input.sourceClientMessageId,
      }),
      p_source_message_fingerprint: buildWidgetMessageFingerprint(
        input.message,
      ),
      p_submission_fingerprint: buildWidgetLeadSubmissionFingerprint(input),
      p_contact_name: input.visitorName ?? null,
      p_contact_email: input.visitorEmail ?? null,
    },
  );

  if (error) {
    const message = [error.message, error.details, error.hint]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    if (
      /\b(?:widget_offline_lead_idempotency_conflict|widget_offline_lead_contact_conflict)\b/.test(
        message,
      )
    ) {
      throw new WidgetOfflineLeadConflictError();
    }
    throw new WidgetOfflineLeadStateError(
      `[widget:lead] Could not persist offline lead: ${message || "database error"}`,
      { cause: error },
    );
  }
  if (
    typeof data !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      data,
    )
  ) {
    throw new WidgetOfflineLeadStateError(
      "[widget:lead] Offline lead RPC returned malformed proof.",
    );
  }
  return data;
}
