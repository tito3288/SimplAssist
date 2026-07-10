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

      <div className="overflow-hidden rounded-lg border border-slate-700/80 bg-gray-900 dark:border-white/[0.10] dark:bg-white/[0.03]">
        <div className="flex items-center justify-end gap-2 border-b border-slate-700/80 bg-slate-800/80 px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.04]">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-600 dark:bg-white/[0.08] dark:text-[#e8e8e8] dark:hover:bg-white/[0.12]"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Copy to clipboard
              </>
            )}
          </button>
        </div>
        <pre className="p-4 text-sm font-mono text-green-400 whitespace-pre-wrap break-all">
          {embedCode}
        </pre>
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
