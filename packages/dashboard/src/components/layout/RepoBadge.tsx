import { cn, stackColor } from "@/lib/utils";

interface RepoBadgeProps {
  label: string;
  className?: string;
}

export function RepoBadge({ label, className }: RepoBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border",
        stackColor(label),
        className,
      )}
    >
      {label}
    </span>
  );
}

interface RepoBadgesProps {
  items: string[];
  max?: number;
}

export function RepoBadges({ items, max = 3 }: RepoBadgesProps) {
  const visible = items.slice(0, max);
  const overflow = items.length - max;
  return (
    <span className="flex flex-wrap gap-1">
      {visible.map((item) => (
        <RepoBadge key={item} label={item} />
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-[#8b949e] bg-[#1c2333] border border-[#30363d]">
          +{overflow}
        </span>
      )}
    </span>
  );
}
