import { unstable_noStore as noStore } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import SetPasswordForm from "./SetPasswordForm";
import { requirePasswordSetupPageAccess } from "@/lib/customer/workspaceRouteResponse.server";
import {
  PASSWORD_RESET_INTENT_COOKIE,
  passwordResetOriginForWorkspaceHost,
  verifyPasswordResetIntent,
} from "@/lib/auth/recovery.server";
import { body, ink, inlineLink } from "@/lib/theme-v2/theme";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SetPasswordPage({
  searchParams = {},
}: {
  searchParams?: SearchParams;
}) {
  noStore();

  if (isExactInvalidResetLinkState(searchParams)) {
    return <InvalidResetLink />;
  }

  const mode = isExactResetMode(searchParams) ? "reset" : "setup";
  const access = await requirePasswordSetupPageAccess();

  if (mode === "reset") {
    const origin = passwordResetOriginForWorkspaceHost(
      access.hostKind,
      headers().get("host"),
    );
    if (
      !origin ||
      !verifyPasswordResetIntent(
        access.user.id,
        origin,
        cookies().get(PASSWORD_RESET_INTENT_COOKIE)?.value,
      )
    ) {
      return <InvalidResetLink />;
    }
  }

  if (
    mode === "setup" &&
    access.user.app_metadata?.must_set_password !== true
  ) {
    redirect("/dashboard");
  }

  return <SetPasswordForm mode={mode} />;
}

function isExactResetMode(searchParams: SearchParams): boolean {
  const keys = definedKeys(searchParams);
  return keys.length === 1 && keys[0] === "mode" && searchParams.mode === "reset";
}

function isExactInvalidResetLinkState(searchParams: SearchParams): boolean {
  const keys = definedKeys(searchParams).sort();
  return (
    keys.length === 2 &&
    keys[0] === "mode" &&
    keys[1] === "status" &&
    searchParams.mode === "reset" &&
    searchParams.status === "invalid-link"
  );
}

function definedKeys(searchParams: SearchParams): string[] {
  return Object.keys(searchParams).filter(
    (key) => searchParams[key] !== undefined,
  );
}

function InvalidResetLink() {
  return (
    <div className="text-center">
      <h1 className={`text-2xl font-bold tracking-tight ${ink}`}>
        Reset link expired
      </h1>
      <p className={`mt-3 text-sm leading-6 ${body}`}>
        This link has expired —{" "}
        <Link href="/forgot-password" className={inlineLink}>
          request a new one
        </Link>
      </p>
    </div>
  );
}
