import "server-only";

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import {
  getFreshWorkspaceAccess,
  getWorkspaceAccess,
  type ResolvedWorkspaceAccess,
  type WorkspaceAccess,
} from "./workspaceAccess.server";

export type WorkspacePageRedirectTarget =
  | "/login"
  | "/set-password"
  | "/workspace-access"
  | null;

export type RequiredWorkspaceRouteAccess =
  | { ok: true; access: ResolvedWorkspaceAccess }
  | { ok: false; response: NextResponse };

export function workspacePageRedirectTarget(
  access: WorkspaceAccess,
  allowPasswordSetup = false,
): WorkspacePageRedirectTarget {
  if (access.status === "resolved") {
    return !allowPasswordSetup && requiresPasswordSetup(access)
      ? "/set-password"
      : null;
  }
  if (access.status === "unauthenticated") return "/login";
  return "/workspace-access";
}

export async function requireWorkspacePageAccess(): Promise<
  ResolvedWorkspaceAccess
> {
  const access = await getWorkspaceAccess();
  const target = workspacePageRedirectTarget(access);
  if (target) redirect(target);

  // The only null-target state is resolved. Keep the assertion local so leaf
  // pages share one fixed redirect policy and never derive a destination from
  // Host, query parameters, or preview state.
  return access as ResolvedWorkspaceAccess;
}

export async function requirePasswordSetupPageAccess(): Promise<
  ResolvedWorkspaceAccess
> {
  const access = await getWorkspaceAccess();
  const target = workspacePageRedirectTarget(access, true);
  if (target) redirect(target);

  return access as ResolvedWorkspaceAccess;
}

export async function requireWorkspaceRouteAccess(): Promise<
  RequiredWorkspaceRouteAccess
> {
  return requiredWorkspaceRouteAccess(await getWorkspaceAccess());
}

export async function requirePasswordSetupRouteAccess(): Promise<
  RequiredWorkspaceRouteAccess
> {
  return requiredWorkspaceRouteAccess(await getWorkspaceAccess(), true);
}

export async function requireFreshWorkspaceRouteAccess(): Promise<
  RequiredWorkspaceRouteAccess
> {
  return requiredWorkspaceRouteAccess(await getFreshWorkspaceAccess());
}

function requiredWorkspaceRouteAccess(
  access: WorkspaceAccess,
  allowPasswordSetup = false,
): RequiredWorkspaceRouteAccess {
  const response =
    workspaceAccessRouteResponse(access) ??
    (!allowPasswordSetup &&
    access.status === "resolved" &&
    requiresPasswordSetup(access)
      ? NextResponse.json(
          { error: "password_setup_required" },
          { status: 403 },
        )
      : null);

  return response
    ? { ok: false, response }
    : { ok: true, access: access as ResolvedWorkspaceAccess };
}

export async function getOptionalWorkspaceRouteAccess(): Promise<
  ResolvedWorkspaceAccess | null
> {
  const access = await getWorkspaceAccess();
  return access.status === "resolved" && !requiresPasswordSetup(access)
    ? access
    : null;
}

function requiresPasswordSetup(access: ResolvedWorkspaceAccess): boolean {
  return access.user.app_metadata?.must_set_password === true;
}

export function workspaceAccessRouteResponse(
  access: WorkspaceAccess,
): NextResponse | null {
  if (access.status === "resolved") return null;

  if (access.status === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (access.status === "lookup_failed") {
    return NextResponse.json(
      { error: "workspace_access_unavailable", retryable: true },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { error: "workspace_access_denied" },
    { status: 403 },
  );
}
