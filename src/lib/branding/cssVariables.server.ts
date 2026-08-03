import "server-only";

import type { CSSProperties } from "react";
import {
  DEFAULT_BRAND,
  DEFAULT_BRAND_SUPPORT_COLORS,
} from "./defaultBrand";
import type { PublicBrand } from "./types";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const CORE_COLOR_VARIABLES = [
  ["primary", "--brand-primary"],
  ["primaryHover", "--brand-primary-hover"],
  ["primaryActive", "--brand-primary-active"],
  ["accent", "--brand-accent"],
  ["primaryDark", "--brand-primary-dark"],
  ["primaryHoverDark", "--brand-primary-hover-dark"],
  ["primaryActiveDark", "--brand-primary-active-dark"],
  ["accentDark", "--brand-accent-dark"],
] as const satisfies ReadonlyArray<
  readonly [keyof PublicBrand["colors"], `--brand-${string}`]
>;

type Rgb = readonly [red: number, green: number, blue: number];

export type BrandCssProperties = CSSProperties &
  Record<`--brand-${string}`, string>;

function parseHexColor(value: string): Rgb {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function hasValidCoreColors(brand: PublicBrand): boolean {
  return CORE_COLOR_VARIABLES.every(([colorKey]) => {
    const value = brand.colors?.[colorKey];
    return typeof value === "string" && HEX_COLOR.test(value);
  });
}

function rgbChannels(rgb: Rgb): string {
  return rgb.join(" ");
}

function rgbHex(rgb: Rgb): string {
  return `#${rgb
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixWithWhite(color: Rgb, colorWeight: number): string {
  const mix = (channel: number) =>
    Math.round(channel * colorWeight + 255 * (1 - colorWeight));

  return rgbHex([mix(color[0]), mix(color[1]), mix(color[2])]);
}

/**
 * Produces the complete, validated style map that is attached to the root
 * `<html>` element. Keeping this on the server makes the first paint branded;
 * no client-side DOM read or post-hydration mutation is needed.
 */
export function buildBrandCssProperties(brand: PublicBrand): BrandCssProperties {
  // Repository rows are validated before they become PublicBrand values. This
  // fixed allowlist is a final SSR boundary: a malformed future caller falls
  // back as one palette instead of emitting even a partial unsafe style map.
  const safeBrand = hasValidCoreColors(brand) ? brand : DEFAULT_BRAND;
  const style: Record<string, string> = {};
  const rgb = {} as Record<keyof PublicBrand["colors"], Rgb>;

  for (const [colorKey, variable] of CORE_COLOR_VARIABLES) {
    const value = safeBrand.colors[colorKey];
    const channels = parseHexColor(value);

    rgb[colorKey] = channels;
    style[variable] = value.toLowerCase();
    style[`${variable}-rgb`] = rgbChannels(channels);
  }

  const supportColors =
    safeBrand.kind === "default"
      ? DEFAULT_BRAND_SUPPORT_COLORS
      : {
          accentSoft: mixWithWhite(rgb.primary, 0.1),
          accentSoftBorder: mixWithWhite(rgb.primary, 0.2),
          accentSoftDark: mixWithWhite(rgb.accentDark, 0.4),
          primarySoftDark: mixWithWhite(rgb.primaryDark, 0.75),
        };

  style["--brand-accent-soft"] = supportColors.accentSoft;
  style["--brand-accent-soft-border"] = supportColors.accentSoftBorder;
  style["--brand-accent-soft-dark"] = supportColors.accentSoftDark;
  style["--brand-primary-soft-dark"] = supportColors.primarySoftDark;

  return style as BrandCssProperties;
}
