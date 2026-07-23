"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { X } from "lucide-react";
import {
  toastBase,
  statusSuccess,
  statusDanger,
  statusInfo,
} from "@/lib/theme-v2/theme";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const typeStyles: Record<ToastType, string> = {
  success: statusSuccess,
  error: statusDanger,
  info: statusInfo,
};

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 ? (
        <>
          <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={`${toastBase} ${typeStyles[toast.type]} animate-slide-in`}
              >
                <span className="text-sm flex-1">{toast.message}</span>
                <button
                  onClick={() => dismiss(toast.id)}
                  className="opacity-60 hover:opacity-100 transition-opacity"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <style jsx global>{`
            @keyframes slide-in {
              from {
                opacity: 0;
                transform: translateX(100%);
              }
              to {
                opacity: 1;
                transform: translateX(0);
              }
            }
            .animate-slide-in {
              animation: slide-in 0.3s ease-out;
            }
            @media (prefers-reduced-motion: reduce) {
              .animate-slide-in {
                animation: none;
              }
            }
          `}</style>
        </>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
