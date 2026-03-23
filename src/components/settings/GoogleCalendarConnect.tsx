'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface GoogleCalendarConnectProps {
  businessId: string;
  connectedEmail: string | null;
}

export default function GoogleCalendarConnect({
  connectedEmail,
}: GoogleCalendarConnectProps) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);

  const handleConnect = () => {
    window.location.href = '/api/google/auth';
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/google/disconnect', { method: 'POST' });
      if (res.ok) {
        router.refresh();
      }
    } catch {
      // Error disconnecting
    } finally {
      setDisconnecting(false);
    }
  };

  if (connectedEmail) {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-[#f5f5f5]">
              Connected
            </p>
            <p className="text-xs text-slate-500 dark:text-[#bdbdbf]">
              {connectedEmail}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="px-4 py-2 text-sm rounded-lg border border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
        >
          {disconnecting ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleConnect}
        className="inline-flex items-center justify-center gap-3 px-5 py-3 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-[#f5f5f5] font-medium hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Connect Google Calendar
      </button>
      <p className="text-xs text-slate-500 dark:text-[#bdbdbf]">
        Allows your AI to check your availability and book appointments directly on your calendar.
      </p>
    </div>
  );
}
