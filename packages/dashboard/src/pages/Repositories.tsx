import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  RefreshCw,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  GitBranch,
  Layers,
  FileText,
  Clock,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RepoBadges } from "@/components/layout/RepoBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingState } from "@/components/shared/LoadingState";
import { api, type RepoSummary } from "@/lib/api";
import { formatRelativeTime, cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Repo Drawer
// ---------------------------------------------------------------------------

interface RepoDrawerProps {
  repo: RepoSummary;
  onClose: () => void;
  onReindex: (repo: string) => void;
  reindexing: boolean;
}

function RepoDrawer({ repo, onClose, onReindex, reindexing }: RepoDrawerProps) {
  const freshness =
    repo.cardCount > 0
      ? Math.round(((repo.cardCount - repo.staleCards) / repo.cardCount) * 100)
      : 100;

  return (
    <div className="fixed inset-y-0 right-0 w-[440px] bg-[#0f1117] border-l border-[#30363d] z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-[#21262d]">
        <div>
          <h2 className="text-sm font-semibold text-[#e1e4e8] font-mono">{repo.repo}</h2>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <RepoBadges items={[repo.primaryLanguage, ...repo.frameworks].filter(Boolean)} max={4} />
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#1c2333] transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-[#161b22] border border-[#30363d] p-3 text-center">
            <div className="text-xl font-mono-nums font-bold text-accent">{repo.cardCount}</div>
            <div className="text-[10px] text-[#8b949e] mt-0.5">Cards</div>
          </div>
          <div className="rounded-lg bg-[#161b22] border border-[#30363d] p-3 text-center">
            <div className="text-xl font-mono-nums font-bold text-[#e1e4e8]">
              {repo.indexedFiles}
            </div>
            <div className="text-[10px] text-[#8b949e] mt-0.5">Files</div>
          </div>
          <div className={cn(
            "rounded-lg bg-[#161b22] border p-3 text-center",
            repo.staleCards > 0 ? "border-warning/30" : "border-[#30363d]",
          )}>
            <div className={cn(
              "text-xl font-mono-nums font-bold",
              repo.staleCards > 0 ? "text-warning" : "text-success",
            )}>
              {repo.staleCards}
            </div>
            <div className="text-[10px] text-[#8b949e] mt-0.5">Stale</div>
          </div>
        </div>

        {/* Freshness bar */}
        <div>
          <div className="flex justify-between text-[10px] text-[#8b949e] mb-1.5">
            <span>Card freshness</span>
            <span>{freshness}%</span>
          </div>
          <div className="h-2 rounded-full bg-[#1c2333]">
            <div
              className={cn(
                "h-2 rounded-full transition-all",
                freshness >= 80 ? "bg-success" : freshness >= 50 ? "bg-warning" : "bg-danger",
              )}
              style={{ width: `${freshness}%` }}
            />
          </div>
        </div>

        {/* Last indexed */}
        <div className="flex items-center gap-2 text-xs text-[#8b949e]">
          <Clock size={12} />
          <span>Last indexed: {formatRelativeTime(repo.lastIndexedAt)}</span>
        </div>

        {/* Stack */}
        {(repo.primaryLanguage || repo.frameworks.length > 0) && (
          <div>
            <h3 className="text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-2">
              Stack
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {[repo.primaryLanguage, ...repo.frameworks]
                .filter(Boolean)
                .map((s) => (
                  <span
                    key={s}
                    className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#1c2333] text-[#8b949e] border border-[#30363d]"
                  >
                    {s}
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="p-5 border-t border-[#21262d] flex gap-2">
        <button
          onClick={() => onReindex(repo.repo)}
          disabled={reindexing}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs bg-accent text-black font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {reindexing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {reindexing ? "Reindexing…" : "Re-index"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------

function StatusDot({ staleCards }: { staleCards: number }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full flex-shrink-0",
        staleCards > 0 ? "bg-warning" : "bg-success",
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Repositories page
// ---------------------------------------------------------------------------

export function Repositories() {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RepoSummary | null>(null);
  const [reindexingRepo, setReindexingRepo] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  const load = useCallback(() => {
    setLoading(true);
    api
      .repos()
      .then((r) => {
        setRepos(r);
        const highlight = searchParams.get("highlight");
        if (highlight) {
          const found = r.find((repo) => repo.repo === highlight);
          if (found) setSelected(found);
        }
      })
      .finally(() => setLoading(false));
  }, [searchParams]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReindex = async (repoName: string) => {
    setReindexingRepo(repoName);
    try {
      await api.reindexStale(repoName);
      setTimeout(() => {
        load();
        setReindexingRepo(null);
      }, 2000);
    } catch {
      setReindexingRepo(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Repositories"
        subtitle={repos.length > 0 ? `${repos.length} repo${repos.length !== 1 ? "s" : ""} indexed` : undefined}
      />

      {loading ? (
        <LoadingState rows={5} />
      ) : repos.length === 0 ? (
        <EmptyState
          icon={<GitBranch size={40} />}
          title="No repositories indexed yet"
          description="Run pnpm index-repos <repo-path> to index your first repository."
        />
      ) : (
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[auto_1fr_80px_80px_80px_100px_80px] gap-4 px-4 py-2.5 bg-[#1c2333] border-b border-[#30363d] text-[10px] font-medium text-[#484f58] uppercase tracking-wider">
            <span />
            <span>Repository</span>
            <span className="text-right">Cards</span>
            <span className="text-right">Files</span>
            <span className="text-right">Stale</span>
            <span>Last sync</span>
            <span />
          </div>

          {/* Table rows */}
          <div className="divide-y divide-[#21262d]">
            {repos.map((repo) => (
              <div
                key={repo.repo}
                className={cn(
                  "grid grid-cols-[auto_1fr_80px_80px_80px_100px_80px] gap-4 px-4 py-3 items-center hover:bg-[#1c2333]/50 cursor-pointer transition-colors",
                  selected?.repo === repo.repo && "bg-[#1c2333]/70",
                )}
                onClick={() => setSelected(repo)}
              >
                <StatusDot staleCards={repo.staleCards} />

                {/* Repo name + stack */}
                <div className="min-w-0">
                  <span className="text-sm font-mono text-[#c9d1d9] truncate block">{repo.repo}</span>
                  <div className="mt-1">
                    <RepoBadges
                      items={[repo.primaryLanguage, ...repo.frameworks].filter(Boolean)}
                      max={3}
                    />
                  </div>
                </div>

                <span className="text-right font-mono-nums text-sm text-[#c9d1d9]">
                  {repo.cardCount}
                </span>
                <span className="text-right font-mono-nums text-sm text-[#8b949e]">
                  {repo.indexedFiles}
                </span>

                <span className={cn(
                  "text-right font-mono-nums text-sm",
                  repo.staleCards > 0 ? "text-warning" : "text-[#484f58]",
                )}>
                  {repo.staleCards > 0 ? (
                    <span className="flex items-center justify-end gap-1">
                      <AlertTriangle size={11} />
                      {repo.staleCards}
                    </span>
                  ) : (
                    <CheckCircle2 size={13} className="ml-auto text-success" />
                  )}
                </span>

                <span className="text-xs text-[#8b949e]">
                  {formatRelativeTime(repo.lastIndexedAt)}
                </span>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleReindex(repo.repo);
                  }}
                  disabled={reindexingRepo === repo.repo}
                  className="flex items-center justify-center gap-1.5 px-2 py-1 rounded text-[10px] text-[#8b949e] border border-[#30363d] hover:border-[#58a6ff]/50 hover:text-accent transition-colors disabled:opacity-40"
                >
                  {reindexingRepo === repo.repo ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <RefreshCw size={10} />
                  )}
                  Sync
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary bar */}
      {repos.length > 0 && (
        <div className="mt-3 flex gap-4 text-xs text-[#484f58]">
          <span className="flex items-center gap-1.5">
            <Layers size={11} />
            {repos.reduce((a, r) => a + r.cardCount, 0)} total cards
          </span>
          <span className="flex items-center gap-1.5">
            <FileText size={11} />
            {repos.reduce((a, r) => a + r.indexedFiles, 0)} files indexed
          </span>
          <span className={cn(
            "flex items-center gap-1.5",
            repos.some((r) => r.staleCards > 0) ? "text-warning" : "text-success",
          )}>
            {repos.some((r) => r.staleCards > 0) ? (
              <>
                <AlertTriangle size={11} />
                {repos.reduce((a, r) => a + r.staleCards, 0)} stale cards across repos
              </>
            ) : (
              <>
                <CheckCircle2 size={11} />
                All cards fresh
              </>
            )}
          </span>
        </div>
      )}

      {/* Repo detail drawer */}
      {selected && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setSelected(null)}
          />
          <RepoDrawer
            repo={selected}
            onClose={() => setSelected(null)}
            onReindex={handleReindex}
            reindexing={reindexingRepo === selected.repo}
          />
        </>
      )}

      {/* "View in Knowledge Base" link from drawer */}
      {selected && (
        <div className="fixed bottom-6 right-[460px] z-50">
          <a
            href={`/knowledge?repo=${encodeURIComponent(selected.repo)}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1c2333] border border-[#30363d] text-xs text-accent hover:bg-[#30363d] transition-colors"
          >
            View cards <ChevronRight size={12} />
          </a>
        </div>
      )}
    </div>
  );
}
