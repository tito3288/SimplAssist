"use client";

import { useEffect, useState } from "react";

const OPEN_PANEL_SELECTOR = ".sa-widget-panel.sa-visible";
const VISIBLE_LAUNCHER_SELECTOR = ".sa-widget-btn.sa-btn-visible";

function openHomepageChat() {
  const openPanel = document.querySelector(OPEN_PANEL_SELECTOR);
  if (openPanel) {
    document.querySelector<HTMLInputElement>(".sa-widget-input")?.focus();
    return;
  }

  document.querySelector<HTMLElement>(VISIBLE_LAUNCHER_SELECTOR)?.click();
}

export function OpenChatButton({ className }: { className: string }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const updateReadiness = () => {
      setIsReady(
        Boolean(
          document.querySelector(OPEN_PANEL_SELECTOR) ||
            document.querySelector(VISIBLE_LAUNCHER_SELECTOR)
        )
      );
    };

    updateReadiness();
    const observer = new MutationObserver(updateReadiness);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  return (
    <button
      type="button"
      className={`${className} disabled:cursor-wait disabled:opacity-60`}
      disabled={!isReady}
      onClick={openHomepageChat}
    >
      Ask away →
    </button>
  );
}
