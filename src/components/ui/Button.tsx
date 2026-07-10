import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { PulsingDot } from "@/components/ui/pulsing-dot";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  fullWidth?: boolean;
}

const variantStyles = {
  primary:
    "bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] text-white dark:text-[#111] hover:bg-orange-600 dark:hover:brightness-110 shadow-[0_14px_34px_rgba(255,145,77,.26)] focus:ring-[#ff914d]",
  secondary:
    "bg-white dark:bg-transparent dark:bg-white/[0.08] text-slate-700 dark:text-white border border-slate-300 dark:border-white/[0.10] hover:bg-slate-50 dark:hover:bg-white/[0.12] focus:ring-[#ff914d]",
  danger: "bg-red-600 dark:bg-red-600/90 text-white hover:bg-red-700 focus:ring-red-500",
  ghost:
    "text-slate-700 dark:text-[#bdbdbf] hover:bg-slate-100 dark:hover:bg-white/[0.06] focus:ring-[#ff914d]",
};

const sizeStyles = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      disabled,
      className,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center font-medium rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed",
          variantStyles[variant],
          sizeStyles[size],
          fullWidth && "w-full",
          className
        )}
        {...props}
      >
        {loading && <PulsingDot inline className="mr-2" />}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
