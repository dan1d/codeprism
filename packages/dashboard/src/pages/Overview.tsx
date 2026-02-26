import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import {
  Zap,
  DollarSign,
  MessageSquare,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Layers,
  FileText,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonCard } from "@/components/shared/LoadingState";
import { api, type MetricsSummary } from "@/lib/api";
import { formatTokens, formatCost, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
  icon: React.ReactNode;
  color?: "default" | "green" | "warning" | "danger";
}

function StatCard({ label, value, subtext, icon, color = "default" }: StatCardProps) {
  const valueColor = {
    default: "text-accent",
    green: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  }[color];

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs text-[#8b949e] font-medium">{label}</span>
        <span className="text-[#484f58]">{icon}</span>
      </div>
      <div className={cn("text-3xl font-bold font-mono-nums", valueColor)}>{value}</div>
      {subtext && <div className="mt-1 text-xs text-[#8b949e]">{subtext}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview page
// ---------------------------------------------------------------------------

export function Overview() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .metrics()
      .then(setSummary)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const handleReindex = async () => {
    setReindexing(true);
    try {
      const r = (await api.reindexStale()) as { message?: string };
      toast.success(r?.message ?? "Reindex started");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setReindexing(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Overview" />
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div>
        <PageHeader title="Overview" />
        <EmptyState
          icon={<AlertTriangle size={40} />}
          title="Could not load metrics"
          description={error ?? "Engine may not be running"}
        />
      </div>
    );
  }

  const noData = summary.totalCards === 0 && summary.totalQueries === 0;

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Knowledge base health at a glance"
        action={
          summary.staleCards > 0 ? (
            <button
              onClick={() => void handleReindex()}
              disabled={reindexing}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs bg-[#1c2333] border border-[#30363d] text-[#c9d1d9] hover:border-[#58a6ff]/50 hover:text-accent transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={reindexing ? "animate-spin" : ""} />
              {reindexing ? "Reindexing…" : `Reindex ${summary.staleCards} stale`}
            </button>
          ) : null
        }
      />

      {noData ? (
        <EmptyState
          icon={<FileText size={48} />}
          title="No repos indexed yet"
          description="Run pnpm index-repos to start building your knowledge base."
          action={
            <Link
              to="/dashboard/repos"
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
            >
              Go to Repositories <ArrowRight size={12} />
            </Link>
          }
        />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Tokens Saved"
              value={formatTokens(summary.estimatedTokensSaved)}
              subtext={`${summary.cacheHits} cache hits`}
              icon={<Zap size={16} />}
              color="green"
            />
            <StatCard
              label="Cost Saved"
              value={formatCost(summary.estimatedCostSaved)}
              subtext="estimated this period"
              icon={<DollarSign size={16} />}
              color="green"
            />
            <StatCard
              label="Queries Served"
              value={String(summary.totalQueries)}
              subtext="total queries"
              icon={<MessageSquare size={16} />}
            />
            <StatCard
              label="Cache Hit Rate"
              value={formatPercent(summary.cacheHitRate)}
              subtext={summary.cacheHitRate >= 0.6 ? "On track" : "Below target"}
              icon={<TrendingUp size={16} />}
              color={summary.cacheHitRate >= 0.6 ? "green" : summary.cacheHitRate >= 0.3 ? "warning" : "danger"}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Knowledge Health */}
            <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5">
              <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">
                Knowledge Health
              </h2>
              <div className="space-y-3">
                <HealthRow
                  icon={<Layers size={14} />}
                  label="Knowledge Cards"
                  value={String(summary.totalCards)}
                  status="ok"
                />
                <HealthRow
                  icon={<FileText size={14} />}
                  label="Flows Detected"
                  value={String(summary.totalFlows)}
                  status="ok"
                />
                <HealthRow
                  icon={
                    summary.staleCards > 0
                      ? <AlertTriangle size={14} />
                      : <CheckCircle2 size={14} />
                  }
                  label="Stale Cards"
                  value={String(summary.staleCards)}
                  status={summary.staleCards > 0 ? "warn" : "ok"}
                  link={summary.staleCards > 0 ? "/dashboard/knowledge?filter=stale" : undefined}
                  linkLabel="View stale →"
                />
              </div>

              {/* Health bar */}
              {summary.totalCards > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between text-[10px] text-[#8b949e] mb-1">
                    <span>Freshness</span>
                    <span>
                      {Math.round(
                        ((summary.totalCards - summary.staleCards) / summary.totalCards) * 100,
                      )}
                      %
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#1c2333]">
                    <div
                      className="h-1.5 rounded-full bg-success transition-all"
                      style={{
                        width: `${((summary.totalCards - summary.staleCards) / summary.totalCards) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Top Queries */}
            <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5">
              <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">
                Top Queries
              </h2>
              {summary.topQueries.length === 0 ? (
                <p className="text-xs text-[#484f58] italic">No queries yet</p>
              ) : (
                <div className="space-y-2">
                  {summary.topQueries.slice(0, 8).map((q) => (
                    <div key={q.query} className="flex items-center justify-between gap-3">
                      <span className="text-xs text-[#c9d1d9] font-mono truncate">{q.query}</span>
                      <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#1c2333] text-accent border border-[#30363d]">
                        {q.count}×
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Top Cards */}
          {summary.topCards.length > 0 && (
            <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">
                  Most Used Cards
                </h2>
                <Link
                  to="/dashboard/knowledge"
                  className="text-[10px] text-accent hover:underline flex items-center gap-1"
                >
                  View all <ArrowRight size={10} />
                </Link>
              </div>
              <div className="divide-y divide-[#21262d]">
                {summary.topCards.slice(0, 5).map((c) => (
                  <div key={c.cardId} className="flex items-center justify-between py-2">
                    <div className="min-w-0">
                      <span className="text-xs text-[#c9d1d9] font-medium truncate block">
                        {c.title}
                      </span>
                      <span className="text-[10px] text-[#8b949e] font-mono">{c.flow}</span>
                    </div>
                    <span className="flex-shrink-0 ml-4 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#1c2333] text-[#8b949e] border border-[#30363d]">
                      {c.usageCount} uses
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: health row
// ---------------------------------------------------------------------------

interface HealthRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: "ok" | "warn" | "error";
  link?: string;
  linkLabel?: string;
}

function HealthRow({ icon, label, value, status, link, linkLabel }: HealthRowProps) {
  const statusColor =
    status === "ok" ? "text-success" : status === "warn" ? "text-warning" : "text-danger";

  return (
    <div className="flex items-center justify-between">
      <div className={cn("flex items-center gap-2 text-xs", statusColor)}>
        {icon}
        <span className="text-[#c9d1d9]">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn("text-sm font-mono-nums font-semibold", statusColor)}>{value}</span>
        {link && linkLabel && (
          <Link to={link} className="text-[10px] text-accent hover:underline">
            {linkLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
