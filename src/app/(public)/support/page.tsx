import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandLogo } from "@/components/branding/BrandLogo";
import { PublicPageShell } from "@/components/legal/LegalDocLayout";
import { getCanonicalAppOrigin } from "@/lib/branding/defaultBrand";
import { getRequestBrand } from "@/lib/branding/requestBrand.server";
import { getOptionalWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ThemeToggleV2 } from "@/lib/theme-v2/ui";
import { body, card, ink } from "@/lib/theme-v2/theme";
import {
  SUPPORT_CATEGORY_VALUES,
  SUPPORT_EMAIL,
  type SupportCategory,
} from "@/lib/support/constants";
import { SupportForm } from "./support-form";

/**
 * /support — the single support hub every "contact support" mention in the
 * product points at. Works logged-in (prefilled, ticket linked to the
 * business server-side) and logged-out. Unlike /demo and /home-v2 this is a
 * legitimate, indexable public page — normal metadata, no gate.
 */

const description =
  "Get help with billing, phone number registration, or anything else.";

const supportHeaderLink = `
  text-sm font-medium text-stone-600 dark:text-[#bdbdbf]
  transition-colors hover:text-[var(--brand-accent)]
  dark:hover:text-[var(--brand-accent-dark)]
`;

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await getRequestBrand();

  return {
    title: `Support — ${brand.name}`,
    description,
  };
}

export default async function SupportPage({
  searchParams,
}: {
  searchParams: { category?: string };
}) {
  const [{ brand }, workspace] = await Promise.all([
    getRequestBrand(),
    getOptionalWorkspaceRouteAccess(),
  ]);
  const user = workspace?.user ?? null;

  let businessName: string | null = null;
  if (workspace) {
    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("id, name")
      .eq("id", workspace.business.id)
      .maybeSingle();
    if (business?.id === workspace.business.id) {
      businessName = business.name ?? null;
    }
  }

  const canonicalOrigin = getCanonicalAppOrigin();
  const privacyHref = new URL("/privacy", canonicalOrigin).toString();
  const termsHref = new URL("/terms", canonicalOrigin).toString();

  const requestedCategory = searchParams.category;
  const defaultCategory = SUPPORT_CATEGORY_VALUES.includes(
    requestedCategory as SupportCategory
  )
    ? (requestedCategory as SupportCategory)
    : undefined;

  return (
    <PublicPageShell
      headerLeft={
        <>
          <Link
            href="/"
            className={`inline-flex items-center gap-2 ${supportHeaderLink}`}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            Back to home
          </Link>
          <Link href={privacyHref} className={supportHeaderLink}>
            Privacy
          </Link>
          <Link href={termsHref} className={supportHeaderLink}>
            Terms
          </Link>
        </>
      }
      headerRight={
        <>
          <BrandLogo
            width={110}
            height={27}
            className="h-6 w-auto object-contain"
            wordmarkClassName="max-w-44 text-base"
            priority
          />
          <ThemeToggleV2 />
        </>
      }
      footer={
        <p className={`mt-12 text-center text-xs ${body}`}>
          &copy; {new Date().getFullYear()} {brand.name}
          {brand.kind === "default"
            ? ", a product of Arambula Ventures LLC."
            : "."}
        </p>
      }
    >
      <div className={`${card} p-6 sm:p-10`}>
        <h1 className={`text-2xl font-bold tracking-tight ${ink}`}>
          Contact support
        </h1>
        <p className={`mt-1.5 text-sm ${body}`}>
          Tell us what you need and we&apos;ll get back to you by email.
        </p>
        {user && (
          <p className={`mt-3 text-xs ${body}`}>
            Signed in — this request will be linked to{" "}
            <span className={`font-semibold ${ink}`}>
              {businessName ?? "your account"}
            </span>
            .
          </p>
        )}

        <div className="mt-7">
          <SupportForm
            defaultName={
              (user?.user_metadata?.full_name as string | undefined) ?? ""
            }
            defaultEmail={user?.email ?? ""}
            defaultCategory={defaultCategory}
          />
        </div>

        {brand.kind === "default" && (
          <p
            className={`mt-8 border-t border-black/[0.06] pt-5 text-sm dark:border-white/[0.08] ${body}`}
          >
            Prefer email? Write to us at{" "}
            <span className={`select-all font-medium ${ink}`}>
              {SUPPORT_EMAIL}
            </span>
            .
          </p>
        )}
      </div>
    </PublicPageShell>
  );
}
