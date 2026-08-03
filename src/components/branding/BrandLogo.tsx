"use client";

import Image from "next/image";
import { useState } from "react";
import type { PublicBrand } from "@/lib/branding/types";
import { normalizeHostHeader } from "@/lib/branding/hostname";
import { cn } from "@/lib/utils";
import { useBrand } from "./BrandProvider";

export type BrandLogoProps = {
  width: number;
  height: number;
  className?: string;
  wordmarkClassName?: string;
  priority?: boolean;
};

function isObviouslyPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }

  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function validatedPartnerLogoUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const normalizedHostname = normalizeHostHeader(hostname);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !normalizedHostname ||
      normalizedHostname !== hostname ||
      !hostname.includes(".") ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      isObviouslyPrivateIpv4(hostname)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function resolvePartnerLogoSources(
  brand: PublicBrand,
  failedPartnerLogos: readonly string[] = [],
): {
  brandKey: string;
  lightLogo: string | null;
  darkLogo: string | null;
} {
  const configuredLightLogo = validatedPartnerLogoUrl(brand.logoLightUrl);
  const configuredDarkLogo = validatedPartnerLogoUrl(brand.logoDarkUrl);
  const brandKey = brand.partnerId ?? brand.slug ?? brand.name;
  const isFailed = (url: string | null) =>
    !!url && failedPartnerLogos.includes(`${brandKey}:${url}`);
  const availableLightLogo = isFailed(configuredLightLogo)
    ? null
    : configuredLightLogo;
  const availableDarkLogo = isFailed(configuredDarkLogo)
    ? null
    : configuredDarkLogo;

  return {
    brandKey,
    lightLogo: availableLightLogo ?? availableDarkLogo,
    darkLogo: availableDarkLogo ?? availableLightLogo,
  };
}

export function BrandLogo({
  width,
  height,
  className,
  wordmarkClassName,
  priority = false,
}: BrandLogoProps) {
  const brand = useBrand();
  const [failedPartnerLogos, setFailedPartnerLogos] = useState<readonly string[]>(
    [],
  );

  if (brand.kind === "default") {
    return (
      <>
        <Image
          src="/logo-light.png"
          alt={brand.name}
          width={width}
          height={height}
          className={cn(className, "dark:hidden")}
          priority={priority}
        />
        <Image
          src="/logo-dark.png"
          alt={brand.name}
          width={width}
          height={height}
          className={cn(className, "hidden dark:block")}
          priority={priority}
        />
      </>
    );
  }

  const { brandKey, lightLogo, darkLogo } = resolvePartnerLogoSources(
    brand,
    failedPartnerLogos,
  );

  if (!lightLogo || !darkLogo) {
    return (
      <span
        data-brand-wordmark="partner"
        className={cn(
          "inline-block max-w-full truncate font-bold tracking-tight text-[var(--brand-accent)] dark:text-[var(--brand-accent-dark)]",
          wordmarkClassName,
        )}
      >
        {brand.name}
      </span>
    );
  }

  const handleError = (failedUrl: string) => {
    const failureKey = `${brandKey}:${failedUrl}`;
    setFailedPartnerLogos((current) =>
      current.includes(failureKey) ? current : [...current, failureKey],
    );
  };

  return (
    <>
      {/* Partner assets are validated public HTTPS URLs and deliberately avoid
          next/image's build-time remote-host allowlist. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={lightLogo}
        alt={brand.name}
        width={width}
        height={height}
        className={cn(className, "dark:hidden")}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        data-brand-logo="partner"
        onError={() => handleError(lightLogo)}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={darkLogo}
        alt={brand.name}
        width={width}
        height={height}
        className={cn(className, "hidden dark:block")}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        data-brand-logo="partner"
        onError={() => handleError(darkLogo)}
      />
    </>
  );
}
