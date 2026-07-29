"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { fontStack } from "@/lib/theme-v2/theme";

function PreviewContent() {
  const searchParams = useSearchParams();
  const businessId = searchParams.get("businessId") || "";

  return (
    <>
      <div
        className="border-b border-[#ece4d8] bg-[#faf8f4] px-5 py-3 text-center text-sm text-stone-600 dark:border-white/[0.10] dark:bg-[#0a0a0b] dark:text-[#bdbdbf]"
        style={{ fontFamily: fontStack }}
      >
        Widget Preview - This is how the chat widget will appear on your website
      </div>
      {businessId && (
        <script
          src={`/widget/embed.js?v=${Date.now()}`}
          data-business-id={businessId}
          data-preview="true"
          async
        />
      )}
    </>
  );
}

export default function WidgetPreviewPage() {
  return (
    <Suspense>
      <PreviewContent />
    </Suspense>
  );
}
