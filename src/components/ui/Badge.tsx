import { cn } from "@/lib/utils";

interface BadgeProps {
  variant?: "success" | "warning" | "error" | "info" | "default";
  size?: "sm" | "md";
  children: React.ReactNode;
  className?: string;
}

const variantStyles = {
  success:
    "bg-green-100 text-green-700 dark:bg-[rgba(34,197,94,.14)] dark:text-green-400 dark:border dark:border-green-500/20",
  warning:
    "bg-yellow-100 text-yellow-700 dark:bg-[rgba(234,179,8,.14)] dark:text-yellow-400 dark:border dark:border-yellow-500/20",
  error:
    "bg-red-100 text-red-700 dark:bg-[rgba(239,68,68,.14)] dark:text-red-400 dark:border dark:border-red-500/20",
  info:
    "bg-blue-100 text-blue-700 dark:bg-[rgba(59,130,246,.14)] dark:text-blue-400 dark:border dark:border-blue-500/20",
  default:
    "bg-gray-100 text-gray-700 dark:bg-white/[0.08] dark:text-[#bdbdbf] dark:border dark:border-white/[0.10]",
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
