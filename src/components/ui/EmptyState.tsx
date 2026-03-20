import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 bg-slate-100 dark:bg-white/[0.06] dark:border dark:border-white/[0.10] rounded-full flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-slate-400 dark:text-[#bdbdbf]" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-[#bdbdbf] max-w-sm mb-6">{description}</p>
      {action}
    </div>
  );
}
