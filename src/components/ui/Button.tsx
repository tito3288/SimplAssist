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
    "bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] active:bg-[var(--brand-primary-active)] active:translate-y-px dark:bg-[var(--brand-primary-dark)] dark:text-[#16100b] dark:hover:bg-[var(--brand-primary-hover-dark)] dark:active:bg-[var(--brand-primary-active-dark)] focus:ring-[var(--brand-primary)] dark:focus:ring-[var(--brand-primary-dark)]",
  secondary:
    "bg-white text-stone-700 border border-[#e7e0d4] hover:bg-[#faf6ef] hover:border-[#d9d0c1] active:translate-y-px dark:bg-white/[0.07] dark:text-white dark:border-white/[0.12] dark:hover:bg-white/[0.11] dark:hover:border-white/[0.16] focus:ring-stone-400/60 dark:focus:ring-white/40",
  danger: "bg-red-600 dark:bg-red-600/90 text-white hover:bg-red-700 focus:ring-red-500",
  ghost:
    "text-stone-700 dark:text-[#bdbdbf] hover:bg-stone-100 dark:hover:bg-white/[0.06] focus:ring-[var(--brand-primary)] dark:focus:ring-[var(--brand-primary-dark)]",
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
