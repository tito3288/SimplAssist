export const BRAND_PREVIEW_HEADER = "x-sa-brand-preview";
export const BRAND_PREVIEW_COOKIE = "sa-admin-brand-preview";

export type BrandSource = "default" | "partner_host" | "admin_preview";

export type PublicBrand = {
  kind: "default" | "partner";
  partnerId: string | null;
  slug: string | null;
  name: string;
  publicOrigin: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  colors: {
    primary: string;
    primaryHover: string;
    primaryActive: string;
    accent: string;
    primaryDark: string;
    primaryHoverDark: string;
    primaryActiveDark: string;
    accentDark: string;
  };
};

export type RequestBrand = {
  source: BrandSource;
  isPreview: boolean;
  brand: PublicBrand;
};
