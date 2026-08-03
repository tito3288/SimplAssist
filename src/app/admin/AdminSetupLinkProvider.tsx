"use client";

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

export type AdminSetupLinkTransfer = {
  stage: (provisioningId: string, setupUrl: string) => void;
  take: (provisioningId: string) => string | null;
};

const AdminSetupLinkContext = createContext<AdminSetupLinkTransfer | null>(null);

export function createOneShotAdminSetupLinkTransfer(): AdminSetupLinkTransfer {
  const pendingLinks = new Map<string, string>();

  return {
    stage(provisioningId, setupUrl) {
      pendingLinks.clear();
      pendingLinks.set(provisioningId, setupUrl);
    },
    take(provisioningId) {
      const setupUrl = pendingLinks.get(provisioningId) ?? null;
      pendingLinks.delete(provisioningId);
      return setupUrl;
    },
  };
}

/**
 * Carries a freshly generated recovery link across one soft admin navigation.
 * The link lives only in this mounted browser tree: never in a URL, cookie,
 * browser storage, server log, or database row. `take` deletes before returning
 * so navigating away and back cannot redisplay the same admin-held secret.
 */
export function AdminSetupLinkProvider({ children }: { children: ReactNode }) {
  const transferRef = useRef<AdminSetupLinkTransfer | null>(null);
  if (transferRef.current === null) {
    transferRef.current = createOneShotAdminSetupLinkTransfer();
  }
  const transfer = useMemo(() => transferRef.current!, []);

  return (
    <AdminSetupLinkContext.Provider value={transfer}>
      {children}
    </AdminSetupLinkContext.Provider>
  );
}

export function useAdminSetupLinkTransfer(): AdminSetupLinkTransfer {
  const transfer = useContext(AdminSetupLinkContext);
  if (!transfer) {
    throw new Error("Admin setup-link transfer is unavailable");
  }
  return transfer;
}
