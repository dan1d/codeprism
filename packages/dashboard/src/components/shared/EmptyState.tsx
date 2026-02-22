import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      {icon && <div className="mb-4 text-[#484f58] text-4xl">{icon}</div>}
      <p className="text-sm font-medium text-[#c9d1d9]">{title}</p>
      {description && <p className="mt-1 text-xs text-[#8b949e]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
