"use client";

import { useState, type ChangeEvent } from "react";

import type { AdminAccountOwnershipFilter } from "@/lib/admin/accountFilters";

export interface AdminAccountPartnerOption {
  id: string;
  name: string;
}

interface AdminOwnershipFieldsProps {
  controlClass: string;
  initialOwnership: AdminAccountOwnershipFilter | null;
  initialPartnerId: string | null;
  partners: AdminAccountPartnerOption[];
}

export type AdminOwnershipValue = AdminAccountOwnershipFilter | "";

export interface AdminOwnershipFieldsState {
  ownership: AdminOwnershipValue;
  partnerId: string;
}

export function nextOwnershipFieldsState(
  currentState: AdminOwnershipFieldsState,
  nextOwnership: AdminOwnershipValue,
): AdminOwnershipFieldsState {
  return {
    ownership: nextOwnership,
    partnerId:
      nextOwnership === "partner" && currentState.ownership === "partner"
        ? currentState.partnerId
        : "",
  };
}

export function AdminOwnershipFields({
  controlClass,
  initialOwnership,
  initialPartnerId,
  partners,
}: AdminOwnershipFieldsProps) {
  const [state, setState] = useState<AdminOwnershipFieldsState>({
    ownership: initialOwnership ?? "",
    partnerId: initialPartnerId ?? "",
  });
  const { ownership, partnerId } = state;
  const selectedPartnerIsAvailable = partners.some(
    (partner) => partner.id === partnerId,
  );

  function handleOwnershipChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextOwnership = event.currentTarget.value as AdminOwnershipValue;
    setState((currentState) =>
      nextOwnershipFieldsState(currentState, nextOwnership),
    );
  }

  function handlePartnerChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextPartnerId = event.currentTarget.value;
    setState((currentState) => ({
      ...currentState,
      partnerId: nextPartnerId,
    }));
  }

  return (
    <>
      <label className="space-y-1 text-sm">
        <span className="block font-medium">Ownership</span>
        <select
          name="ownership"
          value={ownership}
          onChange={handleOwnershipChange}
          className={controlClass}
        >
          <option value="">All ownership</option>
          <option value="direct">SimplAssist Direct</option>
          <option value="partner">Partner</option>
        </select>
      </label>

      {ownership === "partner" ? (
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Specific partner</span>
          <select
            name="partner"
            value={partnerId}
            onChange={handlePartnerChange}
            className={controlClass}
          >
            <option value="">All partners</option>
            {partnerId && !selectedPartnerIsAvailable ? (
              <option value={partnerId}>Selected partner unavailable</option>
            ) : null}
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
