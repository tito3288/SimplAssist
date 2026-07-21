"use client";

import { useState } from "react";
import {
  btnPrimaryCompact,
  btnSecondaryCompact,
  inputField,
  statusDanger,
  statusInfo,
  statusSuccess,
  statusWarning,
  tile,
} from "@/lib/theme-v2/theme";

type LinkStatus = "pending_admin" | "approved" | "blocked" | "consumed";

export type ExistingTelnyxBrandLinkState = {
  status: LinkStatus;
  tcrBrandId: string;
  inspectedAt: string;
  approvedAt: string | null;
  consumedAt: string | null;
  lastErrorCode: string | null;
};

type BrandPreview = {
  tcrBrandId: string;
  legalName: string;
  entityTypeCategory: string;
  state: string;
  zip: string;
  registrationStatus: string;
  identityStatus: string;
  campaignCount: number;
  canStage: boolean;
  blockingCode: string | null;
  blockingMessage: string | null;
};

type Action = "inspect" | "stage" | "approve" | "reset";

type SuccessResponse = {
  success: true;
  action: Action;
  preview?: BrandPreview;
  linkState?: ExistingTelnyxBrandLinkState;
};

type ErrorResponse = {
  error?: string;
  code?: string;
};

export function ExistingTelnyxBrandForm({
  businessId,
  initialLinkState,
}: {
  businessId: string;
  initialLinkState: ExistingTelnyxBrandLinkState | null;
}) {
  const [tcrBrandId, setTcrBrandId] = useState(
    initialLinkState?.tcrBrandId ?? ""
  );
  const [preview, setPreview] = useState<BrandPreview | null>(null);
  const [linkState, setLinkState] =
    useState<ExistingTelnyxBrandLinkState | null>(initialLinkState);
  const [busyAction, setBusyAction] = useState<Action | null>(null);
  const [stagedThisSession, setStagedThisSession] = useState(false);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const normalizedTcrId = tcrBrandId.trim().toUpperCase();
  const previewMatchesInput = preview?.tcrBrandId === normalizedTcrId;
  const isImmutable = linkState?.status === "consumed";
  const canStage =
    Boolean(preview?.canStage) &&
    previewMatchesInput &&
    linkState?.status !== "approved" &&
    !isImmutable;
  const canApprove =
    linkState?.status === "pending_admin" &&
    previewMatchesInput &&
    Boolean(preview?.canStage) &&
    stagedThisSession &&
    approvalConfirmed;

  async function runAction(action: Action) {
    setBusyAction(action);
    setError(null);
    setNotice(null);

    try {
      const body =
        action === "inspect" || action === "stage"
          ? { action, businessId, tcrBrandId: normalizedTcrId }
          : { action, businessId };
      const response = await fetch("/api/admin/existing-telnyx-brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as
        | SuccessResponse
        | ErrorResponse;

      if (!response.ok || !("success" in payload)) {
        setError(
          "error" in payload && payload.error
            ? payload.error
            : "The brand action could not be completed safely."
        );
        return;
      }

      if (payload.preview) setPreview(payload.preview);
      if (payload.linkState) setLinkState(payload.linkState);

      switch (action) {
        case "inspect":
          setStagedThisSession(false);
          setApprovalConfirmed(false);
          setNotice("Inspection complete. No brand-link state was changed.");
          break;
        case "stage":
          setStagedThisSession(true);
          setApprovalConfirmed(false);
          setNotice(
            "Brand staged. Review the preview, then explicitly approve it for launch."
          );
          break;
        case "approve":
          setStagedThisSession(false);
          setApprovalConfirmed(false);
          setNotice(
            "Brand link approved. Paid launch will re-check it before connecting the brand."
          );
          break;
        case "reset":
          setPreview(null);
          setStagedThisSession(false);
          setApprovalConfirmed(false);
          setNotice(
            "Approval cleared. Inspect and stage the brand again before launch."
          );
          break;
      }
    } catch {
      setError("SimplAssist could not be reached. No brand-link action was confirmed.");
    } finally {
      setBusyAction(null);
    }
  }

  function handleReset() {
    if (
      window.confirm(
        "Clear the current staged approval? The brand will need to be inspected, staged, and approved again."
      )
    ) {
      void runAction("reset");
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-stone-600 dark:text-[#bdbdbf]">
        Admin-only recovery for a verified brand already inside SimplAssist&apos;s
        Telnyx account. Inspecting is read-only and can be done before the
        customer finishes their legal onboarding details.
      </p>

      <LinkStateSummary linkState={linkState} />

      <div>
        <label htmlFor="existing-tcr-brand-id" className="font-medium">
          TCR brand ID
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="existing-tcr-brand-id"
            value={tcrBrandId}
            onChange={(event) => {
              setTcrBrandId(event.target.value.toUpperCase());
              setPreview(null);
              setStagedThisSession(false);
              setApprovalConfirmed(false);
            }}
            disabled={busyAction !== null || isImmutable}
            placeholder="BL69PDP"
            autoComplete="off"
            spellCheck={false}
            className={`${inputField} py-2 font-mono uppercase sm:max-w-xs`}
          />
          <button
            type="button"
            onClick={() => void runAction("inspect")}
            disabled={
              busyAction !== null || normalizedTcrId.length === 0 || isImmutable
            }
            className={`${btnSecondaryCompact} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {busyAction === "inspect" ? "Inspecting..." : "Inspect brand"}
          </button>
        </div>
        <p className="mt-2 text-xs text-stone-500 dark:text-[#bdbdbf]">
          Use the public TCR ID shown in Telnyx (for example, BL69PDP). Never
          enter the Telnyx internal UUID here.
        </p>
      </div>

      {preview && <BrandPreviewPanel preview={preview} />}

      {error && (
        <div role="alert" className={`rounded-2xl px-3 py-2 ${statusDanger}`}>
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className={`rounded-2xl px-3 py-2 ${statusSuccess}`}>
          {notice}
        </div>
      )}

      <div className="space-y-3 border-t border-[#ece4d8] pt-4 dark:border-white/[0.10]">
        {!isImmutable && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runAction("stage")}
              disabled={busyAction !== null || !canStage}
              className={`${btnSecondaryCompact} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {busyAction === "stage" ? "Staging..." : "Stage inspected brand"}
            </button>
            {linkState && (
              <button
                type="button"
                onClick={handleReset}
                disabled={busyAction !== null}
                className={`${btnSecondaryCompact} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {busyAction === "reset" ? "Resetting..." : "Reset link"}
              </button>
            )}
          </div>
        )}

        {linkState?.status === "pending_admin" && (
          <div className={`space-y-3 p-3 ${tile}`}>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={approvalConfirmed}
                onChange={(event) =>
                  setApprovalConfirmed(event.target.checked)
                }
                disabled={
                  !previewMatchesInput || !stagedThisSession || busyAction !== null
                }
                className="mt-0.5 h-4 w-4 rounded accent-[#ea580c] dark:accent-[#ff914d]"
              />
              <span>
                I reviewed this fresh preview and confirm it is the intended
                brand for this business.
              </span>
            </label>
            {(!previewMatchesInput || !stagedThisSession) && (
              <p className="text-xs text-amber-800 dark:text-[#fcd9a5]">
                Inspect, then stage this TCR ID in this session before
                approving it.
              </p>
            )}
            <button
              type="button"
              onClick={() => void runAction("approve")}
              disabled={busyAction !== null || !canApprove}
              className={`${btnPrimaryCompact} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {busyAction === "approve" ? "Approving..." : "Approve for launch"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LinkStateSummary({
  linkState,
}: {
  linkState: ExistingTelnyxBrandLinkState | null;
}) {
  if (!linkState) {
    return (
      <div className={`rounded-2xl px-3 py-2 ${statusInfo}`}>
        No existing brand has been staged for this account.
      </div>
    );
  }

  const labels: Record<LinkStatus, string> = {
    pending_admin: "Pending — inspect and stage before approval",
    approved: "Approved for launch",
    blocked: "Blocked — inspect and stage again",
    consumed: "Connected during launch",
  };
  const tone =
    linkState.status === "approved" || linkState.status === "consumed"
      ? statusSuccess
      : linkState.status === "blocked"
        ? statusDanger
        : statusWarning;

  return (
    <div className={`rounded-2xl px-3 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{labels[linkState.status]}</span>
        <span className="font-mono text-xs">{linkState.tcrBrandId}</span>
      </div>
      <p className="mt-1 text-xs">
        Last inspected {formatDateTime(linkState.inspectedAt)}
        {linkState.approvedAt
          ? ` · approved ${formatDateTime(linkState.approvedAt)}`
          : ""}
        {linkState.consumedAt
          ? ` · connected ${formatDateTime(linkState.consumedAt)}`
          : ""}
      </p>
      {linkState.lastErrorCode && (
        <p className="mt-1 text-xs">
          Safe reason code: {linkState.lastErrorCode}
        </p>
      )}
    </div>
  );
}

function BrandPreviewPanel({ preview }: { preview: BrandPreview }) {
  const atCampaignCap = preview.campaignCount >= 5;

  return (
    <section className={`space-y-3 p-4 ${tile}`} aria-label="Redacted Telnyx brand preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Redacted Telnyx preview</h3>
        <span className="font-mono text-xs">{preview.tcrBrandId}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <PreviewRow label="Normalized legal name" value={preview.legalName} />
        <PreviewRow label="Entity category" value={preview.entityTypeCategory} />
        <PreviewRow label="Address state" value={preview.state} />
        <PreviewRow label="Address ZIP" value={preview.zip} />
        <PreviewRow label="Registration status" value={preview.registrationStatus} />
        <PreviewRow label="Identity status" value={preview.identityStatus} />
        <PreviewRow
          label="Campaigns on brand"
          value={`${preview.campaignCount} of 5`}
        />
      </dl>
      <p className="text-xs text-stone-500 dark:text-[#bdbdbf]">
        Telnyx groups LLCs, C corporations, S corporations, and partnerships
        under PRIVATE_PROFIT. Confirm the customer&apos;s exact legal entity type
        separately in onboarding.
      </p>
      {(atCampaignCap || preview.blockingMessage) && (
        <div className={`rounded-2xl px-3 py-2 ${statusDanger}`}>
          {preview.blockingMessage ??
            "This Telnyx brand is at Telnyx's campaign cap: it already has 5 campaigns, the maximum allowed per brand. SimplAssist cannot create the additional campaign required for this account. Use a different eligible brand or contact Telnyx Support before approving this link."}
        </div>
      )}
    </section>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[#ece4d8] py-1 dark:border-white/[0.08]">
      <dt className="text-stone-500 dark:text-[#bdbdbf]">{label}</dt>
      <dd className="text-right font-medium">{value || "Not provided"}</dd>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}
