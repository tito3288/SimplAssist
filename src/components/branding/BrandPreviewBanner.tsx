"use client";

import { useRequestBrand } from "./BrandProvider";

export function BrandPreviewBanner() {
  const requestBrand = useRequestBrand();

  if (!requestBrand.isPreview) return null;

  const isPartnerPreview = requestBrand.brand.kind === "partner";

  return (
    <aside
      aria-label="Brand preview"
      className="relative z-[60] border-b border-[var(--brand-accent-soft-border)] bg-[var(--brand-accent-soft)] px-4 py-2.5 text-[var(--brand-accent)] dark:border-[rgb(var(--brand-primary-dark-rgb)/0.24)] dark:bg-[rgb(var(--brand-primary-dark-rgb)/0.14)] dark:text-[var(--brand-accent-soft-dark)]"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center text-sm sm:justify-between sm:text-left">
        <span>
          {isPartnerPreview ? (
            <>
              Previewing <strong>{requestBrand.brand.name}</strong> branding.
            </>
          ) : (
            <>
              This brand preview is unavailable. Showing SimplAssist&apos;s
              default branding.
            </>
          )}
        </span>
        <a
          href="?brand="
          rel="nofollow"
          className="shrink-0 rounded-full border border-[var(--brand-accent-soft-border)] bg-white/70 px-3 py-1 font-semibold text-[var(--brand-accent)] transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary-rgb)/0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-accent-soft)] dark:border-[rgb(var(--brand-primary-dark-rgb)/0.3)] dark:bg-black/20 dark:text-[var(--brand-accent-soft-dark)] dark:hover:bg-black/30 dark:focus-visible:ring-[rgb(var(--brand-primary-dark-rgb)/0.6)] dark:focus-visible:ring-offset-[#050505]"
        >
          Clear preview
        </a>
      </div>
    </aside>
  );
}
