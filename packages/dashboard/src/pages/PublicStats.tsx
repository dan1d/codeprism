import { useEffect, useRef, useState } from "react";
import { Zap, MessageSquare, Layers, Globe } from "lucide-react";
import { api, type PublicStats as PublicStatsData } from "@/lib/api";
import { formatTokens, formatPercent, cn } from "@/lib/utils";

function useAnimatedNumber(target: number, duration = 1200): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef(0);

  useEffect(() => {
    if (target === 0) return;
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return value;
}

interface BigStatProps {
  label: string;
  value: number;
  format: (n: number) => string;
  icon: React.ReactNode;
}

function BigStat({ label, value, format, icon }: BigStatProps) {
  const animated = useAnimatedNumber(value);
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-8 text-center">
      <div className="mb-3 flex items-center justify-center text-[#8b949e]">
        {icon}
      </div>
      <div className="font-mono-nums text-4xl font-bold text-accent">
        {format(animated)}
      </div>
      <div className="mt-2 text-sm text-[#8b949e]">{label}</div>
    </div>
  );
}

export function PublicStats() {
  const [stats, setStats] = useState<PublicStatsData | null>(null);

  useEffect(() => {
    const load = () => api.publicStats().then(setStats).catch(() => {});
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-12 text-center">
          <h1 className="font-mono-nums text-3xl font-bold text-[#e1e4e8]">
            codeprism
          </h1>
          <p className="mt-2 text-[#8b949e]">
            Open Source Code Context Engine
          </p>
        </header>

        {stats && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <BigStat
                label="Tokens Saved"
                value={stats.totalTokensSaved}
                format={formatTokens}
                icon={<Zap className="h-6 w-6" />}
              />
              <BigStat
                label="Queries Served"
                value={stats.totalQueries}
                format={formatTokens}
                icon={<MessageSquare className="h-6 w-6" />}
              />
              <BigStat
                label="Knowledge Cards"
                value={stats.totalCards}
                format={(n) => n.toLocaleString()}
                icon={<Layers className="h-6 w-6" />}
              />
              <BigStat
                label="Active Instances"
                value={stats.activeInstances}
                format={(n) => n.toLocaleString()}
                icon={<Globe className="h-6 w-6" />}
              />
            </div>

            <div className="mt-6 text-center">
              <span
                className={cn(
                  "inline-block rounded-full border border-[#30363d] bg-[#161b22] px-4 py-1.5",
                  "text-sm font-mono-nums text-[#8b949e]"
                )}
              >
                Cache hit rate: {formatPercent(stats.avgCacheHitRate)}
              </span>
            </div>
          </>
        )}

        <footer className="mt-16 flex items-center justify-center gap-4 text-sm text-[#8b949e]">
          <a
            href="https://github.com/codeprism/codeprism"
            className="hover:text-accent transition-colors"
          >
            Self-host codeprism
          </a>
          <span className="text-[#30363d]">|</span>
          <a
            href="https://github.com/codeprism/codeprism"
            className="hover:text-accent transition-colors"
          >
            View on GitHub
          </a>
        </footer>
      </div>
    </div>
  );
}
