"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function PreviewContent() {
  const searchParams = useSearchParams();
  const businessId = searchParams.get("businessId") || "";

  return (
    <>
      <div
        style={{
          background: "#f0f4ff",
          borderBottom: "1px solid #d0d8e8",
          padding: "12px 20px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "14px",
          color: "#4a5568",
          textAlign: "center",
        }}
      >
        Widget Preview - This is how the chat widget will appear on your website
      </div>
      {businessId && (
        <script
          src={`/widget/embed.js?v=${Date.now()}`}
          data-business-id={businessId}
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
