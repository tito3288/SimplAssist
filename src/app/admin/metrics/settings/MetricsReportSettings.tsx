"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT,
  adminMetricsReportConfigSchema,
  type AdminMetricsReportBusiness,
  type AdminMetricsReportConfig,
  type AdminMetricsReportConfigSaveRequest,
  type AdminMetricsReportConfigSettings,
} from "@/lib/admin/metricsReportConfigs.shared";
import {
  bodyFaint,
  btnPrimaryCompact,
  btnSecondaryCompact,
  card,
  fieldLabel,
  inputField,
  statusDanger,
  statusNeutral,
  statusSuccess,
  statusWarning,
  tile,
} from "@/lib/theme-v2/theme";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type RecipientEditor = {
  email: string;
  enabled: boolean;
};

export type MetricsReportConfigEditor = {
  key: string;
  id: string | null;
  scopeKind: "direct" | "partner";
  partnerId: string | null;
  label: string;
  partnerSlug: string | null;
  selectionMode: "all" | "selected";
  reportingStartsOn: string;
  enabled: boolean;
  recipients: RecipientEditor[];
  selectedBusinessIds: string[];
  businesses: AdminMetricsReportBusiness[];
};

export type MetricsReportEditorAction =
  | { type: "add_recipient" }
  | { type: "remove_recipient"; index: number }
  | { type: "recipient_email"; index: number; email: string }
  | { type: "recipient_enabled"; index: number; enabled: boolean }
  | { type: "selection_mode"; mode: "all" | "selected" }
  | { type: "business_selected"; businessId: string; selected: boolean }
  | { type: "reporting_starts_on"; reportingStartsOn: string }
  | { type: "enabled"; enabled: boolean };

const MONTH_START = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const ERROR_MESSAGES: Record<string, string> = {
  business_out_of_scope:
    "Remove businesses that no longer belong to this report scope, then save again.",
  enabled_recipient_required:
    "Enable at least one recipient before enabling this report.",
  invalid_selection:
    "Choose all businesses or select at least one current business.",
  invalid_request: "Review this report configuration and try again.",
  partner_not_found: "This partner is no longer available.",
  save_failed: "The report configuration could not be saved.",
};

function canonicalRecipient(email: string): string {
  return email.trim().toLowerCase();
}

export function currentUtcMonthStart(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function editorFromScope(
  scope: {
    config: AdminMetricsReportConfig | null;
    businesses: AdminMetricsReportBusiness[];
  },
  identity: {
    scopeKind: "direct" | "partner";
    partnerId: string | null;
    label: string;
    partnerSlug: string | null;
  },
  defaultReportingStartsOn: string,
): MetricsReportConfigEditor {
  const config = scope.config;
  return {
    key:
      identity.scopeKind === "direct"
        ? "direct"
        : `partner:${identity.partnerId}`,
    id: config?.id ?? null,
    scopeKind: identity.scopeKind,
    partnerId: identity.partnerId,
    label: identity.label,
    partnerSlug: identity.partnerSlug,
    selectionMode: config?.selectionMode ?? "all",
    reportingStartsOn:
      config?.reportingStartsOn ?? defaultReportingStartsOn,
    enabled: config?.enabled ?? false,
    recipients: config?.recipients.map((recipient) => ({ ...recipient })) ?? [],
    selectedBusinessIds: [...(config?.selectedBusinessIds ?? [])],
    businesses: scope.businesses.map((business) => ({ ...business })),
  };
}

export function createMetricsReportConfigEditors(
  settings: AdminMetricsReportConfigSettings,
  defaultReportingStartsOn = currentUtcMonthStart(),
): MetricsReportConfigEditor[] {
  return [
    editorFromScope(
      settings.direct,
      {
        scopeKind: "direct",
        partnerId: null,
        label: "SimplAssist direct",
        partnerSlug: null,
      },
      defaultReportingStartsOn,
    ),
    ...settings.partners.map((partner) =>
      editorFromScope(
        partner,
        {
          scopeKind: "partner",
          partnerId: partner.id,
          label: partner.name,
          partnerSlug: partner.slug,
        },
        defaultReportingStartsOn,
      ),
    ),
  ];
}

export function staleSelectedBusinessIds(
  editor: MetricsReportConfigEditor,
): string[] {
  const currentIds = new Set(
    editor.businesses.map((business) => business.id),
  );
  return editor.selectedBusinessIds.filter(
    (businessId) => !currentIds.has(businessId),
  );
}

export function reduceMetricsReportConfigEditor(
  editor: MetricsReportConfigEditor,
  action: MetricsReportEditorAction,
): MetricsReportConfigEditor {
  switch (action.type) {
    case "add_recipient":
      if (
        editor.recipients.length >=
        ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT
      ) {
        return editor;
      }
      return {
        ...editor,
        recipients: [...editor.recipients, { email: "", enabled: true }],
      };
    case "remove_recipient":
      return {
        ...editor,
        recipients: editor.recipients.filter(
          (_recipient, index) => index !== action.index,
        ),
      };
    case "recipient_email":
      return {
        ...editor,
        recipients: editor.recipients.map((recipient, index) =>
          index === action.index
            ? { ...recipient, email: action.email }
            : recipient,
        ),
      };
    case "recipient_enabled":
      return {
        ...editor,
        recipients: editor.recipients.map((recipient, index) =>
          index === action.index
            ? { ...recipient, enabled: action.enabled }
            : recipient,
        ),
      };
    case "selection_mode":
      return {
        ...editor,
        selectionMode: action.mode,
        selectedBusinessIds:
          action.mode === "all" ? [] : editor.selectedBusinessIds,
      };
    case "business_selected": {
      const selected = new Set(editor.selectedBusinessIds);
      if (
        action.selected &&
        !selected.has(action.businessId) &&
        selected.size >= ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT
      ) {
        return editor;
      }
      if (action.selected) selected.add(action.businessId);
      else selected.delete(action.businessId);
      return {
        ...editor,
        selectedBusinessIds: Array.from(selected).sort(),
      };
    }
    case "reporting_starts_on":
      return {
        ...editor,
        reportingStartsOn: action.reportingStartsOn,
      };
    case "enabled":
      return { ...editor, enabled: action.enabled };
  }
}

export function metricsReportConfigValidationError(
  editor: MetricsReportConfigEditor,
): string | null {
  if (!MONTH_START.test(editor.reportingStartsOn)) {
    return "Choose a valid reporting start month.";
  }

  if (
    editor.recipients.length > ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT
  ) {
    return `Use no more than ${ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT} recipients.`;
  }
  if (
    editor.selectedBusinessIds.length >
    ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT
  ) {
    return `Select no more than ${ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT} businesses.`;
  }

  const canonicalEmails = editor.recipients.map((recipient) =>
    canonicalRecipient(recipient.email),
  );
  if (
    canonicalEmails.some(
      (email) => email.length > 254 || !EMAIL.test(email),
    )
  ) {
    return "Enter a valid email address for every recipient.";
  }
  if (new Set(canonicalEmails).size !== canonicalEmails.length) {
    return "Each recipient email must be unique.";
  }

  if (
    editor.enabled &&
    !editor.recipients.some(
      (recipient) => recipient.enabled && canonicalRecipient(recipient.email),
    )
  ) {
    return "Enable at least one recipient before enabling this report.";
  }

  if (editor.selectionMode === "all") {
    if (editor.selectedBusinessIds.length > 0) {
      return "Remove selected businesses when reporting on all businesses.";
    }
    return null;
  }

  if (editor.selectedBusinessIds.length === 0) {
    return "Select at least one current business.";
  }
  if (staleSelectedBusinessIds(editor).length > 0) {
    return "Remove businesses that no longer belong to this report scope before saving.";
  }
  return null;
}

export function buildMetricsReportConfigSaveRequest(
  editor: MetricsReportConfigEditor,
): AdminMetricsReportConfigSaveRequest {
  const common = {
    selectionMode: editor.selectionMode,
    reportingStartsOn: editor.reportingStartsOn,
    enabled: editor.enabled,
    recipients: editor.recipients.map((recipient) => ({
      email: canonicalRecipient(recipient.email),
      enabled: recipient.enabled,
    })),
    selectedBusinessIds: [...editor.selectedBusinessIds].sort(),
  } as const;

  return editor.scopeKind === "direct"
    ? { scopeKind: "direct", ...common }
    : {
        scopeKind: "partner",
        partnerId: editor.partnerId!,
        ...common,
      };
}

function readErrorCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.error === "string" ? candidate.error : null;
}

export async function requestMetricsReportConfigSave(
  request: AdminMetricsReportConfigSaveRequest,
  fetcher: Fetcher = fetch,
): Promise<AdminMetricsReportConfig> {
  const response = await fetcher("/api/admin/metrics/report-configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const code = readErrorCode(body);
    throw new Error(
      (code && ERROR_MESSAGES[code]) ??
        "The report configuration could not be saved.",
    );
  }

  const parsed = adminMetricsReportConfigSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("The server returned an invalid report configuration.");
  }
  return parsed.data;
}

function mergeSavedConfig(
  editor: MetricsReportConfigEditor,
  saved: AdminMetricsReportConfig,
): MetricsReportConfigEditor {
  return {
    ...editor,
    id: saved.id,
    selectionMode: saved.selectionMode,
    reportingStartsOn: saved.reportingStartsOn,
    enabled: saved.enabled,
    recipients: saved.recipients.map((recipient) => ({ ...recipient })),
    selectedBusinessIds: [...saved.selectedBusinessIds],
  };
}

export function metricsReportEditorSaveLock(
  savingKey: string | null,
  editorKey: string,
): { interactionsDisabled: boolean; isSaving: boolean } {
  return {
    interactionsDisabled: savingKey !== null,
    isSaving: savingKey === editorKey,
  };
}

export function MetricsReportSettings({
  settings,
  defaultReportingStartsOn = currentUtcMonthStart(),
}: {
  settings: AdminMetricsReportConfigSettings;
  defaultReportingStartsOn?: string;
}) {
  const router = useRouter();
  const [editors, setEditors] = useState(() =>
    createMetricsReportConfigEditors(settings, defaultReportingStartsOn),
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [notices, setNotices] = useState<Record<string, string | null>>({});

  function dispatch(key: string, action: MetricsReportEditorAction) {
    setEditors((current) =>
      current.map((editor) =>
        editor.key === key
          ? reduceMetricsReportConfigEditor(editor, action)
          : editor,
      ),
    );
    setErrors((current) => ({ ...current, [key]: null }));
    setNotices((current) => ({ ...current, [key]: null }));
  }

  async function save(
    event: React.FormEvent<HTMLFormElement>,
    editor: MetricsReportConfigEditor,
  ) {
    event.preventDefault();
    const validationError = metricsReportConfigValidationError(editor);
    if (validationError || savingKey !== null) {
      if (validationError) {
        setErrors((current) => ({
          ...current,
          [editor.key]: validationError,
        }));
      }
      return;
    }

    setSavingKey(editor.key);
    setErrors((current) => ({ ...current, [editor.key]: null }));
    setNotices((current) => ({ ...current, [editor.key]: null }));
    try {
      const saved = await requestMetricsReportConfigSave(
        buildMetricsReportConfigSaveRequest(editor),
      );
      setEditors((current) =>
        current.map((candidate) =>
          candidate.key === editor.key
            ? mergeSavedConfig(candidate, saved)
            : candidate,
        ),
      );
      setNotices((current) => ({
        ...current,
        [editor.key]: "Report configuration saved.",
      }));
      router.refresh();
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [editor.key]:
          error instanceof Error
            ? error.message
            : "The report configuration could not be saved.",
      }));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <p className={`text-sm ${bodyFaint}`}>
        Each brand has one configuration. New configurations start disabled.
        Changes are effective at snapshot generation; frozen report history is
        never rewritten.
      </p>

      {editors.map((editor) => {
        const validationError = metricsReportConfigValidationError(editor);
        const staleIds = staleSelectedBusinessIds(editor);
        const { interactionsDisabled, isSaving } =
          metricsReportEditorSaveLock(savingKey, editor.key);
        return (
          <section key={editor.key} className={`p-5 sm:p-6 ${card}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{editor.label}</h2>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs ${
                      editor.enabled
                        ? statusSuccess
                        : editor.id
                          ? statusNeutral
                          : statusWarning
                    }`}
                  >
                    {editor.enabled
                      ? "Enabled"
                      : editor.id
                        ? "Disabled"
                        : "Unsaved · disabled"}
                  </span>
                </div>
                <p className={`mt-1 text-sm ${bodyFaint}`}>
                  {editor.scopeKind === "direct"
                    ? "Businesses currently assigned directly to SimplAssist."
                    : `${editor.partnerSlug} · businesses currently assigned to this partner.`}
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  disabled={interactionsDisabled}
                  checked={editor.enabled}
                  onChange={(event) =>
                    dispatch(editor.key, {
                      type: "enabled",
                      enabled: event.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded accent-[#ea580c] dark:accent-[#ff914d]"
                />
                Enable monthly report
              </label>
            </div>

            <form
              onSubmit={(event) => save(event, editor)}
              className="mt-6 space-y-6"
            >
              <fieldset
                disabled={interactionsDisabled}
                className="space-y-6"
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className={fieldLabel}>
                    Businesses included
                    <select
                      value={editor.selectionMode}
                      onChange={(event) =>
                        dispatch(editor.key, {
                          type: "selection_mode",
                          mode: event.target.value as "all" | "selected",
                        })
                      }
                      className={`mt-1.5 ${inputField}`}
                    >
                      <option value="all">All businesses in this brand</option>
                      <option value="selected">Selected businesses</option>
                    </select>
                  </label>

                  <label className={fieldLabel}>
                    Reporting starts
                    <input
                      type="month"
                      value={editor.reportingStartsOn.slice(0, 7)}
                      onChange={(event) =>
                        dispatch(editor.key, {
                          type: "reporting_starts_on",
                          reportingStartsOn: `${event.target.value}-01`,
                        })
                      }
                      className={`mt-1.5 ${inputField}`}
                    />
                  </label>
                </div>

                {editor.selectionMode === "selected" && (
                  <div className={`space-y-3 p-4 ${tile}`}>
                    <div>
                      <h3 className="text-sm font-semibold">
                        Current businesses
                      </h3>
                      <p className={`mt-1 text-xs ${bodyFaint}`}>
                        Snapshot rows use event-time brand attribution. Current
                        assignment is checked only when this configuration is
                        saved.
                      </p>
                    </div>
                    {editor.businesses.length === 0 ? (
                      <p className={`text-sm ${bodyFaint}`}>
                        No current businesses are available for this brand.
                      </p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {editor.businesses.map((business) => (
                          <label
                            key={business.id}
                            className="flex items-start gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              disabled={
                                !editor.selectedBusinessIds.includes(
                                  business.id,
                                ) &&
                                editor.selectedBusinessIds.length >=
                                  ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT
                              }
                              checked={editor.selectedBusinessIds.includes(
                                business.id,
                              )}
                              onChange={(event) =>
                                dispatch(editor.key, {
                                  type: "business_selected",
                                  businessId: business.id,
                                  selected: event.target.checked,
                                })
                              }
                              className="mt-0.5 h-4 w-4 rounded accent-[#ea580c] dark:accent-[#ff914d]"
                            />
                            <span>
                              {business.name}
                              <span className={`block text-xs ${bodyFaint}`}>
                                {business.id}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}

                    {staleIds.length > 0 && (
                      <div className={`space-y-2 rounded-xl p-3 ${statusDanger}`}>
                        <p className="text-sm font-medium">
                          These saved selections no longer belong to this brand.
                          Remove them before saving.
                        </p>
                        {staleIds.map((businessId) => (
                          <div
                            key={businessId}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <code>{businessId}</code>
                            <button
                              type="button"
                              onClick={() =>
                                dispatch(editor.key, {
                                  type: "business_selected",
                                  businessId,
                                  selected: false,
                                })
                              }
                              className={btnSecondaryCompact}
                            >
                              Remove stale selection
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Recipients</h3>
                      <p className={`mt-1 text-xs ${bodyFaint}`}>
                        Admin and partner-staff addresses only. Recipient changes
                        do not alter deliveries already frozen into a report.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={
                        editor.recipients.length >=
                        ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT
                      }
                      onClick={() =>
                        dispatch(editor.key, { type: "add_recipient" })
                      }
                      className={btnSecondaryCompact}
                    >
                      Add recipient
                    </button>
                  </div>

                  {editor.recipients.length === 0 ? (
                    <p className={`rounded-xl px-4 py-3 text-sm ${statusNeutral}`}>
                      No recipients configured. This report must remain disabled.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {editor.recipients.map((recipient, index) => (
                        <div
                          key={`${editor.key}:recipient:${index}`}
                          className={`grid gap-3 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center ${tile}`}
                        >
                          <label className="sr-only" htmlFor={`${editor.key}-recipient-${index}`}>
                            Recipient email
                          </label>
                          <input
                            id={`${editor.key}-recipient-${index}`}
                            type="email"
                            required
                            value={recipient.email}
                            onChange={(event) =>
                              dispatch(editor.key, {
                                type: "recipient_email",
                                index,
                                email: event.target.value,
                              })
                            }
                            autoComplete="email"
                            placeholder="recipient@example.com"
                            className={inputField}
                          />
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={recipient.enabled}
                              onChange={(event) =>
                                dispatch(editor.key, {
                                  type: "recipient_enabled",
                                  index,
                                  enabled: event.target.checked,
                                })
                              }
                              className="h-4 w-4 rounded accent-[#ea580c] dark:accent-[#ff914d]"
                            />
                            Enabled
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              dispatch(editor.key, {
                                type: "remove_recipient",
                                index,
                              })
                            }
                            className={btnSecondaryCompact}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {(errors[editor.key] ?? validationError) && (
                  <p className={`rounded-xl px-4 py-3 text-sm ${statusDanger}`} role="alert">
                    {errors[editor.key] ?? validationError}
                  </p>
                )}
                {notices[editor.key] && (
                  <p className={`rounded-xl px-4 py-3 text-sm ${statusSuccess}`} role="status">
                    {notices[editor.key]}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={
                    interactionsDisabled || validationError !== null
                  }
                  className={btnPrimaryCompact}
                >
                  {isSaving
                    ? "Saving..."
                    : editor.id
                      ? "Save report settings"
                      : "Create report settings"}
                </button>
              </fieldset>
            </form>
          </section>
        );
      })}
    </div>
  );
}
