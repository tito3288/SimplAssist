"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { cn } from "@/lib/utils";
import { authInputClass } from "@/lib/glass";

const labelClass =
  "mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#d4d4d8]";

type AuthPasswordFieldProps = {
  id: string;
  label: string;
  autoComplete?: string;
  placeholder?: string;
  error?: string;
  registration: UseFormRegisterReturn;
};

export function AuthPasswordField({
  id,
  label,
  autoComplete,
  placeholder = "••••••••",
  error,
  registration,
}: AuthPasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          {...registration}
          className={cn(authInputClass, "pr-12")}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className={cn(
            "absolute right-2.5 top-1/2 -translate-y-1/2 rounded-xl p-2",
            "text-slate-500 transition-colors hover:text-[#ff914d]",
            "dark:text-[#888] dark:hover:text-[#ffb07a]",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff914d]/50 focus-visible:ring-offset-2",
            "focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0a0a0c]"
          )}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? (
            <Eye className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} aria-hidden />
          ) : (
            <EyeOff className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} aria-hidden />
          )}
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
