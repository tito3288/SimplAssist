'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface EmbedCodeGeneratorProps {
  businessId: string;
}

export default function EmbedCodeGenerator({ businessId }: EmbedCodeGeneratorProps) {
  const [copied, setCopied] = useState(false);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://yourdomain.com';
  const embedCode = `<script src="${appUrl}/widget/embed.js" data-business-id="${businessId}"></script>`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Embed Code</h2>
      <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">
        Add the chat widget to your website by copying the code below.
      </p>

      <div className="relative rounded-lg bg-gray-900 dark:bg-white/[0.03] dark:border dark:border-white/[0.10] p-4">
        <pre className="text-sm text-green-400 whitespace-pre-wrap break-all font-mono">
          {embedCode}
        </pre>
        <button
          onClick={handleCopy}
          className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-md bg-gray-700 dark:bg-white/[0.06] dark:border dark:border-white/[0.12] px-3 py-1.5 text-xs font-medium text-gray-200 dark:text-[#bdbdbf] hover:bg-gray-600 dark:hover:bg-white/[0.10] transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy to Clipboard
            </>
          )}
        </button>
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">
          Paste this code before the closing <code className="text-xs bg-gray-100 dark:bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">&lt;/body&gt;</code> tag
          on any page where you want the chat widget to appear. It works with WordPress, Squarespace, Wix, Shopify, and any other website.
        </p>
        <p className="text-xs text-slate-500 dark:text-[#bdbdbf]">
          Note: The widget will only appear when it&apos;s set to Active above.
        </p>
      </div>
    </div>
  );
}
