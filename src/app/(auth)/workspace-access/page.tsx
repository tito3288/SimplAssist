import { redirect } from "next/navigation";
import { WorkspaceAccessActions } from "@/components/auth/WorkspaceAccessActions";
import { getWorkspaceAccess } from "@/lib/customer/workspaceAccess.server";
import { body, ink, inlineLink } from "@/lib/theme-v2/theme";

export const dynamic = "force-dynamic";

export default async function WorkspaceAccessPage() {
  const access = await getWorkspaceAccess();

  if (access.status === "unauthenticated") {
    redirect("/login");
  }
  if (access.status === "resolved") {
    redirect("/dashboard");
  }

  if (access.status === "mismatch") {
    const expectedLoginHref = safeLoginHref(access.expectedOrigin);
    const expectedName = access.expectedName ?? "your assigned workspace";

    return (
      <WorkspaceAccessPanel
        title="This account belongs to a different workspace"
        description={`Use the sign-in address for ${expectedName}, or choose a different account for this workspace.`}
      >
        {expectedLoginHref && (
          <a
            href={expectedLoginHref}
            className={`block rounded-xl border border-[#e3dacc] px-4 py-3 text-center dark:border-white/[0.12] ${inlineLink}`}
            rel="noreferrer"
          >
            <span className="block font-semibold">Continue to {expectedName}</span>
            <span className={`mt-1 block break-all text-xs ${body}`}>
              {expectedLoginHref}
            </span>
          </a>
        )}
        {!expectedLoginHref && (
          <p className={`text-center text-sm ${body}`}>
            Contact your account administrator for the correct sign-in address.
          </p>
        )}
        <WorkspaceAccessActions />
      </WorkspaceAccessPanel>
    );
  }

  const copy = blockedCopy(access.status);
  return (
    <WorkspaceAccessPanel title={copy.title} description={copy.description}>
      <a href="/workspace-access" className={`block text-center ${inlineLink}`}>
        Try again
      </a>
      <WorkspaceAccessActions />
    </WorkspaceAccessPanel>
  );
}

function WorkspaceAccessPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h1 className={`text-center text-2xl font-bold tracking-tight ${ink}`}>
        {title}
      </h1>
      <p className={`mt-3 text-center text-sm leading-6 ${body}`}>
        {description}
      </p>
      <div className="mt-7 space-y-4">{children}</div>
    </div>
  );
}

function blockedCopy(
  status:
    | "business_not_found"
    | "lookup_failed"
    | "unknown_host"
    | "partner_unavailable"
): { title: string; description: string } {
  switch (status) {
    case "business_not_found":
      return {
        title: "Workspace unavailable",
        description:
          "We could not find a business workspace for this account. Try again or use a different account.",
      };
    case "lookup_failed":
      return {
        title: "We could not verify workspace access",
        description:
          "A temporary problem prevented us from checking this workspace. Please try again.",
      };
    case "unknown_host":
      return {
        title: "Workspace address not recognized",
        description:
          "This address is not connected to a workspace. Use your workspace’s exact sign-in address.",
      };
    case "partner_unavailable":
      return {
        title: "Workspace unavailable",
        description:
          "This partner workspace is not currently available. Contact your account administrator or try again later.",
      };
  }
}

function safeLoginHref(origin: string | null): string | null {
  if (!origin) return null;

  try {
    const url = new URL(origin);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.pathname = "/login";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
