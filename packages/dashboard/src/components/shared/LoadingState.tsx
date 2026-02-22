import { cn } from "@/lib/utils";

interface LoadingStateProps {
  className?: string;
  rows?: number;
}

export function LoadingState({ className, rows = 4 }: LoadingStateProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-8 rounded bg-[#1c2333] animate-pulse"
          style={{ opacity: 1 - i * 0.15 }}
        />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5 space-y-3">
      <div className="h-3 w-1/3 rounded bg-[#1c2333] animate-pulse" />
      <div className="h-7 w-1/2 rounded bg-[#1c2333] animate-pulse" />
      <div className="h-2 w-2/3 rounded bg-[#1c2333] animate-pulse" />
    </div>
  );
}
