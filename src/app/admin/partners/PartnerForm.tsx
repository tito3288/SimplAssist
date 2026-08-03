"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  AdminPartnerDto,
  PartnerColors as ValidatedPartnerColors,
  PartnerProfileInput,
} from "@/lib/admin/partnerValidation";
import {
  btnPrimaryCompact,
  btnSecondaryCompact,
  fieldLabel,
  inputField,
  statusDanger,
  statusSuccess,
  statusWarning,
  tile,
} from "@/lib/theme-v2/theme";

export type PartnerColors = ValidatedPartnerColors;
export type AdminPartnerView = AdminPartnerDto;

type EditablePartner = PartnerProfileInput;
type BusyAction = "create" | "update" | "pending" | "connected";

const DEFAULT_VALUES: EditablePartner = {
  name: "",
  slug: "",
  customDomain: null,
  logoLightUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  status: "active",
  colors: {
    primary: "#ea580c",
    primaryHover: "#c2410c",
    primaryActive: "#9a3412",
    accent: "#c2410c",
    primaryDark: "#ff914d",
    primaryHoverDark: "#f57f33",
    primaryActiveDark: "#e8752c",
    accentDark: "#ff914d",
  },
};

const COLOR_FIELDS: Array<{
  key: keyof PartnerColors;
  label: string;
}> = [
  { key: "primary", label: "Primary — light" },
  { key: "primaryHover", label: "Primary hover — light" },
  { key: "primaryActive", label: "Primary active — light" },
  { key: "accent", label: "Accent — light" },
  { key: "primaryDark", label: "Primary — dark" },
  { key: "primaryHoverDark", label: "Primary hover — dark" },
  { key: "primaryActiveDark", label: "Primary active — dark" },
  { key: "accentDark", label: "Accent — dark" },
];

function optionalValue(value: string | null): string {
  return value ?? "";
}

function trimmedOrNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function normalizedProfile(values: EditablePartner): EditablePartner {
  return {
    ...values,
    name: values.name.trim(),
    slug: values.slug.trim().toLowerCase(),
    customDomain: trimmedOrNull(values.customDomain)?.toLowerCase() ?? null,
    logoLightUrl: trimmedOrNull(values.logoLightUrl),
    logoDarkUrl: trimmedOrNull(values.logoDarkUrl),
    faviconUrl: trimmedOrNull(values.faviconUrl),
    colors: Object.fromEntries(
      Object.entries(values.colors).map(([key, value]) => [
        key,
        value.trim().toLowerCase(),
      ]),
    ) as PartnerColors,
  };
}

function safeSwatchColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : "transparent";
}

export function PartnerForm({
  mode,
  partner,
}: {
  mode: "create" | "edit";
  partner?: AdminPartnerView;
}) {
  const router = useRouter();
  const initialValues: EditablePartner = partner
    ? {
        name: partner.name,
        slug: partner.slug,
        customDomain: partner.customDomain,
        logoLightUrl: partner.logoLightUrl,
        logoDarkUrl: partner.logoDarkUrl,
        faviconUrl: partner.faviconUrl,
        status: partner.status,
        colors: partner.colors,
      }
    : DEFAULT_VALUES;
  const [values, setValues] = useState<EditablePartner>(initialValues);
  const [domainStatus, setDomainStatus] = useState<"pending" | "connected">(
    partner?.domainStatus ?? "pending",
  );
  const [persistedCustomDomain, setPersistedCustomDomain] = useState(
    partner?.customDomain ?? null,
  );
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const normalizedDomain =
    trimmedOrNull(values.customDomain)?.toLowerCase() ?? null;
  const domainHasUnsavedChanges = normalizedDomain !== persistedCustomDomain;

  function setField<Key extends keyof EditablePartner>(
    key: Key,
    value: EditablePartner[Key],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function readPayload(response: Response): Promise<{
    error?: string;
    partner?: { id?: unknown };
  }> {
    return (await response.json().catch(() => ({}))) as {
      error?: string;
      partner?: { id?: unknown };
    };
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action: BusyAction = mode === "create" ? "create" : "update";
    setBusyAction(action);
    setError(null);
    setNotice(null);

    const profile = normalizedProfile(values);

    try {
      const response = await fetch(
        mode === "create"
          ? "/api/admin/partners"
          : `/api/admin/partners/${partner!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "create" ? profile : { action: "update", ...profile },
          ),
        },
      );
      const payload = await readPayload(response);

      if (!response.ok) {
        setError(payload.error ?? "The partner profile could not be saved.");
        return;
      }

      setValues(profile);
      setPersistedCustomDomain(profile.customDomain);
      if (mode === "create") {
        const partnerId = payload.partner?.id;
        router.push(
          typeof partnerId === "string"
            ? `/admin/partners/${partnerId}`
            : "/admin/partners",
        );
      } else {
        if (domainHasUnsavedChanges) setDomainStatus("pending");
        setNotice(
          domainHasUnsavedChanges
            ? "Profile saved. The changed domain is Pending until it is verified again."
            : "Partner profile saved.",
        );
      }
      router.refresh();
    } catch {
      setError("The partner profile could not be saved.");
    } finally {
      setBusyAction(null);
    }
  }

  async function setStoredDomainStatus(
    nextStatus: "pending" | "connected",
  ) {
    if (!partner || domainHasUnsavedChanges) return;

    setBusyAction(nextStatus);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/partners/${partner.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_domain_status",
          domainStatus: nextStatus,
          expectedCustomDomain: persistedCustomDomain,
        }),
      });
      const payload = await readPayload(response);

      if (!response.ok) {
        setError(payload.error ?? "The domain status could not be updated.");
        return;
      }

      setDomainStatus(nextStatus);
      setNotice(
        nextStatus === "connected"
          ? "Domain marked Connected after manual verification."
          : "Domain marked Pending.",
      );
      router.refresh();
    } catch {
      setError("The domain status could not be updated.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={saveProfile} className="space-y-6">
        <fieldset disabled={busyAction !== null} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="partner-name">
              <input
                id="partner-name"
                name="name"
                required
                value={values.name}
                onChange={(event) => setField("name", event.target.value)}
                className={inputField}
                autoComplete="organization"
              />
            </Field>
            <Field label="Slug" htmlFor="partner-slug">
              <input
                id="partner-slug"
                name="slug"
                required
                maxLength={63}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                value={values.slug}
                onChange={(event) =>
                  setField("slug", event.target.value.toLowerCase())
                }
                className={inputField}
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
            <Field label="Custom domain (hostname only)" htmlFor="partner-domain">
              <input
                id="partner-domain"
                name="customDomain"
                value={optionalValue(values.customDomain)}
                onChange={(event) =>
                  setField("customDomain", event.target.value.toLowerCase())
                }
                placeholder="app.partner.example"
                className={inputField}
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
            <Field label="Partner status" htmlFor="partner-status">
              <select
                id="partner-status"
                name="status"
                value={values.status}
                onChange={(event) =>
                  setField(
                    "status",
                    event.target.value as "active" | "inactive",
                  )
                }
                className={inputField}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
          </div>

          <section>
            <h3 className="font-semibold">Brand colors</h3>
            <p className="mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
              Enter six-digit hex values for both color modes.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {COLOR_FIELDS.map(({ key, label }) => (
                <Field key={key} label={label} htmlFor={`partner-color-${key}`}>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="h-9 w-9 shrink-0 rounded-full border border-stone-300 dark:border-white/[0.18]"
                      style={{ backgroundColor: safeSwatchColor(values.colors[key]) }}
                    />
                    <input
                      id={`partner-color-${key}`}
                      name={`colors.${key}`}
                      required
                      pattern="#[0-9a-fA-F]{6}"
                      maxLength={7}
                      value={values.colors[key]}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          colors: {
                            ...current.colors,
                            [key]: event.target.value.toLowerCase(),
                          },
                        }))
                      }
                      className={inputField}
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                  </div>
                </Field>
              ))}
            </div>
          </section>

          <section>
            <h3 className="font-semibold">Public HTTPS assets</h3>
            <p className="mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
              URLs are optional. Phase 1 does not upload files to storage.
            </p>
            <div className="mt-4 grid gap-4">
              {(
                [
                  ["logoLightUrl", "Light-mode logo URL"],
                  ["logoDarkUrl", "Dark-mode logo URL"],
                  ["faviconUrl", "Favicon URL"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label} htmlFor={`partner-${key}`}>
                  <input
                    id={`partner-${key}`}
                    name={key}
                    type="url"
                    inputMode="url"
                    value={optionalValue(values[key])}
                    onChange={(event) => setField(key, event.target.value)}
                    placeholder="https://assets.example.com/brand.png"
                    className={inputField}
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </Field>
              ))}
            </div>
          </section>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busyAction !== null}
            className={btnPrimaryCompact}
          >
            {busyAction === "create" || busyAction === "update"
              ? "Saving..."
              : mode === "create"
                ? "Create partner"
                : "Save profile"}
          </button>
          {mode === "create" && (
            <p className="text-sm text-stone-500 dark:text-[#bdbdbf]">
              New partners always start with a Pending domain.
            </p>
          )}
        </div>
      </form>

      {mode === "edit" && partner && (
        <section className={`space-y-4 p-4 ${tile}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Domain connection status</h3>
              <p className="mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
                Current status: {domainStatus === "connected" ? "Connected" : "Pending"}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                domainStatus === "connected" ? statusSuccess : statusWarning
              }`}
            >
              {domainStatus === "connected" ? "Connected" : "Pending"}
            </span>
          </div>
          {domainHasUnsavedChanges && (
            <p className="text-sm text-amber-700 dark:text-amber-200">
              Save the changed domain before changing its connection status.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={
                busyAction !== null ||
                domainHasUnsavedChanges ||
                domainStatus === "pending"
              }
              onClick={() => void setStoredDomainStatus("pending")}
              className={btnSecondaryCompact}
            >
              {busyAction === "pending" ? "Updating..." : "Mark Pending"}
            </button>
            <button
              type="button"
              disabled={
                busyAction !== null ||
                domainHasUnsavedChanges ||
                !persistedCustomDomain ||
                domainStatus === "connected"
              }
              onClick={() => void setStoredDomainStatus("connected")}
              className={btnPrimaryCompact}
            >
              {busyAction === "connected" ? "Updating..." : "Mark Connected"}
            </button>
          </div>
        </section>
      )}

      {error && (
        <p role="alert" className={`rounded-xl px-3 py-2 text-sm ${statusDanger}`}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={`rounded-xl px-3 py-2 text-sm ${statusSuccess}`}>
          {notice}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor}>
      <span className={fieldLabel}>{label}</span>
      {children}
    </label>
  );
}
