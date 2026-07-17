import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  PublicPageShell,
  publicHeaderLink,
} from "@/components/legal/LegalDocLayout";
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

export const metadata: Metadata = {
  title: "Support — SimplAssist",
  description:
    "Get help with billing, phone number registration, or anything else.",
};

export default async function SupportPage({
  searchParams,
}: {
  searchParams: { category?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let businessName: string | null = null;
  if (user) {
    const { data: business } = await supabase
      .from("businesses")
      .select("name")
      .eq("owner_id", user.id)
      .maybeSingle();
    businessName = business?.name ?? null;
  }

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
            href="/home"
            className={`inline-flex items-center gap-2 ${publicHeaderLink}`}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            Back to home
          </Link>
          <Link href="/privacy" className={`text-sm ${publicHeaderLink}`}>
            Privacy
          </Link>
          <Link href="/terms" className={`text-sm ${publicHeaderLink}`}>
            Terms
          </Link>
        </>
      }
      headerRight={
        <>
          <Image
            src="/logo-dark.png"
            alt="SimplAssist"
            width={110}
            height={27}
            className="hidden dark:block h-6 w-auto object-contain"
          />
          <Image
            src="/logo-light.png"
            alt="SimplAssist"
            width={110}
            height={27}
            className="block dark:hidden h-6 w-auto object-contain"
          />
          <ThemeToggleV2 />
        </>
      }
      footer={
        <p className={`mt-12 text-center text-xs ${body}`}>
          &copy; {new Date().getFullYear()} SimplAssist, a product of Arambula
          Ventures LLC.
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

        <p className={`mt-8 border-t border-black/[0.06] dark:border-white/[0.08] pt-5 text-sm ${body}`}>
          Prefer email? Write to us at{" "}
          <span className={`select-all font-medium ${ink}`}>{SUPPORT_EMAIL}</span>
          .
        </p>
      </div>
    </PublicPageShell>
  );
}
