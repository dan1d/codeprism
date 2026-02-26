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
} from "lucide-react";
import {
  api,
  type BenchmarkResponse,
  type BenchmarkProject,
  type BenchmarkProvider,
  type BenchmarkQueueResponse,
  type BenchmarkStage,
  type SandboxCard,
  type SandboxResponse,
} from "@/lib/api";
import { cn, formatTokens } from "@/lib/utils";

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
  srcmap,
  naive,
  maxNaive,
}: {
  label: string;
  srcmap: number;
  naive: number;
  maxNaive: number;
}) {
  const naivePct = Math.min((naive / maxNaive) * 100, 100);
  const srcmapPct = Math.min((srcmap / maxNaive) * 100, 100);
  const reduction = naive > 0 ? Math.round((1 - srcmap / naive) * 100) : 0;

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
            srcmap
          </span>
          <div className="flex-1 h-3 bg-[#21262d] rounded-sm overflow-hidden">
            <div
              className="h-full bg-[#3fb950]/70 rounded-sm"
              style={{ width: `${srcmapPct}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-[#8b949e] w-12 text-right">
            {formatTokens(srcmap)}
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
          <p className="text-lg font-bold text-accent">{result.srcmapTokens.toLocaleString()}</p>
          <p className="text-[10px] text-[#8b949e]">srcmap context tokens</p>
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

      {/* Without srcmap vs With srcmap comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Without srcmap */}
        <div className="rounded border border-[#f85149]/30 bg-[#f85149]/5 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="h-2 w-2 rounded-full bg-[#f85149]" />
            <h5 className="text-xs font-medium text-[#f85149] uppercase tracking-wide">
              Without srcmap
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

        {/* With srcmap */}
        <div className="rounded border border-[#3fb950]/30 bg-[#3fb950]/5 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="h-2 w-2 rounded-full bg-[#3fb950]" />
            <h5 className="text-xs font-medium text-[#3fb950] uppercase tracking-wide">
              With srcmap
            </h5>
          </div>
          <p className="text-xs text-[#8b949e] mb-2">
            srcmap injects <span className="text-[#e1e4e8] font-mono">{result.cards.length}</span> pre-digested knowledge cards,
            only ~<span className="text-[#e1e4e8] font-mono">{result.srcmapTokens.toLocaleString()}</span> tokens. No file reads needed.
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
            <span className="font-mono text-[10px]">~{result.srcmapTokens} tokens</span>
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
      const res = await api.sandboxQuery(q, project.repo);
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
          {result.cards.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-[#8b949e]">
                No cards found for <span className="text-[#e1e4e8] font-mono">{project.repo}</span>.
              </p>
              <p className="text-xs text-[#484f58] mt-1">
                This project needs to be live-indexed first. Use the "Benchmark a project" form above to index it with srcmap.
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
                srcmap={c.srcmap_tokens}
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
                <tr key={i} className="border-b border-[#21262d]/50">
                  <td className="py-1.5 text-[#e1e4e8] truncate max-w-[180px]">
                    {c.query.split(" ").slice(0, 5).join(" ")}…
                  </td>
                  <td className="text-right py-1.5">
                    <span
                      className={cn(
                        "font-mono",
                        c.flow_hit_rate >= 0.8
                          ? "text-[#3fb950]"
                          : c.flow_hit_rate >= 0.5
                            ? "text-[#d29922]"
                            : "text-[#f85149]"
                      )}
                    >
                      {Math.round(c.flow_hit_rate * 100)}%
                    </span>
                  </td>
                  <td className="text-right py-1.5">
                    <span
                      className={cn(
                        "font-mono",
                        c.file_hit_rate >= 0.8
                          ? "text-[#3fb950]"
                          : c.file_hit_rate >= 0.5
                            ? "text-[#d29922]"
                            : "text-[#f85149]"
                      )}
                    >
                      {Math.round(c.file_hit_rate * 100)}%
                    </span>
                  </td>
                  <td className="text-right py-1.5 font-mono text-[#e1e4e8]">
                    {Math.round(c.precision_at_k * 100)}%
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
              ))}
            </tbody>
          </table>

          {/* Summary stats */}
          <div className={`mt-4 grid gap-2 ${s.avg_quality_score !== undefined ? "grid-cols-5" : "grid-cols-4"}`}>
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

interface CatalogProject {
  repo: string;
  name: string;
  language: string;
  description: string;
  prompts: string[];
  requiresKey?: boolean;
}

const CATALOG: CatalogProject[] = [
  // ── Free tier (< 2 000 files) ─────────────────────────────────────
  {
    repo: "caddyserver/caddy",
    name: "Caddy",
    language: "Go",
    description: "Web server with automatic HTTPS — used by millions",
    prompts: [
      "How does Caddy provision and renew TLS certificates automatically?",
      "How does the Caddyfile get parsed into a running server config?",
      "How does Caddy's reverse proxy handle load balancing and health checks?",
    ],
  },
  {
    repo: "huginn/huginn",
    name: "Huginn",
    language: "Ruby",
    description: "Build agents that monitor and act on your behalf — like IFTTT on your server",
    prompts: [
      "How does the agent event pipeline propagate data between agents?",
      "How does Huginn schedule and run agents in the background?",
      "How does a new agent type get registered and configured?",
    ],
  },
  {
    repo: "lobsters/lobsters",
    name: "Lobsters",
    language: "Ruby",
    description: "Community link aggregation site — like Hacker News, open source",
    prompts: [
      "How does the story voting and ranking algorithm work?",
      "How does the invitation tree and moderation system work?",
      "How are comment threads threaded and rendered?",
    ],
  },
  {
    repo: "excalidraw/excalidraw",
    name: "Excalidraw",
    language: "TypeScript",
    description: "Virtual collaborative whiteboard — 90k+ stars",
    prompts: [
      "How does real-time collaboration and conflict resolution work?",
      "How does the canvas rendering and element selection work?",
      "How does the undo/redo history system work?",
    ],
  },
  {
    repo: "basecamp/kamal",
    name: "Kamal",
    language: "Ruby",
    description: "Deploy web apps anywhere — from Basecamp (DHH)",
    prompts: [
      "How does Kamal orchestrate a zero-downtime rolling deploy?",
      "How does Kamal manage Traefik as the load balancer?",
      "How does the remote Docker host connection and command execution work?",
    ],
  },
  {
    repo: "gogs/gogs",
    name: "Gogs",
    language: "Go",
    description: "Painless self-hosted Git service — lightweight Gitea alternative",
    prompts: [
      "How does Gogs handle Git push/pull authentication and authorization?",
      "How does the repository creation and hook system work?",
      "How does Gogs render diffs and manage merge operations?",
    ],
  },
  {
    repo: "maybe-finance/maybe",
    name: "Maybe",
    language: "Ruby",
    description: "Personal finance OS — open-sourced after $1M+ investment",
    prompts: [
      "How does Maybe sync bank accounts and transactions?",
      "How does the net worth calculation and portfolio tracking work?",
      "How does the multi-currency support work?",
    ],
  },
  {
    repo: "ghostfolio/ghostfolio",
    name: "Ghostfolio",
    language: "TypeScript",
    description: "Open source wealth management — tracks stocks, ETFs, crypto",
    prompts: [
      "How does Ghostfolio fetch and cache market data from providers?",
      "How does the portfolio performance calculation work?",
      "How does the asset allocation and rebalancing analysis work?",
    ],
  },
  // ── Requires API key (> 2 000 files) ──────────────────────────────
  {
    repo: "mastodon/mastodon",
    name: "Mastodon",
    language: "Ruby",
    description: "Decentralized social network — 50k+ stars, ActivityPub federation",
    prompts: [
      "How does ActivityPub federation deliver posts to remote instances?",
      "How does the home timeline get assembled from followed accounts?",
      "How does Mastodon handle media attachments and content warnings?",
    ],
    requiresKey: true,
  },
  {
    repo: "chatwoot/chatwoot",
    name: "Chatwoot",
    language: "Ruby",
    description: "Open source customer engagement — omnichannel inbox",
    prompts: [
      "How does the omnichannel inbox route messages from different platforms?",
      "How does the real-time agent assignment and notification work?",
      "How does Chatwoot integrate with WhatsApp and Slack?",
    ],
    requiresKey: true,
  },
];

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

function ProjectCatalog({
  onSelect,
}: {
  onSelect: (url: string) => void;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const languages = [...new Set(CATALOG.map((p) => p.language))];

  const filtered = filter ? CATALOG.filter((p) => p.language === filter) : CATALOG;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-medium text-[#8b949e] uppercase tracking-wide flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5" />
          Understand how real projects work
        </h4>
        <div className="flex gap-1">
          <button
            onClick={() => setFilter(null)}
            className={cn(
              "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
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
              onClick={() => setFilter(lang === filter ? null : lang)}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {filtered.map((project) => (
          <div
            key={project.repo}
            className="rounded border border-[#21262d] bg-[#0d1117] p-3 hover:border-[#30363d] transition-colors"
          >
            <div className="flex items-start justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <LanguageBadge language={project.language} />
                <span className="text-xs font-medium text-[#e1e4e8]">{project.name}</span>
                {project.requiresKey && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#30363d] text-[#8b949e]">
                    key needed
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <CopyButton text={`https://github.com/${project.repo}`} />
                <button
                  onClick={() => onSelect(`https://github.com/${project.repo}`)}
                  className="text-[10px] text-accent hover:text-[#79b8ff] transition-colors font-medium"
                >
                  Use
                </button>
              </div>
            </div>
            <p className="text-[10px] text-[#484f58] mb-2">{project.description}</p>
            <div className="space-y-1">
              {project.prompts.map((prompt, i) => (
                <div key={i} className="flex items-start gap-1 group">
                  <CopyButton text={prompt} />
                  <span className="text-[10px] text-[#8b949e] group-hover:text-[#e1e4e8] transition-colors leading-tight">
                    {prompt}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const PROVIDERS: Array<{ id: BenchmarkProvider; label: string; hint: string }> = [
  { id: "gemini", label: "Google Gemini", hint: "Free tier available at ai.google.dev" },
  { id: "openai", label: "OpenAI", hint: "GPT-4o-mini or similar" },
  { id: "deepseek", label: "DeepSeek", hint: "~$0.14/1M input tokens" },
  { id: "anthropic", label: "Anthropic", hint: "Claude models" },
];

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

function BenchmarkStepper({ currentStage }: { currentStage: BenchmarkStage }) {
  const currentIdx = BENCHMARK_STAGES.findIndex((s) => s.key === currentStage);
  return (
    <div className="space-y-2 py-2">
      {BENCHMARK_STAGES.map((stage, i) => {
        const state = i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
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
                {stage.description}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SubmitForm({
  onSubmitted,
  slotsUsed,
  slotsTotal,
}: {
  onSubmitted: () => void;
  slotsUsed: number;
  slotsTotal: number;
}) {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState<BenchmarkProvider>("gemini");
  const [apiKey, setApiKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresKey, setRequiresKey] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [currentStage, setCurrentStage] = useState<BenchmarkStage>("queued");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);
  const submittedRepoRef = useRef<string | null>(null);

  const isFull = slotsUsed >= slotsTotal;
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
            submittedRepoRef.current = null;
            navigate(`/benchmarks/${slugify(myRepo)}`);
          }
        } else if (active.status === "error") {
          stopPolling();
          setQueuePosition(null);
          setError(`Benchmark failed: ${active.error ?? "unknown error"}`);
          busyRef.current = false;
        } else {
          setQueuePosition(active.position);
          if (active.stage) setCurrentStage(active.stage);
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
      if (showKeyInput && apiKey.trim()) {
        req.provider = provider;
        req.apiKey = apiKey.trim();
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
        setQueuePosition(res.position ?? 1);
        startPolling();
      } else if (res.error?.includes("already in the queue")) {
        const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
        submittedRepoRef.current = match?.[1]?.replace(/\.git$/, "") ?? null;
        setQueuePosition(1);
        startPolling();
      } else if (res.error?.includes("already been benchmarked")) {
        const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
        if (match) {
          const repoSlug = match[1].replace(/\.git$/, "");
          navigate(`/benchmarks/${slugify(repoSlug)}`);
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
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-[#e1e4e8] uppercase tracking-wide">
          Benchmark a project
        </h3>
        <span
          className={cn(
            "text-xs font-mono px-2 py-0.5 rounded border",
            isFull
              ? "text-[#f85149] border-[#f85149]/30 bg-[#f85149]/10"
              : "text-[#8b949e] border-[#30363d] bg-[#0d1117]"
          )}
        >
          {slotsUsed}/{slotsTotal} slots used
        </span>
      </div>

      <p className="text-sm text-[#8b949e] mb-4">
        Results are saved and available for everyone. Re-analyze with your own API key for LLM-enhanced insights.
      </p>

      {isFull ? (
        <p className="text-sm text-[#8b949e]">
          All benchmark slots are taken. Check back later or self-host srcmap to run unlimited benchmarks.
        </p>
      ) : queuePosition ? (
        <BenchmarkStepper currentStage={currentStage} />
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
                    Your API key is used exclusively for this benchmark run.
                    It is never stored, logged, or transmitted to any third party.
                  </p>
                  <p className="text-xs text-[#58a6ff]">
                    Already benchmarked? Provide your API key to re-run with deeper, LLM-powered analysis.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as BenchmarkProvider)}
                  disabled={busy}
                  className="rounded border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e1e4e8] focus:border-accent focus:outline-none disabled:opacity-50"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your API key"
                  disabled={busy}
                  className="sm:col-span-2 rounded border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e1e4e8] placeholder-[#484f58] focus:border-accent focus:outline-none disabled:opacity-50"
                />
              </div>

              <p className="text-[10px] text-[#484f58]">
                {PROVIDERS.find((p) => p.id === provider)?.hint}
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
  const [queue, setQueue] = useState<BenchmarkQueueResponse | null>(null);
  const [page, setPage] = useState(0);
  const PROJECTS_PER_PAGE = 10;

  const loadData = useCallback(() => {
    api.benchmarks().then(setData).catch(() => {});
    api.benchmarkQueue().then(setQueue).catch(() => {});
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
      {/* Header */}
      <header
        className="border-b border-[#30363d] px-6 py-12"
        style={{
          background: "linear-gradient(180deg, #0f1117 0%, #161b22 100%)",
        }}
      >
        <div className="mx-auto max-w-6xl">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-[#8b949e] hover:text-accent transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
          <h1 className="text-3xl font-bold text-[#e1e4e8]">Benchmarks</h1>
          <p className="mt-2 text-[#8b949e] max-w-2xl">
            How srcmap performs across real-world open-source projects.
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
        <SubmitForm
          onSubmitted={loadData}
          slotsUsed={queue?.slotsUsed ?? data?.benchmarks?.projects?.length ?? 0}
          slotsTotal={queue?.slotsTotal ?? 20}
        />

        {loading ? (
          <p className="text-center text-[#8b949e] py-20">
            Loading benchmarks…
          </p>
        ) : !bench ? (
          <p className="text-center text-[#8b949e] py-20">
            No benchmark data available yet. Run{" "}
            <code className="text-accent">
              python eval/generate_benchmarks.py
            </code>{" "}
            to generate.
          </p>
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
                      {visibleProjects.map((p) => (
                        <Link
                          key={p.name}
                          to={`/benchmarks/${slugify(p.repo)}`}
                          className="rounded bg-[#0d1117] border border-[#21262d] p-3 text-left hover:border-accent/50 hover:bg-[#0d1117]/80 transition-colors group block"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <LanguageBadge language={p.language} />
                            <span className="text-xs font-medium text-[#e1e4e8] group-hover:text-accent transition-colors">
                              {p.name}
                            </span>
                            <span className={cn(
                              "ml-auto text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap",
                              p.llmEnhanced
                                ? "text-[#d2a8ff] border-[#d2a8ff]/30 bg-[#d2a8ff]/10"
                                : "text-[#8b949e] border-[#30363d] bg-[#21262d]"
                            )}>
                              {p.llmEnhanced ? "LLM" : "Structural"}
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
                      ))}
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
                  srcmap response tokens vs. estimated tokens from reading all
                  source files referenced in matched cards (~500 tokens/file)
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
      <footer className="border-t border-[#30363d] px-6 py-6 mt-10">
        <div className="flex items-center justify-center gap-4 text-sm text-[#8b949e]">
          <Link to="/" className="hover:text-accent transition-colors">
            Home
          </Link>
          <span className="text-[#30363d]">|</span>
          <a
            href="https://github.com/srcmap/srcmap"
            className="hover:text-accent transition-colors"
          >
            GitHub
          </a>
          <span className="text-[#30363d]">|</span>
          <Link to="/onboard" className="hover:text-accent transition-colors">
            Get Started
          </Link>
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
                <h1 className="text-2xl font-bold text-[#e1e4e8]">{project.name}</h1>
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
            <p className="text-xl font-bold text-[#3fb950]">{s.avg_tokens_with_srcmap}</p>
            <p className="text-xs text-[#8b949e] mt-0.5">srcmap tokens/query</p>
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
    </div>
  );
}
