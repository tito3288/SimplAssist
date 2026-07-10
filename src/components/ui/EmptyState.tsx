import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { body, ink } from "@/lib/theme-v2/theme";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 bg-[#f3efe7] dark:bg-white/[0.06] dark:border dark:border-white/[0.10] rounded-full flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-stone-400 dark:text-[#bdbdbf]" />
      </div>
      <h3 className={`text-sm font-semibold mb-1 ${ink}`}>{title}</h3>
      <p className={`text-sm max-w-sm mb-6 ${body}`}>{description}</p>
      {action}
    </div>
  );
}
