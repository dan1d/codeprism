import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Search,
  X,
  BookText,
  Loader2,
  RefreshCw,
  Sparkles,
  FileText,
  Users,
  Code2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { RepoBadges } from "@/components/layout/RepoBadge";
import { MarkdownRenderer } from "@/components/shared/MarkdownRenderer";
import { api, type GeneratedDoc, type DocsGenerationState } from "@/lib/api";
import { formatRelativeTime, cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Audience toggle
// ---------------------------------------------------------------------------

interface AudienceToggleProps {
  value: "user" | "dev";
  onChange: (v: "user" | "dev") => void;
}

function AudienceToggle({ value, onChange }: AudienceToggleProps) {
  return (
    <div className="flex items-center rounded-md border border-[#30363d] bg-[#161b22] p-0.5 gap-0.5">
      {(
        [
          { key: "user", icon: Users, label: "User Guide" },
          { key: "dev", icon: Code2, label: "Developer Ref" },
        ] as const
      ).map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors",
            value === key
              ? "bg-[#1c2333] text-[#e1e4e8]"
              : "text-[#8b949e] hover:text-[#c9d1d9]",
          )}
        >
          <Icon size={11} />
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loading state
// ---------------------------------------------------------------------------

function DocsSkeleton() {
  return (
    <div className="flex gap-5 animate-pulse">
      <aside className="w-[200px] flex-shrink-0 space-y-1.5">
        <div className="h-7 rounded bg-[#1c2333] mb-3" />
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="h-8 rounded bg-[#161b22]"
            style={{ opacity: Math.max(0.2, 1 - i * 0.1) }}
          />
        ))}
      </aside>
      <div className="flex-1 space-y-3">
        <div className="h-5 w-2/5 rounded bg-[#1c2333]" />
        <div className="h-3 w-1/3 rounded bg-[#161b22]" />
        <div className="h-px bg-[#21262d] my-3" />
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="h-3 rounded bg-[#161b22]"
            style={{ width: `${65 + ((i * 13) % 30)}%`, opacity: Math.max(0.15, 1 - i * 0.07) }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function Docs() {
  const [audience, setAudience] = useState<"user" | "dev">("user");
  const [docs, setDocs] = useState<GeneratedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<DocsGenerationState | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch docs on audience change
  const fetchDocs = useCallback(
    async (aud: "user" | "dev") => {
      setLoading(true);
      try {
        const data = await api.generatedDocs({ audience: aud });
        setDocs(data);
        setSelectedFlow((prev) => {
          // Keep selection if the flow still exists, otherwise pick first
          if (prev && data.some((d) => d.flow === prev)) return prev;
          return data[0]?.flow ?? null;
        });
      } catch {
        toast.error("Failed to load documentation");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchDocs(audience);
  }, [audience, fetchDocs]);

  // Poll status while generating
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const state = await api.docsStatus();
        setGenProgress(state);
        if (state.status === "done" || state.status === "error") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setGenerating(false);
          if (state.status === "done") {
            toast.success("Documentation generated");
            void fetchDocs(audience);
          } else {
            toast.error(`Generation failed: ${state.error ?? "unknown error"}`);
          }
        }
      } catch { /* ignore poll errors */ }
    }, 2000);
  }, [audience, fetchDocs]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Generate all docs
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setGenProgress(null);
    try {
      const res = await api.generateDocs({ audience, force: false });
      toast.info(res.message);
      startPolling();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start generation");
      setGenerating(false);
    }
  }, [audience, startPolling]);

  // Regenerate a single flow
  const handleRegenerateFlow = useCallback(
    async (flow: string) => {
      try {
        await api.generateDocs({ flow, audience, force: true });
        toast.info(`Regenerating "${flow}"…`);
        startPolling();
        setGenerating(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    },
    [audience, startPolling],
  );

  // Derived data
  const filteredDocs = useMemo(() => {
    if (!search.trim()) return docs;
    const q = search.toLowerCase();
    return docs.filter(
      (d) => d.flow.toLowerCase().includes(q) || d.title.toLowerCase().includes(q),
    );
  }, [docs, search]);

  const currentDoc = useMemo(
    () => (selectedFlow ? docs.find((d) => d.flow === selectedFlow) ?? null : null),
    [docs, selectedFlow],
  );

  const subtitle = !loading && docs.length > 0
    ? `${docs.length} flows · ${audience === "user" ? "User Guides" : "Developer Reference"}`
    : undefined;

  return (
    <div>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <PageHeader
          title="Documentation"
          subtitle={subtitle}
        />
        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
          <AudienceToggle value={audience} onChange={setAudience} />
          <button
            onClick={() => void handleGenerate()}
            disabled={generating || loading}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              generating || loading
                ? "bg-accent/50 text-black/70 cursor-not-allowed"
                : "bg-accent text-black hover:bg-[#79b8ff]",
            )}
          >
            {generating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            {generating ? "Generating…" : "Generate Docs"}
          </button>
        </div>
      </div>

      {/* ── Progress banner ───────────────────────────────────────────── */}
      {generating && genProgress && genProgress.total > 0 && (
        <div className="mb-5 px-4 py-2.5 rounded-lg border border-accent/30 bg-accent/5 flex items-center gap-3">
          <Loader2 size={13} className="animate-spin text-accent flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[#c9d1d9]">
              Generating documentation…{" "}
              <span className="text-accent font-medium">
                {genProgress.generated}/{genProgress.total}
              </span>{" "}
              flows
            </p>
            {/* Progress bar */}
            <div className="mt-1.5 h-1 rounded-full bg-[#21262d] overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${Math.round((genProgress.generated / genProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────── */}
      {loading ? (
        <DocsSkeleton />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={<BookText size={32} className="text-[#484f58]" />}
          title="No documentation yet"
          description={`Generate ${audience === "user" ? "user guides" : "developer references"} from your knowledge cards. The LLM will infer your product's domain automatically.`}
          action={
            <button
              onClick={() => void handleGenerate()}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-xs bg-accent text-black font-medium hover:bg-[#79b8ff] disabled:opacity-50 transition-colors"
            >
              {generating ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} />
              )}
              {generating ? "Generating…" : "Generate Docs"}
            </button>
          }
        />
      ) : (
        <div className="flex gap-5">
          {/* ── Sidebar ──────────────────────────────────────────────── */}
          <aside className="w-[200px] flex-shrink-0">
            {/* Search */}
            <div className="relative mb-3">
              <Search
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#484f58] pointer-events-none"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search flows…"
                className="w-full pl-7 pr-7 py-1.5 rounded border border-[#30363d] bg-[#161b22] text-xs text-[#c9d1d9] placeholder:text-[#484f58] focus:outline-none focus:border-accent/50 transition-colors"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#484f58] hover:text-[#8b949e]"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Flow list */}
            <nav className="space-y-0.5">
              {filteredDocs.map((doc) => (
                <button
                  key={doc.flow}
                  onClick={() => setSelectedFlow(doc.flow)}
                  className={cn(
                    "w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors group",
                    selectedFlow === doc.flow
                      ? "bg-[#1c2333] text-[#e1e4e8]"
                      : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22]",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <FileText
                      size={11}
                      className={cn(
                        "flex-shrink-0",
                        selectedFlow === doc.flow ? "text-accent" : "text-[#484f58]",
                      )}
                    />
                    <span className="truncate font-medium">{doc.flow}</span>
                  </div>
                  <div className="text-[9px] text-[#484f58] mt-0.5 ml-4">
                    {doc.card_count} {doc.card_count === 1 ? "card" : "cards"}
                  </div>
                </button>
              ))}
              {filteredDocs.length === 0 && (
                <p className="text-[10px] text-[#484f58] px-2.5 py-2">
                  No flows match "{search}"
                </p>
              )}
            </nav>
          </aside>

          {/* ── Content ──────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {currentDoc ? (
              <article>
                {/* Doc header */}
                <div className="mb-5 pb-4 border-b border-[#21262d]">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h1 className="text-sm font-semibold text-[#e1e4e8] leading-snug">
                      {currentDoc.title}
                    </h1>
                    <button
                      onClick={() => void handleRegenerateFlow(currentDoc.flow)}
                      disabled={generating}
                      className="flex-shrink-0 flex items-center gap-1 text-[10px] text-[#484f58] hover:text-[#8b949e] transition-colors disabled:opacity-40 mt-0.5"
                      title="Regenerate this doc"
                    >
                      <RefreshCw size={10} />
                      Regenerate
                    </button>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Repo badges */}
                    {(() => {
                      let repos: string[] = [];
                      try { repos = JSON.parse(currentDoc.source_repos) as string[]; } catch { /* ignore */ }
                      return repos.length > 0 ? <RepoBadges items={repos} max={4} /> : null;
                    })()}
                    <span className="text-[10px] text-[#484f58]">
                      {currentDoc.card_count} source {currentDoc.card_count === 1 ? "card" : "cards"}
                    </span>
                    <span className="text-[10px] text-[#484f58]">
                      Updated {formatRelativeTime(currentDoc.updated_at)}
                    </span>
                  </div>
                </div>

                {/* Rendered markdown */}
                <MarkdownRenderer content={currentDoc.content} />
              </article>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-center gap-2">
                <BookText size={24} className="text-[#484f58]" />
                <p className="text-xs text-[#484f58]">
                  Select a flow from the left to view its documentation
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
