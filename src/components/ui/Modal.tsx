"use client";

import { useEffect, useCallback, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, description, children }: ModalProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, handleEscape]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 animate-fade-in"
        onClick={onClose}
      />

      {/* Card */}
      <div className="relative bg-white border border-[#ece4d8] dark:bg-[rgba(18,18,20,0.92)] dark:backdrop-blur-[20px] dark:border-white/[0.14] rounded-[28px] shadow-[0_1px_2px_rgba(28,25,23,0.04),0_24px_60px_-12px_rgba(28,25,23,0.16)] dark:shadow-[0_30px_80px_rgba(0,0,0,0.6)] max-w-lg w-full max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="flex items-start justify-between p-6 pb-0">
          <div>
            {title && <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5]">{title}</h2>}
            {description && (
              <p className="text-sm text-stone-600 dark:text-[#bdbdbf] mt-1">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 dark:text-[#bdbdbf] hover:text-stone-600 dark:hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>

      <style jsx global>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in {
          animation: fade-in 0.15s ease-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-fade-in {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
