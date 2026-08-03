"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { PublicBrand, RequestBrand } from "@/lib/branding/types";

const BrandContext = createContext<RequestBrand | null>(null);

export function BrandProvider({
  requestBrand,
  children,
}: {
  requestBrand: RequestBrand;
  children: ReactNode;
}) {
  return (
    <BrandContext.Provider value={requestBrand}>
      {children}
    </BrandContext.Provider>
  );
}

export function useRequestBrand(): RequestBrand {
  const requestBrand = useContext(BrandContext);

  if (!requestBrand) {
    throw new Error("useRequestBrand must be used within a BrandProvider");
  }

  return requestBrand;
}

export function useBrand(): PublicBrand {
  return useRequestBrand().brand;
}
