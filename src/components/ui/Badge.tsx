import { cn } from "@/lib/utils";
import {
  statusSuccess,
  statusWarning,
  statusDanger,
  statusInfo,
  statusNeutral,
} from "@/lib/theme-v2/theme";

interface BadgeProps {
  variant?: "success" | "warning" | "error" | "info" | "default";
  size?: "sm" | "md";
  children: React.ReactNode;
  className?: string;
}

const variantStyles = {
  success: statusSuccess,
  warning: statusWarning,
  error: statusDanger,
  info: statusInfo,
  default: statusNeutral,
};

const sizeStyles = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-xs",
};

export function Badge({
  variant = "default",
  size = "md",
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-full",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
    >
      {children}
    </span>
  );
}
