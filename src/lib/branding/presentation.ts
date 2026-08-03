const DEFAULT_BRAND_NAME = "SimplAssist";

/**
 * Rewrites display-only copy that names the default product. A replacement
 * callback keeps `$` sequences in validated partner names literal.
 */
export function replaceDefaultBrandName(
  copy: string,
  brandName: string,
): string {
  return copy.replaceAll(DEFAULT_BRAND_NAME, () => brandName);
}
