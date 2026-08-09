"use client";

import { useEffect, useLayoutEffect } from "react";
import Script from "next/script";

export const HOMEPAGE_WIDGET_BODY_CLASS = "sa-homepage-widget-route";

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type BodyClassTarget = Pick<HTMLElement, "classList">;

export function enableHomepageWidget(target: BodyClassTarget) {
  target.classList.add(HOMEPAGE_WIDGET_BODY_CLASS);

  return () => {
    target.classList.remove(HOMEPAGE_WIDGET_BODY_CLASS);
  };
}

export function HomepageChatWidget() {
  useBrowserLayoutEffect(() => enableHomepageWidget(document.body), []);

  return (
    <Script
      src="https://simplassist.com/widget/embed.js?placement=homepage-v1"
      data-business-id="ea848911-ef72-44a6-8cf3-c47b3959be26"
      data-homepage-only="true"
      strategy="afterInteractive"
    />
  );
}
