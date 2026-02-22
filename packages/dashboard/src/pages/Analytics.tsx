import { useEffect, useState } from "react";
import { AreaChart, BarChart, BarList } from "@tremor/react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SkeletonCard } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { api, type MetricsSummary } from "@/lib/api";
import { formatTokens, formatCost, formatPercent, cn } from "@/lib/utils";
import { BarChart2, DollarSign, Zap, TrendingUp } from "lucide-react";

type Range = "7d" | "30d" | "90d";

function getRangeParams(range: Range): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (range === "7d" ? 7 : range === "30d" ? 30 : 90));
  return {
    from: from.toISOString().split("T")[0]!,
    to: to.toISOString().split("T")[0]!,
  };
}

// ---------------------------------------------------------------------------
// Mini stat card
// ---------------------------------------------------------------------------

interface MiniStatProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color?: string;
}

function MiniStat({ label, value, icon, color = "text-accent" }: MiniStatProps) {
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[#484f58]">{icon}</span>
        <span className="text-[10px] text-[#8b949e] font-medium">{label}</span>
      </div>
      <div className={cn("text-2xl font-mono-nums font-bold", color)}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dev usage table
// ---------------------------------------------------------------------------

interface DevUsageTableProps {
  devStats: MetricsSummary["devStats"];
}

function DevUsageTable({ devStats }: DevUsageTableProps) {
  if (devStats.length === 0) {
    return <p className="text-xs text-[#484f58] italic">No developer usage data yet</p>;
  }

  const maxQueries = Math.max(...devStats.map((d) => d.queries), 1);

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] overflow-hidden">
      <div className="grid grid-cols-[1fr_80px_200px_80px] gap-4 px-4 py-2 bg-[#1c2333] border-b border-[#30363d] text-[10px] font-medium text-[#484f58] uppercase tracking-wider">
        <span>Developer</span>
        <span className="text-right">Queries</span>
        <span>Cache hit rate</span>
        <span className="text-right">Tokens saved</span>
      </div>
      <div className="divide-y divide-[#21262d]">
        {devStats.map((dev) => {
          const hitRate = dev.queries > 0 ? dev.cacheHits / dev.queries : 0;
          const tokensSaved = dev.cacheHits * 5000;
          const barWidth = Math.round((dev.queries / maxQueries) * 100);

          return (
            <div key={dev.devId} className="grid grid-cols-[1fr_80px_200px_80px] gap-4 px-4 py-3 items-center">
              <div className="min-w-0">
                <span className="text-xs font-mono text-[#c9d1d9] truncate block">
                  @{dev.devId}
                </span>
                {/* Activity bar */}
                <div className="mt-1.5 h-1 rounded-full bg-[#1c2333]">
                  <div
                    className="h-1 rounded-full bg-accent/50 transition-all"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
              <span className="text-right font-mono-nums text-sm text-[#c9d1d9]">{dev.queries}</span>

              {/* Cache hit rate bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-[#1c2333]">
                  <div
                    className={cn(
                      "h-2 rounded-full transition-all",
                      hitRate >= 0.7 ? "bg-success" : hitRate >= 0.4 ? "bg-warning" : "bg-danger",
                    )}
                    style={{ width: `${hitRate * 100}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono-nums text-[#8b949e] w-8 text-right">
                  {Math.round(hitRate * 100)}%
                </span>
              </div>

              <span className="text-right font-mono-nums text-xs text-[#8b949e]">
                {formatTokens(tokensSaved)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytics page
// ---------------------------------------------------------------------------

export function Analytics() {
  const [range, setRange] = useState<Range>("30d");
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = getRangeParams(range);
    api
      .metrics(params)
      .then(setSummary)
      .finally(() => setLoading(false));
  }, [range]);

  // Prepare chart data
  const chartData = (summary?.queriesByDay ?? []).map((d) => ({
    date: d.date,
    Queries: d.total,
    "Cache Hits": d.cacheHits,
    Misses: d.total - d.cacheHits,
  }));

  const cacheRateData = (summary?.queriesByDay ?? []).map((d) => ({
    date: d.date,
    "Cache Hit %": d.total > 0 ? Math.round((d.cacheHits / d.total) * 100) : 0,
    Target: 80,
  }));

  const topCardsList = (summary?.topCards ?? []).map((c) => ({
    name: c.title,
    value: c.usageCount,
  }));

  const topQueriesList = (summary?.topQueries ?? []).map((q) => ({
    name: q.query,
    value: q.count,
  }));

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Usage trends and ROI"
        action={
          <div className="flex rounded-md border border-[#30363d] overflow-hidden text-xs">
            {(["7d", "30d", "90d"] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  "px-3 py-1.5 transition-colors",
                  range === r
                    ? "bg-[#1c2333] text-[#e1e4e8]"
                    : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22]",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        }
      />

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : !summary ? (
        <EmptyState icon={<BarChart2 size={40} />} title="Could not load analytics" />
      ) : (
        <div className="space-y-5">
          {/* ROI summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MiniStat
              label="Tokens Saved"
              value={formatTokens(summary.estimatedTokensSaved)}
              icon={<Zap size={14} />}
              color="text-success"
            />
            <MiniStat
              label="Cost Saved"
              value={formatCost(summary.estimatedCostSaved)}
              icon={<DollarSign size={14} />}
              color="text-success"
            />
            <MiniStat
              label="Total Queries"
              value={String(summary.totalQueries)}
              icon={<BarChart2 size={14} />}
            />
            <MiniStat
              label="Cache Hit Rate"
              value={formatPercent(summary.cacheHitRate)}
              icon={<TrendingUp size={14} />}
              color={summary.cacheHitRate >= 0.6 ? "text-success" : "text-warning"}
            />
          </div>

          {/* Queries over time */}
          {chartData.length > 0 ? (
            <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5">
              <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">
                Queries Over Time
              </h2>
              <AreaChart
                data={chartData}
                index="date"
                categories={["Cache Hits", "Misses"]}
                colors={["emerald", "slate"]}
                valueFormatter={(v: number) => String(v)}
                showLegend
                showGridLines={false}
                className="h-48"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5">
              <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">Queries Over Time</h2>
              <p className="text-xs text-[#484f58] italic py-8 text-center">Analytics appear after your first queries</p>
            </div>
          )}

          {/* Cache hit rate over time */}
          {cacheRateData.length > 0 && cacheRateData.some((d) => d["Cache Hit %"] > 0) && (
            <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5">
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Cache Hit Rate</h2>
                <div className="flex items-center gap-1.5 text-[10px] text-[#484f58]">
                  <span className="w-3 border-t border-dashed border-warning" />
                  80% target
                </div>
              </div>
              <BarChart
                data={cacheRateData}
                index="date"
                categories={["Cache Hit %"]}
                colors={["blue"]}
                valueFormatter={(v: number) => `${v}%`}
                showLegend={false}
                showGridLines={false}
                className="h-40"
              />
            </div>
          )}

          {/* Developer usage */}
          {summary.devStats.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-3">
                Developer Usage ({range})
              </h2>
              <DevUsageTable devStats={summary.devStats} />
            </div>
          )}

          {/* Top cards + queries */}
          {(topCardsList.length > 0 || topQueriesList.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {topCardsList.length > 0 && (
                <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5">
                  <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">Top Cards</h2>
                  <BarList
                    data={topCardsList.slice(0, 8)}
                    valueFormatter={(v: number) => `${v}×`}
                    color="blue"
                  />
                </div>
              )}
              {topQueriesList.length > 0 && (
                <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5">
                  <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">Top Queries</h2>
                  <BarList
                    data={topQueriesList.slice(0, 8)}
                    valueFormatter={(v: number) => `${v}×`}
                    color="slate"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
