import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Zap,
  Timer,
  Target,
  TrendingDown,
  ArrowLeft,
  ExternalLink,
  Database,
  Loader2,
  AlertCircle,
  Key,
  Shield,
  Search,
  MessageSquare,
  MessageCircle,
  FileCode,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  GitBranch,
  CheckCircle2,
  Circle,
  Plus,
  Send,
  X,
  Github,
} from "lucide-react";
import {
  api,
  type BenchmarkResponse,
  type BenchmarkProject,
  type BenchmarkProvider,
  type BenchmarkStage,
  type SandboxCard,
  type SandboxResponse,
  type CatalogEntry,
  type CatalogPrompt,
} from "@/lib/api";
import { cn, formatTokens } from "@/lib/utils";
import { SiteNav } from "@/components/shared/SiteNav";
import { PrismLogo } from "@/components/shared/PrismLogo";

const GITHUB_URL = "https://github.com/dan1d/codeprism";
const DISCORD_URL = "https://discord.gg/nsWERSde";

function slugify(repo: string): string {
  return repo.replace(/\//g, "-");
}

function fmtLatency(ms: number): string {
  if (ms === 0) return "<1";
  if (ms < 1) return "<1";
  return String(Math.round(ms));
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon
          className={cn("h-4 w-4", accent ? "text-accent" : "text-[#8b949e]")}
        />
        <span className="text-xs text-[#8b949e] uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p
        className={cn(
          "text-2xl font-bold",
          accent ? "text-accent" : "text-[#e1e4e8]"
        )}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-[#8b949e] mt-1">{sub}</p>}
    </div>
  );
}

function TokenBar({
  label,
  codeprism,
  naive,
  maxNaive,
}: {
  label: string;
  codeprism: number;
  naive: number;
  maxNaive: number;
}) {
  const naivePct = Math.min((naive / maxNaive) * 100, 100);
  const codeprismPct = Math.min((codeprism / maxNaive) * 100, 100);
  const reduction = naive > 0 ? Math.round((1 - codeprism / naive) * 100) : 0;

  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[#e1e4e8] truncate max-w-[60%]">
          {label}
        </span>
        <span className="text-xs font-mono text-[#3fb950]">
          -{reduction}%
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#8b949e] w-14 text-right">
            naive
          </span>
          <div className="flex-1 h-3 bg-[#21262d] rounded-sm overflow-hidden">
            <div
              className="h-full bg-[#f85149]/60 rounded-sm"
              style={{ width: `${naivePct}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-[#8b949e] w-12 text-right">
            {formatTokens(naive)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#8b949e] w-14 text-right">
            codeprism
          </span>
          <div className="flex-1 h-3 bg-[#21262d] rounded-sm overflow-hidden">
            <div
              className="h-full bg-[#3fb950]/70 rounded-sm"
              style={{ width: `${codeprismPct}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-[#8b949e] w-12 text-right">
            {formatTokens(codeprism)}
          </span>
        </div>
      </div>
    </div>
  );
}

function SandboxCardView({ card }: { card: SandboxCard }) {
  const [expanded, setExpanded] = useState(false);
  const preview = card.content.split("\n").slice(0, 6).join("\n");
  const hasMore = card.content.split("\n").length > 6;

  return (
    <div className="rounded border border-[#21262d] bg-[#0d1117] p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h5 className="text-sm font-medium text-[#e1e4e8]">{card.title}</h5>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">
              {card.flow}
            </span>
            <span className="text-[10px] text-[#484f58]">{card.cardType}</span>
          </div>
        </div>
      </div>
      <pre className="mt-2 text-xs text-[#8b949e] whitespace-pre-wrap font-mono leading-relaxed overflow-hidden">
        {expanded ? card.content : preview}
      </pre>
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] text-accent hover:text-[#79b8ff] flex items-center gap-0.5"
        >
          {expanded ? <><ChevronUp className="h-3 w-3" /> Show less</> : <><ChevronDown className="h-3 w-3" /> Show more</>}
        </button>
      )}
      {card.sourceFiles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.sourceFiles.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-0.5 text-[10px] text-[#8b949e] bg-[#161b22] px-1.5 py-0.5 rounded border border-[#21262d]"
            >
              <FileCode className="h-2.5 w-2.5" />
              {f.split("/").slice(-2).join("/")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ContextPreview({ result }: { result: SandboxResponse }) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="space-y-4">
      {/* Metrics bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded bg-[#161b22] border border-[#21262d] p-3 text-center">
          <p className="text-lg font-bold text-[#3fb950]">
            {result.tokenReduction > 0 ? `-${result.tokenReduction}%` : "—"}
          </p>
          <p className="text-[10px] text-[#8b949e]">tokens saved</p>
        </div>
        <div className="rounded bg-[#161b22] border border-[#21262d] p-3 text-center">
          <p className="text-lg font-bold text-accent">{result.codeprismTokens.toLocaleString()}</p>
          <p className="text-[10px] text-[#8b949e]">codeprism context tokens</p>
        </div>
        <div className="rounded bg-[#161b22] border border-[#21262d] p-3 text-center">
          <p className="text-lg font-bold text-[#f85149]">{result.naiveTokens.toLocaleString()}</p>
          <p className="text-[10px] text-[#8b949e]">naive read ({result.naiveFiles} files)</p>
        </div>
        <div className="rounded bg-[#161b22] border border-[#21262d] p-3 text-center">
          <p className="text-lg font-bold text-[#e1e4e8]">{result.latencyMs}ms</p>
          <p className="text-[10px] text-[#8b949e]">
            latency{result.cacheHit ? " (cached)" : ""}
          </p>
        </div>
      </div>

      {/* Without codeprism vs With codeprism comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Without codeprism */}
        <div className="rounded border border-[#f85149]/30 bg-[#f85149]/5 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="h-2 w-2 rounded-full bg-[#f85149]" />
            <h5 className="text-xs font-medium text-[#f85149] uppercase tracking-wide">
              Without codeprism
            </h5>
          </div>
          <p className="text-xs text-[#8b949e] mb-2">
            Your AI tool reads <span className="text-[#e1e4e8] font-mono">{result.naiveFiles}</span> source files
            every time, consuming ~<span className="text-[#e1e4e8] font-mono">{result.naiveTokens.toLocaleString()}</span> tokens.
          </p>
          <div className="flex flex-wrap gap-1">
            {result.cards.flatMap((c) => c.sourceFiles).slice(0, 12).map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-0.5 text-[10px] text-[#8b949e] bg-[#0d1117] px-1.5 py-0.5 rounded border border-[#21262d]"
              >
                <FileCode className="h-2.5 w-2.5 text-[#f85149]/60" />
                {f.split("/").slice(-2).join("/")}
              </span>
            ))}
            {result.naiveFiles > 12 && (
              <span className="text-[10px] text-[#484f58] px-1.5 py-0.5">
                +{result.naiveFiles - 12} more files
              </span>
            )}
          </div>
        </div>

        {/* With codeprism */}
        <div className="rounded border border-[#3fb950]/30 bg-[#3fb950]/5 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="h-2 w-2 rounded-full bg-[#3fb950]" />
            <h5 className="text-xs font-medium text-[#3fb950] uppercase tracking-wide">
              With codeprism
            </h5>
          </div>
          <p className="text-xs text-[#8b949e] mb-2">
            codeprism injects <span className="text-[#e1e4e8] font-mono">{result.cards.length}</span> pre-digested knowledge cards,
            only ~<span className="text-[#e1e4e8] font-mono">{result.codeprismTokens.toLocaleString()}</span> tokens. No file reads needed.
          </p>
          <div className="flex flex-wrap gap-1">
            {result.cards.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-0.5 text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20"
              >
                {c.title.length > 30 ? c.title.slice(0, 28) + "…" : c.title}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Formatted context (what actually gets attached) */}
      <div className="rounded border border-[#30363d] bg-[#0d1117]">
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="w-full flex items-center justify-between px-4 py-3 text-xs text-[#8b949e] hover:text-[#e1e4e8] transition-colors"
        >
          <span className="flex items-center gap-1.5 font-medium uppercase tracking-wide">
            <FileCode className="h-3.5 w-3.5" />
            What gets injected into AI context
          </span>
          <span className="flex items-center gap-1">
            <span className="font-mono text-[10px]">~{result.codeprismTokens} tokens</span>
            {showRaw ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        </button>
        {showRaw && (
          <div className="border-t border-[#21262d] px-4 py-3">
            <pre className="text-xs text-[#8b949e] whitespace-pre-wrap font-mono leading-relaxed max-h-[400px] overflow-y-auto">
              {result.formattedContext}
            </pre>
          </div>
        )}
      </div>

      {/* Individual cards */}
      <div>
        <h5 className="text-xs font-medium text-[#8b949e] uppercase tracking-wide mb-2">
          Cards returned ({result.cards.length})
        </h5>
        <div className="space-y-2">
          {result.cards.map((card) => (
            <SandboxCardView key={card.id} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SandboxPanel({ project }: { project: BenchmarkProject }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SandboxResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairEnabled, setRepairEnabled] = useState(false);
  const [repairProvider, setRepairProvider] = useState<BenchmarkProvider>("anthropic");
  const [repairModel, setRepairModel] = useState<string>(PROVIDER_MODELS.anthropic[2]?.id ?? "claude-haiku-3-5");
  const [repairApiKey, setRepairApiKey] = useState("");

  const exampleQueries = [
    ...project.cases.slice(0, 2).map((c) => c.query),
    `What is the architecture of ${project.name}?`,
    `How does ${project.name} work?`,
  ];

  const [sandboxError, setSandboxError] = useState<string | null>(null);

  const runQuery = async (q: string) => {
    setActiveQuery(q);
    setQuery(q);
    setSearching(true);
    setResult(null);
    setSandboxError(null);
    try {
      const res = await api.sandboxQuery(
        q,
        project.repo,
        project.llmLabel,
        repairEnabled
          ? {
              enabled: true,
              provider: repairProvider,
              model: repairModel,
              apiKey: repairApiKey.trim() || undefined,
            }
          : undefined,
      );
      setResult(res);
    } catch (err) {
      setSandboxError(err instanceof Error ? err.message : "Search failed");
    }
    setSearching(false);
  };

  return (
    <div className="border-t border-[#21262d] p-5">
      <h4 className="text-xs font-medium text-[#8b949e] uppercase tracking-wide mb-3 flex items-center gap-1.5">
        <MessageSquare className="h-3.5 w-3.5" />
        Try it — Sandbox
      </h4>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {exampleQueries.map((eq, i) => (
          <button
            key={i}
            onClick={() => runQuery(eq)}
            disabled={searching}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              activeQuery === eq
                ? "border-accent text-accent bg-accent/10"
                : "border-[#30363d] text-[#8b949e] hover:text-[#e1e4e8] hover:border-[#484f58]"
            )}
          >
            {eq.length > 50 ? eq.slice(0, 47) + "…" : eq}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#484f58]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) runQuery(query.trim()); }}
            placeholder={`Ask about ${project.name}…`}
            className="w-full rounded border border-[#30363d] bg-[#161b22] pl-9 pr-3 py-2 text-sm text-[#e1e4e8] placeholder-[#484f58] focus:border-accent focus:outline-none"
          />
        </div>
        <button
          onClick={() => query.trim() && runQuery(query.trim())}
          disabled={searching || !query.trim()}
          className={cn(
            "rounded px-3 py-2 text-sm font-medium transition-colors",
            searching || !query.trim()
              ? "bg-[#21262d] text-[#484f58] cursor-not-allowed"
              : "bg-accent text-[#0d1117] hover:bg-[#79b8ff]"
          )}
        >
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </button>
      </div>

      {/* Query repair (miss-only) */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setRepairOpen((v) => !v)}
          className="text-xs text-[#8b949e] hover:text-[#e1e4e8] transition-colors inline-flex items-center gap-1"
        >
          {repairOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Query repair (optional)
        </button>
        {repairOpen && (
          <div className="mt-2 rounded-md border border-[#21262d] bg-[#0b0f14] p-3">
            <label className="flex items-center gap-2 text-xs text-[#8b949e]">
              <input
                type="checkbox"
                checked={repairEnabled}
                onChange={(e) => setRepairEnabled(e.target.checked)}
                className="accent-[#58a6ff]"
              />
              Enable LLM repair on misses (uses your key; not stored)
            </label>

            {repairEnabled && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  value={repairProvider}
                  onChange={(e) => {
                    const p = e.target.value as BenchmarkProvider;
                    setRepairProvider(p);
                    setRepairModel(PROVIDER_MODELS[p][0]?.id ?? "");
                  }}
                  className="rounded border border-[#30363d] bg-[#161b22] px-3 py-2 text-xs text-[#e1e4e8] focus:border-accent focus:outline-none"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>

                <select
                  value={repairModel}
                  onChange={(e) => setRepairModel(e.target.value)}
                  className="rounded border border-[#30363d] bg-[#161b22] px-3 py-2 text-xs text-[#e1e4e8] focus:border-accent focus:outline-none"
                >
                  {(PROVIDER_MODELS[repairProvider] ?? []).map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>

                <input
                  type="password"
                  value={repairApiKey}
                  onChange={(e) => setRepairApiKey(e.target.value)}
                  placeholder="API key (never stored)"
                  className="rounded border border-[#30363d] bg-[#161b22] px-3 py-2 text-xs text-[#e1e4e8] placeholder-[#484f58] focus:border-accent focus:outline-none"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {searching && (
        <div className="flex items-center gap-2 mt-4 text-sm text-[#8b949e]">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          Searching knowledge cards…
        </div>
      )}

      {sandboxError && !searching && (
        <div className="mt-4 flex items-start gap-2 text-sm text-[#f85149]">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{sandboxError}</span>
        </div>
      )}

      {result && !searching && (
        <div className="mt-4">
          {result.diagnostics && (
            <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
              <span className={cn(
                "rounded-full border px-2 py-0.5 font-mono",
                result.diagnostics.fts_matched ? "border-[#3fb950]/30 text-[#3fb950] bg-[#3fb950]/10" : "border-[#30363d] text-[#8b949e] bg-[#0d1117]"
              )}>
                {result.diagnostics.fts_matched ? "FTS hit" : "FTS miss"}
              </span>
              {result.diagnostics.fallback_used === "llm_repair" && (
                <span className="rounded-full border border-accent/30 text-accent bg-accent/10 px-2 py-0.5 font-mono">
                  LLM repair used{result.diagnostics.llm_repair_cache_hit ? " (cache)" : ""}
                </span>
              )}
              {result.diagnostics.fallback_used === "recent_cards" && (
                <span className="rounded-full border border-[#d29922]/30 text-[#d29922] bg-[#d29922]/10 px-2 py-0.5 font-mono">
                  fallback: recent cards
                </span>
              )}
              {result.diagnostics.llm_repair_attempted && result.diagnostics.llm_repair_latency_ms != null && (
                <span className="rounded-full border border-[#30363d] text-[#8b949e] bg-[#0d1117] px-2 py-0.5 font-mono">
                  repair {result.diagnostics.llm_repair_latency_ms}ms · {result.diagnostics.llm_repair_probes ?? 0} probes
                </span>
              )}
            </div>
          )}
          {result.cards.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-[#8b949e]">
                No cards found for <span className="text-[#e1e4e8] font-mono">{project.repo}</span>.
              </p>
              <p className="text-xs text-[#484f58] mt-1">
                This project needs to be live-indexed first. Use the "Benchmark a project" form above to index it with codeprism.
              </p>
            </div>
          ) : (
            <ContextPreview result={result} />
          )}
        </div>
      )}
    </div>
  );
}

function ProjectSection({ project }: { project: BenchmarkProject }) {
  const s = project.stats;
  const maxNaive = Math.max(...project.cases.map((c) => c.naive_tokens));
  const [openRow, setOpenRow] = useState<number | null>(null);

  const fmtMaybePct = (v: number, applicable: boolean | undefined) =>
    applicable === false ? "—" : `${Math.round(v * 100)}%`;

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#21262d] flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              to={`/benchmarks/${slugify(project.repo)}`}
              className="text-base font-semibold text-[#e1e4e8] hover:text-accent transition-colors"
            >
              {project.name}
            </Link>
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full border",
              project.llmEnhanced
                ? "text-[#d2a8ff] border-[#d2a8ff]/30 bg-[#d2a8ff]/10"
                : "text-[#8b949e] border-[#30363d] bg-[#21262d]"
            )}>
              {project.llmEnhanced ? "LLM enhanced" : "Structural only"}
            </span>
          </div>
          <p className="text-xs text-[#8b949e] mt-0.5">
            {project.language === project.framework ? project.language : `${project.language} / ${project.framework}`} —{" "}
            <a
              href={`https://github.com/${project.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline inline-flex items-center gap-0.5"
            >
              {project.repo}
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-lg font-bold text-[#3fb950]">
              {s.token_reduction_pct}%
            </p>
            <p className="text-[10px] text-[#8b949e]">token reduction</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-[#e1e4e8]">{fmtLatency(s.avg_latency_ms)}ms</p>
            <p className="text-[10px] text-[#8b949e]">avg latency</p>
          </div>
        </div>
      </div>

      {(project.cardCount === 0 && !project.llmEnhanced) && (
        <div className="px-5 py-3 border-b border-[#21262d] bg-[#161b22] flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-[#d29922] mt-0.5 shrink-0" />
          <p className="text-xs text-[#8b949e]">
            No knowledge cards were generated for this project in structural-only mode.
            Provide an LLM API key to re-benchmark with richer, AI-generated cards and meaningful metrics.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 divide-x divide-[#21262d]">
        {/* Token savings chart */}
        <div className="p-5">
          <h4 className="text-xs font-medium text-[#8b949e] uppercase tracking-wide mb-3">
            Token savings per query
          </h4>
          <div className="space-y-1">
            {project.cases.map((c, i) => (
              <TokenBar
                key={i}
                label={c.query}
                codeprism={c.codeprism_tokens}
                naive={c.naive_tokens}
                maxNaive={maxNaive}
              />
            ))}
          </div>
        </div>

        {/* Accuracy table */}
        <div className="p-5">
          <h4 className="text-xs font-medium text-[#8b949e] uppercase tracking-wide mb-3">
            Search accuracy
          </h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#8b949e] border-b border-[#21262d]">
                <th className="text-left py-1.5 font-medium">Query</th>
                <th className="text-right py-1.5 font-medium w-10">Dbg</th>
                <th className="text-right py-1.5 font-medium w-16">Flow</th>
                <th className="text-right py-1.5 font-medium w-16">File</th>
                <th className="text-right py-1.5 font-medium w-16">P@K</th>
                {project.cases.some((c) => c.quality_score !== undefined) && (
                  <th className="text-right py-1.5 font-medium w-16">Quality</th>
                )}
                <th className="text-right py-1.5 font-medium w-14">ms</th>
              </tr>
            </thead>
            <tbody>
              {project.cases.map((c, i) => (
                <>
                  <tr key={i} className="border-b border-[#21262d]/50">
                    <td className="py-1.5 text-[#e1e4e8] truncate max-w-[180px]" title={c.query}>
                      {c.query.split(" ").slice(0, 5).join(" ")}…
                    </td>
                    <td className="text-right py-1.5">
                      <button
                        type="button"
                        onClick={() => setOpenRow((prev) => (prev === i ? null : i))}
                        className={cn(
                          "font-mono text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                          openRow === i
                            ? "border-accent text-accent bg-accent/10"
                            : "border-[#30363d] text-[#8b949e] hover:text-[#e1e4e8] hover:border-[#484f58]"
                        )}
                        title="Show debug details for this query"
                      >
                        dbg
                      </button>
                    </td>
                  <td className="text-right py-1.5">
                    <span
                      className={cn(
                        "font-mono",
                        c.diagnostics?.flow_applicable === false
                          ? "text-[#484f58]"
                          : c.flow_hit_rate >= 0.8
                          ? "text-[#3fb950]"
                          : c.flow_hit_rate >= 0.5
                            ? "text-[#d29922]"
                            : "text-[#f85149]"
                      )}
                    >
                      {fmtMaybePct(c.flow_hit_rate, c.diagnostics?.flow_applicable)}
                    </span>
                  </td>
                  <td className="text-right py-1.5">
                    <span
                      className={cn(
                        "font-mono",
                        c.diagnostics?.file_applicable === false
                          ? "text-[#484f58]"
                          : c.file_hit_rate >= 0.8
                          ? "text-[#3fb950]"
                          : c.file_hit_rate >= 0.5
                            ? "text-[#d29922]"
                            : "text-[#f85149]"
                      )}
                    >
                      {fmtMaybePct(c.file_hit_rate, c.diagnostics?.file_applicable)}
                    </span>
                  </td>
                  <td className="text-right py-1.5 font-mono">
                    {c.diagnostics?.precision_applicable === false ? (
                      <span className="text-[#484f58]">—</span>
                    ) : (
                      <span className="text-[#e1e4e8]">{Math.round(c.precision_at_k * 100)}%</span>
                    )}
                  </td>
                  {project.cases.some((x) => x.quality_score !== undefined) && (
                    <td className="text-right py-1.5">
                      {c.quality_score !== undefined ? (
                        <span
                          className={cn(
                            "font-mono",
                            c.quality_score >= 70
                              ? "text-[#3fb950]"
                              : c.quality_score >= 40
                                ? "text-[#d29922]"
                                : "text-[#f85149]"
                          )}
                        >
                          {c.quality_score}
                        </span>
                      ) : (
                        <span className="text-[#484f58]">–</span>
                      )}
                    </td>
                  )}
                  <td className="text-right py-1.5 font-mono text-[#8b949e]">
                    {c.latency_ms}
                  </td>
                  </tr>

                  {openRow === i && (
                    <tr className="border-b border-[#21262d]/50">
                      <td colSpan={project.cases.some((x) => x.quality_score !== undefined) ? 7 : 6} className="py-2.5">
                        <div className="rounded-md border border-[#21262d] bg-[#0b0f14] px-3 py-2 text-[11px] text-[#8b949e] space-y-1">
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            <span><span className="text-[#484f58]">FTS:</span> {c.diagnostics?.fts_matched ? "matched" : c.diagnostics?.fts_attempted ? "miss" : "not attempted"}</span>
                            <span><span className="text-[#484f58]">fallback:</span> {c.diagnostics?.fallback_used ?? "—"}</span>
                            <span><span className="text-[#484f58]">retrieval:</span> {c.diagnostics?.retrieval_success ? "ok" : "none"}</span>
                            <span><span className="text-[#484f58]">cards:</span> {c.diagnostics?.returned_cards ?? c.result_count}</span>
                            <span><span className="text-[#484f58]">files:</span> {c.diagnostics?.returned_unique_files ?? "—"}</span>
                            <span><span className="text-[#484f58]">expected files:</span> {(c.diagnostics?.expected_files_scored ?? 0).toLocaleString()}/{(c.diagnostics?.expected_files_total ?? 0).toLocaleString()}</span>
                          </div>
                          {c.diagnostics?.fts_query && (
                            <div className="truncate">
                              <span className="text-[#484f58]">fts_query:</span> <span className="font-mono text-[#c9d1d9]">{c.diagnostics.fts_query}</span>
                            </div>
                          )}
                          {c.diagnostics?.error && (
                            <div className="text-[#f85149]">
                              <span className="text-[#f85149]/80">error:</span> {c.diagnostics.error}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>

          {/* Summary stats */}
          <div className={`mt-4 grid gap-2 ${s.avg_quality_score !== undefined ? "grid-cols-6" : "grid-cols-5"}`}>
            <div className="rounded bg-[#161b22] p-2 text-center">
              <p className="text-xs text-[#8b949e]">Flow Hit</p>
              <p className="text-sm font-bold text-[#e1e4e8]">
                {Math.round(s.flow_hit_rate * 100)}%
              </p>
            </div>
            <div className="rounded bg-[#161b22] p-2 text-center">
              <p className="text-xs text-[#8b949e]">File Hit</p>
              <p className="text-sm font-bold text-[#e1e4e8]">
                {Math.round(s.file_hit_rate * 100)}%
              </p>
            </div>
            <div className="rounded bg-[#161b22] p-2 text-center">
              <p className="text-xs text-[#8b949e]">P@5</p>
              <p className="text-sm font-bold text-[#e1e4e8]">
                {Math.round(s.precision_at_5 * 100)}%
              </p>
            </div>
            <div className="rounded bg-[#161b22] p-2 text-center">
              <p className="text-xs text-[#8b949e]">Retrieval</p>
              <p className="text-sm font-bold text-[#e1e4e8]">
                {Math.round((s.retrieval_success_rate ?? 0) * 100)}%
              </p>
            </div>
            <div className="rounded bg-[#161b22] p-2 text-center">
              <p className="text-xs text-[#8b949e]">Cards</p>
              <p className="text-sm font-bold text-[#e1e4e8]">
                {project.cardCount ?? "—"}
              </p>
            </div>
            {s.avg_quality_score !== undefined && (
              <div className="rounded bg-[#161b22] p-2 text-center">
                <p className="text-xs text-[#8b949e]">Quality</p>
                <p className="text-sm font-bold text-[#e1e4e8]">
                  {s.avg_quality_score}/100
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sandbox — only available for live-indexed projects */}
      {project.live ? (
        <SandboxPanel project={project} />
      ) : (
        <div className="mt-6 rounded-xl border border-[#30363d] bg-[#161b22] p-5">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-[#e1e4e8] mb-2">
            <MessageSquare className="w-4 h-4 text-[#8b949e]" />
            TRY IT — SANDBOX
          </h4>
          <p className="text-sm text-[#8b949e]">
            This project uses pre-generated benchmark data. Submit it via the form above to
            live-index it and unlock the interactive sandbox.
          </p>
        </div>
      )}
    </div>
  );
}

function LanguageBadge({ language }: { language: string }) {
  const colors: Record<string, string> = {
    Ruby: "text-red-400 bg-red-900/30 border-red-800/50",
    Python: "text-yellow-400 bg-yellow-900/30 border-yellow-800/50",
    Go: "text-cyan-400 bg-cyan-900/30 border-cyan-800/50",
    TypeScript: "text-blue-400 bg-blue-900/30 border-blue-800/50",
    JavaScript: "text-amber-400 bg-amber-900/30 border-amber-800/50",
    PHP: "text-purple-400 bg-purple-900/30 border-purple-800/50",
    Rust: "text-orange-400 bg-orange-900/30 border-orange-800/50",
    Java: "text-pink-400 bg-pink-900/30 border-pink-800/50",
  };
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
        colors[language] ?? "text-gray-400 bg-gray-800/30 border-gray-700/50"
      )}
    >
      {language}
    </span>
  );
}

// CatalogProject type is now CatalogEntry from api.ts (fetched from the server)

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="p-0.5 text-[#484f58] hover:text-[#e1e4e8] transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3 text-[#3fb950]" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

const CATALOG_PAGE_SIZE = 6;

// ── Per-card component with persistent prompt saving ──────────────────────────

const PROMPT_MAX = 500;
const SUPPORT_EMAIL_BENCHMARKS = "support@codeprism.dev";

function CatalogCard({
  project,
  onSelect,
  onPromptAdded,
}: {
  project: CatalogEntry;
  onSelect: (url: string) => void;
  onPromptAdded: (repo: string, prompt: CatalogPrompt) => void;
}) {
  const [showInput, setShowInput] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleAddPrompt = async () => {
    const trimmed = draft.trim();
    if (trimmed.length < 10 || trimmed.length > PROMPT_MAX) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.addCatalogPrompt(project.repo, trimmed);
      onPromptAdded(project.repo, {
        id: res.id,
        prompt: trimmed,
        isDefault: false,
        runCount: 0,
        createdAt: new Date().toISOString(),
      });
      setDraft("");
      setShowInput(false);
    } catch {
      setSaveError("Failed to save — try again");
    } finally {
      setSaving(false);
    }
  };

  const handleUsePrompt = (promptId: number, repoUrl: string) => {
    api.runCatalogPrompt(promptId).catch(() => {});
    onSelect(repoUrl);
  };

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#0d1117] p-5 hover:border-[#30363d] transition-colors flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <LanguageBadge language={project.language} />
          <span className="text-sm font-semibold text-[#e1e4e8]">{project.name}</span>
          {project.requiresKey && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#d29922]/10 border border-[#d29922]/30 text-[#d29922]">
              key needed
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <CopyButton text={`https://github.com/${project.repo}`} />
          <button
            onClick={() => onSelect(`https://github.com/${project.repo}`)}
            className="text-xs text-accent hover:text-[#79b8ff] transition-colors font-semibold px-2 py-0.5 rounded border border-accent/30 hover:border-accent/60 bg-accent/5"
          >
            Use →
          </button>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-[#8b949e] leading-relaxed mb-4">{project.description}</p>

      {/* Prompts — default + user-added */}
      <div className="space-y-2 flex-1">
        {project.prompts.map((p) => (
          <div key={p.id} className="flex items-start gap-2 group">
            <button
              onClick={() => handleUsePrompt(p.id, `https://github.com/${project.repo}`)}
              className="shrink-0 text-[10px] text-accent hover:text-[#79b8ff] border border-accent/30 hover:border-accent/60 rounded px-1.5 py-0.5 transition-colors"
              title="Use this prompt"
            >
              Use
            </button>
            <span className="text-xs text-[#8b949e] group-hover:text-[#c9d1d9] transition-colors leading-snug flex-1">
              {p.prompt}
            </span>
            <div className="flex items-center gap-1.5 shrink-0 self-start mt-0.5">
              {p.runCount > 0 && (
                <span className="text-[9px] text-[#484f58]" title="Times this prompt was run">
                  {p.runCount} run{p.runCount !== 1 ? "s" : ""}
                </span>
              )}
              {!p.isDefault && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#1f6feb]/20 border border-[#1f6feb]/30 text-[#58a6ff]">
                  new
                </span>
              )}
              <a
                href={`mailto:${SUPPORT_EMAIL_BENCHMARKS}?subject=Flag prompt ${p.id}&body=Prompt:%20${encodeURIComponent(p.prompt)}%0ARepo:%20${project.repo}`}
                className="text-[9px] text-[#30363d] hover:text-[#484f58] transition-colors"
                title="Flag as low quality"
              >
                flag
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Add-prompt section */}
      {showInput ? (
        <div className="mt-3 pt-3 border-t border-[#21262d]">
          <div className="flex gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, PROMPT_MAX))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddPrompt();
                if (e.key === "Escape") { setShowInput(false); setDraft(""); }
              }}
              placeholder="Ask something specific about this repo…"
              className="flex-1 text-xs bg-[#161b22] border border-[#30363d] rounded px-2 py-1.5 text-[#e1e4e8] placeholder-[#484f58] outline-none focus:border-accent"
            />
            <button
              onClick={handleAddPrompt}
              disabled={saving || draft.trim().length < 10}
              className="px-2 py-1.5 rounded bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors disabled:opacity-40"
              title="Save prompt"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={() => { setShowInput(false); setDraft(""); setSaveError(null); }}
              className="px-2 py-1.5 rounded border border-[#30363d] text-[#484f58] hover:text-[#8b949e] transition-colors"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center justify-between mt-1">
            <p className="text-[10px] text-[#484f58]">Saved for everyone · min 10 chars</p>
            <span className={cn("text-[10px]", draft.length > PROMPT_MAX * 0.9 ? "text-[#d29922]" : "text-[#484f58]")}>
              {draft.length}/{PROMPT_MAX}
            </span>
          </div>
          {saveError && <p className="text-[10px] text-[#f85149] mt-1">{saveError}</p>}
        </div>
      ) : (
        <button
          onClick={() => setShowInput(true)}
          className="mt-3 pt-3 border-t border-[#21262d] w-full text-left text-[10px] text-[#484f58] hover:text-[#8b949e] flex items-center gap-1 transition-colors"
        >
          <Plus className="h-3 w-3" /> Add your own question
        </button>
      )}
    </div>
  );
}

// ── Catalog container — fetches from API ──────────────────────────────────────

function ProjectCatalog({ onSelect }: { onSelect: (url: string) => void }) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    api
      .benchmarkCatalog()
      .then((res) => setCatalog(res.catalog))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const languages = [...new Set(catalog.map((p) => p.language))].sort();
  const filtered = filter ? catalog.filter((p) => p.language === filter) : catalog;
  const totalPages = Math.ceil(filtered.length / CATALOG_PAGE_SIZE);
  const clampedPage = Math.min(page, Math.max(0, totalPages - 1));
  const visible = filtered.slice(clampedPage * CATALOG_PAGE_SIZE, (clampedPage + 1) * CATALOG_PAGE_SIZE);

  const handleFilterChange = (lang: string | null) => {
    setFilter(lang);
    setPage(0);
  };

  const handlePromptAdded = (repo: string, newPrompt: CatalogPrompt) => {
    setCatalog((prev) =>
      prev.map((p) => (p.repo === repo ? { ...p, prompts: [...p.prompts, newPrompt] } : p))
    );
  };

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-[#e1e4e8] flex items-center gap-1.5">
          <GitBranch className="h-4 w-4 text-accent" />
          Understand how real projects work
        </h4>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => handleFilterChange(null)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              !filter
                ? "border-accent text-accent bg-accent/10"
                : "border-[#30363d] text-[#484f58] hover:text-[#8b949e]"
            )}
          >
            All
          </button>
          {languages.map((lang) => (
            <button
              key={lang}
              onClick={() => handleFilterChange(lang === filter ? null : lang)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                filter === lang
                  ? "border-accent text-accent bg-accent/10"
                  : "border-[#30363d] text-[#484f58] hover:text-[#8b949e]"
              )}
            >
              {lang}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-[#484f58]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading catalog…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((project) => (
              <CatalogCard
                key={project.repo}
                project={project}
                onSelect={onSelect}
                onPromptAdded={handlePromptAdded}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-5 pt-4 border-t border-[#21262d]">
              <p className="text-xs text-[#484f58]">
                {clampedPage * CATALOG_PAGE_SIZE + 1}–{Math.min((clampedPage + 1) * CATALOG_PAGE_SIZE, filtered.length)} of {filtered.length} projects
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={clampedPage === 0}
                  className="flex items-center gap-1 px-3 py-1.5 rounded border border-[#30363d] text-xs text-[#8b949e] hover:text-[#e1e4e8] hover:border-[#484f58] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Previous
                </button>
                <div className="flex gap-1">
                  {Array.from({ length: totalPages }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setPage(i)}
                      className={cn(
                        "w-7 h-7 rounded text-xs font-mono transition-colors",
                        i === clampedPage
                          ? "bg-accent text-black font-bold"
                          : "text-[#484f58] hover:text-[#e1e4e8] hover:bg-[#21262d]"
                      )}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={clampedPage >= totalPages - 1}
                  className="flex items-center gap-1 px-3 py-1.5 rounded border border-[#30363d] text-xs text-[#8b949e] hover:text-[#e1e4e8] hover:border-[#484f58] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const PROVIDERS: Array<{ id: BenchmarkProvider; label: string; hint: string; keyUrl: string }> = [
  { id: "gemini", label: "Google Gemini", hint: "Free tier available", keyUrl: "https://aistudio.google.com/app/apikey" },
  { id: "openai", label: "OpenAI", hint: "GPT-4o-mini or similar", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "deepseek", label: "DeepSeek", hint: "~$0.14/1M input tokens", keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "anthropic", label: "Anthropic", hint: "Claude models", keyUrl: "https://console.anthropic.com/settings/keys" },
];

const PROVIDER_MODELS: Record<BenchmarkProvider, Array<{ id: string; label: string }>> = {
  anthropic: [
    { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-haiku-3-5", label: "Claude Haiku 3.5" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "o3-mini", label: "o3-mini" },
  ],
  gemini: [
    { id: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash" },
    { id: "gemini-1.5-pro-latest", label: "Gemini 1.5 Pro" },
    { id: "gemini-1.5-flash-latest", label: "Gemini 1.5 Flash" },
  ],
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek V3" },
    { id: "deepseek-reasoner", label: "DeepSeek R1" },
  ],
};

const BENCHMARK_STAGES: Array<{ key: BenchmarkStage; label: string; description: string }> = [
  { key: "queued", label: "Queued", description: "Waiting in line" },
  { key: "cloning", label: "Cloning", description: "Downloading repository" },
  { key: "analyzing", label: "Analyzing", description: "Detecting language and structure" },
  { key: "indexing", label: "Indexing", description: "Building knowledge graph" },
  { key: "benchmarking", label: "Benchmarking", description: "Running search queries" },
  { key: "saving", label: "Saving", description: "Finalizing results" },
];

function StageIcon({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") return <CheckCircle2 className="h-4 w-4 text-[#3fb950]" />;
  if (state === "active") return <Loader2 className="h-4 w-4 text-accent animate-spin" />;
  return <Circle className="h-4 w-4 text-[#30363d]" />;
}

function BenchmarkStepper({ currentStage, indexProgress }: { currentStage: BenchmarkStage; indexProgress?: string }) {
  const currentIdx = BENCHMARK_STAGES.findIndex((s) => s.key === currentStage);
  return (
    <div className="space-y-2 py-2">
      {BENCHMARK_STAGES.map((stage, i) => {
        const state = i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
        const description = state === "active" && stage.key === "indexing" && indexProgress
          ? indexProgress
          : stage.description;
        return (
          <div key={stage.key} className="flex items-center gap-3">
            <StageIcon state={state} />
            <div className="flex-1">
              <span className={cn(
                "text-sm font-medium",
                state === "active" ? "text-[#e1e4e8]" : state === "done" ? "text-[#8b949e]" : "text-[#484f58]"
              )}>
                {stage.label}
              </span>
              <span className={cn(
                "text-xs ml-2",
                state === "active" ? "text-[#8b949e]" : "text-[#484f58]"
              )}>
                {description}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SubmitForm({ onSubmitted }: { onSubmitted: () => void }) {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState<BenchmarkProvider>("gemini");
  const [model, setModel] = useState<string>(PROVIDER_MODELS.gemini[0].id);
  const [apiKey, setApiKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresKey, setRequiresKey] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [currentStage, setCurrentStage] = useState<BenchmarkStage>("queued");
  const [indexProgress, setIndexProgress] = useState<string | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);
  const submittedRepoRef = useRef<string | null>(null);
  const submittedLlmLabelRef = useRef<string | null>(null);

  const busy = submitting || queuePosition !== null;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const q = await api.benchmarkQueue();
        const myRepo = submittedRepoRef.current;
        const myEntries = myRepo ? q.queue.filter((e) => e.repo === myRepo) : [];
        // Prefer the active (non-error) entry; fall back to most recent error
        const myJob = myEntries.find((e) => e.status !== "error") ?? myEntries[myEntries.length - 1] ?? null;
        const active = myJob ?? q.queue.find((e) => e.status === "running" || e.status === "pending");

        if (!active || active.status === "done") {
          stopPolling();
          setQueuePosition(null);
          busyRef.current = false;
          onSubmitted();
          if (myRepo) {
            const myLabel = submittedLlmLabelRef.current;
            submittedRepoRef.current = null;
            submittedLlmLabelRef.current = null;
            const resultSlug = myLabel ? `${slugify(myRepo)}-${myLabel}` : slugify(myRepo);
            navigate(`/benchmarks/${resultSlug}`);
          }
        } else if (active.status === "error") {
          stopPolling();
          setQueuePosition(null);
          setError(`Benchmark failed: ${active.error ?? "unknown error"}`);
          busyRef.current = false;
        } else {
          setQueuePosition(active.position);
          if (active.stage) setCurrentStage(active.stage);
          setIndexProgress(active.indexProgress);
        }
      } catch { /* ignore */ }
    }, 3000);
  }, [onSubmitted, stopPolling, navigate]);

  const handleSubmit = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setSubmitting(true);
    setCurrentStage("queued");
    try {
      const req: Parameters<typeof api.submitBenchmark>[0] = { url };
      let llmLabel: string | undefined;
      if (showKeyInput && apiKey.trim()) {
        req.provider = provider;
        req.apiKey = apiKey.trim();
        req.model = model;
        llmLabel = `${provider}-${model}`;
      }

      const res = await api.submitBenchmark(req);
      if (res.requiresKey) {
        setRequiresKey(true);
        setShowKeyInput(true);
        setError(`This repository has ~${res.fileEstimate?.toLocaleString() ?? "2,000+"} files and requires an API key to benchmark.`);
        busyRef.current = false;
      } else if (res.queued) {
        const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
        submittedRepoRef.current = match?.[1]?.replace(/\.git$/, "") ?? null;
        submittedLlmLabelRef.current = llmLabel ?? null;
        setQueuePosition(res.position ?? 1);
        startPolling();
      } else if (res.error?.includes("already in the queue")) {
        const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
        submittedRepoRef.current = match?.[1]?.replace(/\.git$/, "") ?? null;
        submittedLlmLabelRef.current = llmLabel ?? null;
        setQueuePosition(1);
        startPolling();
      } else if (res.error?.includes("already been benchmarked")) {
        const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
        if (match) {
          const repoSlug = match[1].replace(/\.git$/, "");
          const resultSlug = llmLabel ? `${slugify(repoSlug)}-${llmLabel}` : slugify(repoSlug);
          navigate(`/benchmarks/${resultSlug}`);
        } else {
          setError(res.error);
        }
        busyRef.current = false;
      } else if (res.error) {
        setError(res.error);
        busyRef.current = false;
      }
    } catch (err) {
      let msg = "Submission failed";
      if (err instanceof Error) {
        const jsonMatch = err.message.match(/\d+:\s*(\{.*\})/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1]);
            msg = parsed.error ?? err.message;
          } catch { msg = err.message; }
        } else {
          msg = err.message;
        }
      }
      setError(msg);
      busyRef.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-6 mb-10">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-[#e1e4e8] uppercase tracking-wide">
          Benchmark a project
        </h3>
        <span className="text-xs text-[#484f58] border border-[#30363d] bg-[#0d1117] px-2 py-0.5 rounded font-mono">
          cap: 50 GB storage
        </span>
      </div>

      <p className="text-sm text-[#8b949e] mb-4">
        Results are shared with everyone. Bring your own API key to benchmark larger repos and get LLM-enhanced insights — no slot limits.
      </p>

      {queuePosition ? (
        <BenchmarkStepper currentStage={currentStage} indexProgress={indexProgress} />
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(null); setRequiresKey(false); }}
              placeholder="https://github.com/owner/repo"
              disabled={busy}
              className="flex-1 rounded border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e1e4e8] placeholder-[#484f58] focus:border-accent focus:outline-none disabled:opacity-50"
            />
            {!showKeyInput && (
              <button
                onClick={handleSubmit}
                disabled={busy || !url.trim()}
                className={cn(
                  "rounded px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2",
                  busy || !url.trim()
                    ? "bg-[#21262d] text-[#484f58] cursor-not-allowed"
                    : "bg-accent text-[#0d1117] hover:bg-[#79b8ff]"
                )}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? "Submitting…" : "Run Benchmark"}
              </button>
            )}
          </div>

          {/* Optional: provide your own key for richer results */}
          {!requiresKey && !showKeyInput && (
            <button
              onClick={() => setShowKeyInput(true)}
              className="text-xs text-[#8b949e] hover:text-accent transition-colors flex items-center gap-1"
            >
              <Key className="h-3 w-3" />
              Use my API key for LLM-enhanced results (optional)
            </button>
          )}

          {showKeyInput && (
            <div className="mt-3 rounded border border-[#30363d] bg-[#0d1117] p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Shield className="h-4 w-4 text-[#3fb950] mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs text-[#8b949e]">
                    Your API key is used only for this benchmark run — never stored, logged, or shared.
                    Bringing your key also unlocks larger repositories (no storage cap per run).
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={provider}
                  onChange={(e) => {
                    const p = e.target.value as BenchmarkProvider;
                    setProvider(p);
                    setModel(PROVIDER_MODELS[p][0].id);
                  }}
                  disabled={busy}
                  className="rounded border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e1e4e8] focus:border-accent focus:outline-none disabled:opacity-50"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={busy}
                  className="rounded border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e1e4e8] focus:border-accent focus:outline-none disabled:opacity-50"
                >
                  {PROVIDER_MODELS[provider].map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your API key"
                disabled={busy}
                className="rounded border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e1e4e8] placeholder-[#484f58] focus:border-accent focus:outline-none disabled:opacity-50 w-full"
              />

              {/* API key creation links */}
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {PROVIDERS.map((p) => (
                  <a
                    key={p.id}
                    href={p.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "text-[10px] flex items-center gap-0.5 transition-colors",
                      provider === p.id
                        ? "text-accent hover:text-[#79b8ff]"
                        : "text-[#484f58] hover:text-[#8b949e]"
                    )}
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    Get {p.label} key
                  </a>
                ))}
              </div>

              <p className="text-[10px] text-[#484f58]">
                {PROVIDERS.find((p) => p.id === provider)?.hint} · Results tagged as <span className="font-mono">{provider}-{model}</span>
              </p>

              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={busy || !url.trim() || (requiresKey && !apiKey.trim())}
                  className={cn(
                    "rounded px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2",
                    busy || !url.trim() || (requiresKey && !apiKey.trim())
                      ? "bg-[#21262d] text-[#484f58] cursor-not-allowed"
                      : "bg-accent text-[#0d1117] hover:bg-[#79b8ff]"
                  )}
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting ? "Submitting…" : "Run with my key"}
                </button>
                {!requiresKey && (
                  <button
                    onClick={() => { setShowKeyInput(false); setApiKey(""); }}
                    className="rounded px-3 py-2 text-sm text-[#8b949e] hover:text-[#e1e4e8] transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 flex items-start gap-2 text-sm text-[#f85149]">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <ProjectCatalog onSelect={(repoUrl) => { setUrl(repoUrl); setError(null); setRequiresKey(false); }} />
        </>
      )}
    </div>
  );
}

export function Benchmarks() {
  const [data, setData] = useState<BenchmarkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const PROJECTS_PER_PAGE = 10;

  const loadData = useCallback(() => {
    api.benchmarks().then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    loadData();
    setLoading(false);
  }, [loadData]);

  const bench = data?.benchmarks;
  const agg = bench?.aggregate;

  const totalPages = bench ? Math.max(1, Math.ceil(bench.projects.length / PROJECTS_PER_PAGE)) : 1;
  const clampedPage = Math.min(page, totalPages - 1);

  return (
    <div className="min-h-screen bg-background">
      <SiteNav variant="page" />

      {/* Page header — pushed below the fixed nav */}
      <header
        className="border-b border-[#30363d] px-6 pt-28 pb-12"
        style={{
          background: "linear-gradient(180deg, #0f1117 0%, #161b22 100%)",
        }}
      >
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-bold text-[#e1e4e8]">Benchmarks</h1>
          <p className="mt-2 text-[#8b949e] max-w-2xl">
            How codeprism performs across real-world open-source projects.
            {agg && (
              <>
                {" "}
                Tested on {agg.total_projects} projects, {agg.total_queries}{" "}
                queries.
              </>
            )}
          </p>
          {bench && (
            <div className="mt-3 flex items-center gap-2">
              {bench.projects.map((p) => (
                <LanguageBadge key={p.name} language={p.language} />
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <SubmitForm onSubmitted={loadData} />

        {loading ? (
          <p className="text-center text-[#8b949e] py-20">
            Loading benchmarks…
          </p>
        ) : !bench ? (
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-12 text-center">
            <Database className="h-10 w-10 text-[#30363d] mx-auto mb-4" />
            <h3 className="text-base font-semibold text-[#e1e4e8] mb-2">No benchmarks yet</h3>
            <p className="text-sm text-[#8b949e] max-w-sm mx-auto">
              Submit a GitHub repository above to run the first benchmark. Results are shared with everyone.
            </p>
          </div>
        ) : (
          <>
            {/* Hero stat cards */}
            {agg && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                <StatCard
                  label="Token Reduction"
                  value={`${agg.avg_token_reduction_pct}%`}
                  sub={`across ${agg.total_projects} projects`}
                  icon={TrendingDown}
                  accent
                />
                <StatCard
                  label="Avg Latency"
                  value={`${fmtLatency(agg.avg_latency_ms)}ms`}
                  sub="search + rerank"
                  icon={Timer}
                />
                <StatCard
                  label="Flow Accuracy"
                  value={`${Math.round(agg.avg_flow_hit_rate * 100)}%`}
                  sub="correct flow detection"
                  icon={Target}
                />
                <StatCard
                  label="Queries Tested"
                  value={`${agg.total_queries}`}
                  sub="across all projects"
                  icon={Zap}
                />
              </div>
            )}

            {/* Latency comparison across projects (paginated) */}
            {bench.projects.length === 0 ? (
              <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-10 mb-10 text-center">
                <Database className="h-8 w-8 text-[#30363d] mx-auto mb-3" />
                <p className="text-sm text-[#8b949e]">
                  No projects benchmarked yet. Submit a GitHub repository above to get started.
                </p>
              </div>
            ) : null}
            {bench.projects.length > 0 && (() => {
              const pages = Math.ceil(bench.projects.length / PROJECTS_PER_PAGE);
              const visibleProjects = bench.projects.slice(
                clampedPage * PROJECTS_PER_PAGE,
                (clampedPage + 1) * PROJECTS_PER_PAGE,
              );

              return (
                <>
                  <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5 mb-10">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-medium text-[#8b949e] uppercase tracking-wide">
                        Performance across projects
                      </h3>
                      {pages > 1 && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={clampedPage === 0}
                            className="p-1 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-[#e1e4e8] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <span className="text-xs text-[#8b949e] font-mono">
                            {clampedPage + 1}/{pages}
                          </span>
                          <button
                            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                            disabled={clampedPage >= pages - 1}
                            className="p-1 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-[#e1e4e8] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                      {visibleProjects.map((p) => {
                        const resultSlug = p.llmLabel
                          ? `${slugify(p.repo)}-${p.llmLabel}`
                          : slugify(p.repo);
                        return (
                        <Link
                          key={`${p.repo}-${p.llmLabel ?? "structural"}`}
                          to={`/benchmarks/${resultSlug}`}
                          className="rounded bg-[#0d1117] border border-[#21262d] p-3 text-left hover:border-accent/50 hover:bg-[#0d1117]/80 transition-colors group block"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <LanguageBadge language={p.language} />
                            <span className="text-xs font-medium text-[#e1e4e8] group-hover:text-accent transition-colors">
                              {p.name}
                            </span>
                            <span className={cn(
                              "ml-auto text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap",
                              p.llmLabel
                                ? "text-[#d2a8ff] border-[#d2a8ff]/30 bg-[#d2a8ff]/10"
                                : "text-[#8b949e] border-[#30363d] bg-[#21262d]"
                            )}>
                              {p.llmLabel ?? "Structural"}
                            </span>
                          </div>
                          <div className="space-y-1.5 text-xs">
                            {p.cardCount === 0 && !p.llmEnhanced ? (
                              <p className="text-[#d29922] text-[10px] py-2">
                                No cards in structural mode. Re-run with an LLM key for full metrics.
                              </p>
                            ) : (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-[#8b949e]">Tokens saved</span>
                                  <span className="font-mono text-[#3fb950]">
                                    {p.stats.token_reduction_pct}%
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-[#8b949e]">P50 / P95</span>
                                  <span className="font-mono text-[#e1e4e8]">
                                    {fmtLatency(p.stats.p50_latency_ms)} / {fmtLatency(p.stats.p95_latency_ms)}ms
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-[#8b949e]">Accuracy</span>
                                  <span className="font-mono text-[#e1e4e8]">
                                    {Math.round(p.stats.flow_hit_rate * 100)}%
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        </Link>
                        );
                      })}
                    </div>
                  </div>

                  {/* Per-project sections (same page) */}
                  <div className="space-y-8">
                    {visibleProjects.map((p) => (
                      <div key={p.name} id={`project-${p.repo.replace(/\//g, "-")}`}>
                        <ProjectSection project={p} />
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}

            {/* Methodology */}
            <div className="mt-10 rounded-lg border border-[#21262d] bg-[#0d1117] p-5">
              <h3 className="text-sm font-medium text-[#8b949e] uppercase tracking-wide mb-3 flex items-center gap-2">
                <Database className="h-4 w-4" />
                Methodology
              </h3>
              <ul className="space-y-2 text-sm text-[#8b949e]">
                <li className="flex items-start gap-2">
                  <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#30363d]" />
                  <strong className="text-[#e1e4e8]">Token reduction</strong>:
                  codeprism card tokens vs. naive tokens from reading referenced
                  source files (estimated as ~4 chars/token), using the repository
                  checkout from the benchmark run
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#30363d]" />
                  <strong className="text-[#e1e4e8]">Flow hit rate</strong>:
                  fraction of expected architectural flows found in search
                  results
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#30363d]" />
                  <strong className="text-[#e1e4e8]">File hit rate</strong>:
                  fraction of expected source file fragments found across all
                  result cards
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#30363d]" />
                  <strong className="text-[#e1e4e8]">Precision@K</strong>:
                  fraction of top-K results that match an expected flow
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#30363d]" />
                  <strong className="text-[#e1e4e8]">Latency</strong>:
                  end-to-end search time including hybrid FTS + vector search and
                  cross-encoder reranking
                </li>
              </ul>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-[#30363d] px-6 py-8 mt-10">
        <div className="mx-auto max-w-6xl flex flex-col items-center gap-4">
          <Link to="/">
            <PrismLogo
              wordmark
              className="h-6 w-6"
              wordmarkClassName="text-sm text-[#8b949e]"
            />
          </Link>
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-[#484f58]">
            <Link to="/" className="flex items-center gap-1 hover:text-[#8b949e] transition-colors">
              Home
            </Link>
            <span>·</span>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-[#8b949e] transition-colors">
              <Github className="h-3.5 w-3.5" /> GitHub
            </a>
            <span>·</span>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-[#8b949e] transition-colors">
              <MessageCircle className="h-3.5 w-3.5" /> Discord
            </a>
            <span>·</span>
            <Link to="/onboard" className="hover:text-[#8b949e] transition-colors">
              Get Started
            </Link>
          </div>
          <p className="text-xs text-[#484f58]">© {new Date().getFullYear()} codeprism · AGPL-3.0 open source</p>
        </div>
      </footer>
    </div>
  );
}

export function BenchmarkDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<BenchmarkProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    api.benchmarkDetail(slug)
      .then(setProject)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-accent animate-spin" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <AlertCircle className="h-10 w-10 text-[#f85149] mx-auto mb-4" />
          <h1 className="text-xl font-bold text-[#e1e4e8] mb-2">Project not found</h1>
          <p className="text-sm text-[#8b949e] mb-6">{error ?? "This project hasn't been benchmarked yet."}</p>
          <Link to="/benchmarks" className="text-sm text-accent hover:text-[#79b8ff] transition-colors">
            Back to benchmarks
          </Link>
        </div>
      </div>
    );
  }

  const s = project.stats;

  return (
    <div className="min-h-screen bg-background">
      <header
        className="border-b border-[#30363d] px-6 py-10"
        style={{ background: "linear-gradient(180deg, #0f1117 0%, #161b22 100%)" }}
      >
        <div className="mx-auto max-w-6xl">
          <Link
            to="/benchmarks"
            className="inline-flex items-center gap-1 text-sm text-[#8b949e] hover:text-accent transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" /> All benchmarks
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <LanguageBadge language={project.language} />
                <div className="flex items-center gap-2">
                  <PrismLogo className="h-5 w-5 text-accent" />
                  <h1 className="text-2xl font-bold text-[#e1e4e8]">{project.name}</h1>
                </div>
                <span className={cn(
                  "text-xs px-2 py-0.5 rounded-full border",
                  project.llmEnhanced
                    ? "text-[#d2a8ff] border-[#d2a8ff]/30 bg-[#d2a8ff]/10"
                    : "text-[#8b949e] border-[#30363d] bg-[#21262d]"
                )}>
                  {project.llmEnhanced ? "LLM enhanced" : "Structural only"}
                </span>
              </div>
              <p className="text-sm text-[#8b949e]">
                {project.language === project.framework ? project.language : `${project.language} / ${project.framework}`} —{" "}
                <a
                  href={`https://github.com/${project.repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline inline-flex items-center gap-0.5"
                >
                  {project.repo} <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-2xl font-bold text-[#3fb950]">{s.token_reduction_pct}%</p>
                <p className="text-xs text-[#8b949e]">token reduction</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-[#e1e4e8]">{fmtLatency(s.avg_latency_ms)}ms</p>
                <p className="text-xs text-[#8b949e]">avg latency</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        {(project.cardCount === 0 && !project.llmEnhanced) && (
          <div className="rounded-lg border border-[#d29922]/30 bg-[#d29922]/10 px-4 py-3 mb-6 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-[#d29922] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-[#d29922]">Limited results — structural only</p>
              <p className="text-xs text-[#8b949e] mt-1">
                No knowledge cards were generated for this project in structural-only mode.
                Re-benchmark with your own LLM API key to get AI-generated knowledge cards and meaningful accuracy metrics.
              </p>
            </div>
          </div>
        )}

        {/* Comparison hero cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 text-center">
            <TrendingDown className="h-5 w-5 text-[#3fb950] mx-auto mb-2" />
            <p className="text-xl font-bold text-[#3fb950]">{s.avg_tokens_with_codeprism}</p>
            <p className="text-xs text-[#8b949e] mt-0.5">codeprism tokens/query</p>
          </div>
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 text-center">
            <TrendingDown className="h-5 w-5 text-[#f85149] mx-auto mb-2" />
            <p className="text-xl font-bold text-[#f85149]">{formatTokens(s.avg_tokens_without)}</p>
            <p className="text-xs text-[#8b949e] mt-0.5">naive tokens/query</p>
          </div>
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 text-center">
            <Target className="h-5 w-5 text-[#e1e4e8] mx-auto mb-2" />
            <p className="text-xl font-bold text-[#e1e4e8]">{Math.round(s.flow_hit_rate * 100)}%</p>
            <p className="text-xs text-[#8b949e] mt-0.5">flow accuracy</p>
          </div>
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 text-center">
            <Timer className="h-5 w-5 text-[#e1e4e8] mx-auto mb-2" />
            <p className="text-xl font-bold text-[#e1e4e8]">{fmtLatency(s.p50_latency_ms)} / {fmtLatency(s.p95_latency_ms)}ms</p>
            <p className="text-xs text-[#8b949e] mt-0.5">P50 / P95 latency</p>
          </div>
        </div>

        {/* Full project section */}
        <ProjectSection project={project} />
      </div>

      <footer className="border-t border-[#30363d] px-6 py-8 mt-10">
        <div className="mx-auto max-w-6xl flex flex-col items-center gap-4">
          <Link to="/">
            <PrismLogo
              wordmark
              className="h-6 w-6"
              wordmarkClassName="text-sm text-[#8b949e]"
            />
          </Link>
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-[#484f58]">
            <Link to="/" className="flex items-center gap-1 hover:text-[#8b949e] transition-colors">
              Home
            </Link>
            <span>·</span>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-[#8b949e] transition-colors">
              <Github className="h-3.5 w-3.5" /> GitHub
            </a>
            <span>·</span>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-[#8b949e] transition-colors">
              <MessageCircle className="h-3.5 w-3.5" /> Discord
            </a>
            <span>·</span>
            <Link to="/onboard" className="hover:text-[#8b949e] transition-colors">
              Get Started
            </Link>
          </div>
          <p className="text-xs text-[#484f58]">© {new Date().getFullYear()} codeprism · AGPL-3.0 open source</p>
        </div>
      </footer>
    </div>
  );
}
