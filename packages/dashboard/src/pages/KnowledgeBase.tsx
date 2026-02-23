import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Search,
  X,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Layers,
  ChevronRight,
  BookOpen,
  Plus,
  Loader2,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RepoBadge } from "@/components/layout/RepoBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingState } from "@/components/shared/LoadingState";
import { api, type Card, type FlowSummary } from "@/lib/api";
import { formatRelativeTime, cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Add Knowledge File modal
// ---------------------------------------------------------------------------

interface AddKnowledgeModalProps {
  onClose: () => void;
}

const PLACEHOLDER_MD = `# MyFramework Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.

## Architecture
- ...

## Code Style
- ...

## Testing
- ...

## Performance
- ...

## Security
- ...

## Anti-Patterns
- ...
`.trim();

function AddKnowledgeModal({ onClose }: AddKnowledgeModalProps) {
  const [skillId, setSkillId] = useState("");
  const [content, setContent] = useState(PLACEHOLDER_MD);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setContent(text);
      if (!skillId) {
        setSkillId(file.name.replace(/\.md$/i, "").toLowerCase());
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!skillId.trim() || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.addKnowledgeFile(skillId.trim(), content);
      setDone(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save knowledge file");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-[600px] max-h-[90vh] bg-[#0f1117] border border-[#30363d] rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#21262d]">
          <div className="flex items-center gap-2">
            <BookOpen size={15} className="text-accent" />
            <h2 className="text-sm font-semibold text-[#e1e4e8]">Add Knowledge File</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded text-[#484f58] hover:text-[#8b949e]">
            <X size={15} />
          </button>
        </div>

        {done ? (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-success/10 border border-success/30">
              <CheckCircle2 size={16} className="text-success mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-success">Knowledge file saved</p>
                <p className="text-xs text-[#8b949e] mt-1">{done}</p>
              </div>
            </div>
            <p className="text-xs text-[#484f58]">
              The file was written to <code className="text-[#8b949e]">.srcmap/knowledge/{skillId}.md</code>.
              It will be picked up automatically on the next <code className="text-[#8b949e]">srcmap index</code> run.
            </p>
            <button
              onClick={onClose}
              className="w-full px-3 py-2 rounded-md text-xs bg-[#1c2333] border border-[#30363d] text-[#c9d1d9] hover:border-accent/50 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col flex-1 min-h-0">
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Skill ID + upload button */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-1.5">
                    Framework / Skill ID
                  </label>
                  <input
                    type="text"
                    value={skillId}
                    onChange={(e) => setSkillId(e.target.value.toLowerCase())}
                    placeholder="myframework"
                    className="w-full px-3 py-2 rounded-md border border-[#30363d] bg-[#161b22] text-xs text-[#c9d1d9] placeholder:text-[#484f58] font-mono focus:outline-none focus:border-accent/50"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-1.5">
                    Import .md
                  </label>
                  <label className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-[#30363d] bg-[#161b22] text-xs text-[#8b949e] hover:border-[#484f58] cursor-pointer transition-colors">
                    <Upload size={11} />
                    Browse
                    <input type="file" accept=".md" onChange={handleFile} className="sr-only" />
                  </label>
                </div>
              </div>

              <p className="text-[10px] text-[#484f58] -mt-2">
                The file will be saved as <code className="text-[#8b949e]">.srcmap/knowledge/{"{"}skillId{"}"}.md</code> in the workspace root.
                It overrides the built-in skill for that ID. Built-in IDs: rails, react, vue, nextjs, go, python, django, nestjs, laravel, gin, angular, spring, fastapi.
              </p>

              {/* Content editor */}
              <div>
                <label className="block text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-1.5">
                  Markdown Content
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={16}
                  className="w-full px-3 py-2.5 rounded-md border border-[#30363d] bg-[#161b22] text-xs text-[#c9d1d9] font-mono resize-y focus:outline-none focus:border-accent/50 leading-relaxed"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-danger/10 border border-danger/30 text-xs text-danger">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                  {error}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-[#21262d] flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-3 py-2 rounded-md text-xs text-[#8b949e] border border-[#30363d] hover:border-[#484f58] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !skillId.trim() || !content.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs bg-accent text-black font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                {saving ? "Saving…" : "Save Knowledge File"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card detail drawer
// ---------------------------------------------------------------------------

interface CardDrawerProps {
  card: Card;
  onClose: () => void;
}

function CardDrawer({ card, onClose }: CardDrawerProps) {
  let sourceFiles: string[] = [];
  try { sourceFiles = JSON.parse(card.source_files) as string[]; } catch { /* ignore */ }
  let sourceRepos: string[] = [];
  try { sourceRepos = JSON.parse(card.source_repos) as string[]; } catch { /* ignore */ }
  let tags: string[] = [];
  try { tags = JSON.parse(card.tags) as string[]; } catch { /* ignore */ }

  return (
    <div className="fixed inset-y-0 right-0 w-[500px] bg-[#0f1117] border-l border-[#30363d] z-50 flex flex-col shadow-2xl">
      <div className="flex items-start justify-between p-5 border-b border-[#21262d]">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[#e1e4e8] leading-tight">{card.title}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-mono text-[#8b949e]">{card.flow}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1c2333] text-[#8b949e] border border-[#30363d]">
              {card.card_type}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="ml-3 p-1 rounded text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#1c2333] transition-colors flex-shrink-0">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Staleness badge */}
        {card.stale ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-warning/10 border border-warning/30 text-xs text-warning">
            <AlertTriangle size={12} />
            This card is stale — source files may have changed
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-success/10 border border-success/30 text-xs text-success">
            <CheckCircle2 size={12} />
            Fresh · Updated {formatRelativeTime(card.updated_at)}
          </div>
        )}

        {/* Content */}
        <div>
          <h3 className="text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-2">Content</h3>
          <p className="text-xs text-[#c9d1d9] leading-relaxed whitespace-pre-wrap">{card.content}</p>
        </div>

        {/* Repos */}
        {sourceRepos.length > 0 && (
          <div>
            <h3 className="text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-2">Repositories</h3>
            <div className="flex flex-wrap gap-1">
              {sourceRepos.map((r) => <RepoBadge key={r} label={r} />)}
            </div>
          </div>
        )}

        {/* Source files */}
        {sourceFiles.length > 0 && (
          <div>
            <h3 className="text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-2">
              Source Files <span className="text-[#30363d]">({sourceFiles.length})</span>
            </h3>
            <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {sourceFiles.map((f) => (
                <div key={f} className="font-mono text-[10px] text-[#8b949e] break-all">{f}</div>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div>
            <h3 className="text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-2">Tags</h3>
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-[#1c2333] text-[#8b949e] border border-[#30363d]">{t}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow card
// ---------------------------------------------------------------------------

interface FlowCardProps {
  flow: FlowSummary;
  onClick: () => void;
}

function FlowCard({ flow, onClick }: FlowCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left rounded-lg border p-4 hover:bg-[#1c2333] transition-all",
        flow.isPageFlow
          ? "border-blue-400/20 bg-[#161b22] hover:border-blue-400/40"
          : "border-[#30363d] bg-[#161b22] hover:border-[#58a6ff]/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium text-[#c9d1d9] truncate">{flow.flow}</div>
        {flow.isPageFlow && (
          <span className="flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-400 border border-blue-400/20">page</span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-[#8b949e]">
        <span className="flex items-center gap-1"><Layers size={10} />{flow.cardCount} cards</span>
        <span className="flex items-center gap-1"><FileText size={10} />{flow.fileCount} files</span>
        {flow.repos.length > 1 && <span className="text-blue-400/60">cross-repo</span>}
        {flow.staleCount > 0 && <span className="text-warning/70">⚠ {flow.staleCount} stale</span>}
      </div>
      {flow.repos.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {flow.repos.slice(0, 2).map((r) => (
            <span key={r} className="text-[9px] px-1 py-0.5 rounded bg-[#1c2333] text-[#484f58] border border-[#21262d] truncate max-w-[100px]">{r}</span>
          ))}
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Knowledge Base page
// ---------------------------------------------------------------------------

export function KnowledgeBase() {
  const [cards, setCards] = useState<Card[]>([]);
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"cards" | "flows">("cards");
  const [search, setSearch] = useState("");
  const [filterStale, setFilterStale] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null);
  const [showAddKnowledge, setShowAddKnowledge] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const filter = searchParams.get("filter");
    if (filter === "stale") setFilterStale(true);
  }, [searchParams]);

  const loadCards = useCallback((flow?: string) => {
    setLoading(true);
    Promise.all([
      api.cards(flow ? { flow } : undefined),
      api.flows(),
    ])
      .then(([c, f]) => {
        setCards(c);
        setFlows(f);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadCards(selectedFlow ?? undefined);
  }, [loadCards, selectedFlow]);

  const filtered = useMemo(() => {
    let result = cards;
    if (filterStale) result = result.filter((c) => c.stale === 1);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.flow.toLowerCase().includes(q) ||
          c.source_files.toLowerCase().includes(q),
      );
    }
    return result;
  }, [cards, filterStale, search]);

  const staleCount = cards.filter((c) => c.stale === 1).length;

  return (
    <div>
      <div className="flex items-start justify-between mb-0">
        <PageHeader
          title="Knowledge Base"
          subtitle={`${cards.length} cards · ${flows.length} flows${staleCount > 0 ? ` · ⚠ ${staleCount} stale` : ""}`}
        />
        <button
          onClick={() => setShowAddKnowledge(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#1c2333] border border-[#30363d] text-[#c9d1d9] hover:border-accent/50 hover:text-accent transition-colors mt-1"
        >
          <Plus size={12} />
          Add Knowledge
        </button>
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-1 mb-5">
        {(["cards", "flows"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-3 py-1.5 rounded text-xs font-medium transition-colors capitalize",
              activeTab === tab
                ? "bg-[#1c2333] text-[#e1e4e8] border border-[#30363d]"
                : "text-[#8b949e] hover:text-[#c9d1d9]",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "cards" ? (
        <div className="flex gap-4">
          {/* Filter sidebar */}
          <aside className="w-44 flex-shrink-0 space-y-4">
            {/* Staleness filter */}
            <div>
              <h3 className="text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-2">Status</h3>
              <label className="flex items-center gap-2 text-xs text-[#8b949e] hover:text-[#c9d1d9] cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterStale}
                  onChange={(e) => setFilterStale(e.target.checked)}
                  className="accent-warning"
                />
                Stale only
              </label>
            </div>

            {/* Flow filter */}
            {flows.length > 0 && (
              <div>
                <h3 className="text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-2">Flow</h3>
                <div className="space-y-0.5 max-h-[420px] overflow-y-auto">
                  <button
                    onClick={() => setSelectedFlow(null)}
                    className={cn(
                      "block w-full text-left text-xs px-2 py-1.5 rounded transition-colors",
                      !selectedFlow ? "text-accent bg-[#1c2333]" : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22]",
                    )}
                  >
                    All flows
                  </button>

                  {/* Page-level flows (FE-seeded, named with spaces) */}
                  {flows.filter((f) => f.isPageFlow).length > 0 && (
                    <>
                      <div className="text-[9px] font-medium text-[#484f58] uppercase tracking-wider px-2 pt-2 pb-0.5">Pages</div>
                      {flows.filter((f) => f.isPageFlow).map((f) => (
                        <button
                          key={f.flow}
                          onClick={() => setSelectedFlow(f.flow === selectedFlow ? null : f.flow)}
                          className={cn(
                            "block w-full text-left px-2 py-1.5 rounded transition-colors group",
                            selectedFlow === f.flow ? "bg-[#1c2333]" : "hover:bg-[#161b22]",
                          )}
                        >
                          <div className={cn("text-xs truncate", selectedFlow === f.flow ? "text-accent" : "text-[#c9d1d9]")}>{f.flow}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] text-[#484f58]">{f.cardCount} cards</span>
                            {f.repos.length > 1 && <span className="text-[9px] text-blue-400/60">cross-repo</span>}
                            {f.staleCount > 0 && <span className="text-[9px] text-warning/70">⚠ {f.staleCount}</span>}
                          </div>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Technical/hub flows */}
                  {flows.filter((f) => !f.isPageFlow).length > 0 && (
                    <>
                      <div className="text-[9px] font-medium text-[#484f58] uppercase tracking-wider px-2 pt-2 pb-0.5">Technical</div>
                      {flows.filter((f) => !f.isPageFlow).map((f) => (
                        <button
                          key={f.flow}
                          onClick={() => setSelectedFlow(f.flow === selectedFlow ? null : f.flow)}
                          className={cn(
                            "block w-full text-left text-xs px-2 py-1 rounded transition-colors truncate",
                            selectedFlow === f.flow ? "text-accent bg-[#1c2333]" : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22]",
                          )}
                        >
                          {f.flow}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </aside>

          {/* Card list */}
          <div className="flex-1 min-w-0">
            {/* Search bar */}
            <div className="relative mb-3">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#484f58]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search cards…"
                className="w-full pl-8 pr-8 py-2 rounded-md border border-[#30363d] bg-[#161b22] text-xs text-[#c9d1d9] placeholder:text-[#484f58] focus:outline-none focus:border-accent/50 transition-colors"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#484f58] hover:text-[#8b949e]">
                  <X size={12} />
                </button>
              )}
            </div>

            {loading ? (
              <LoadingState rows={6} />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<FileText size={32} />}
                title={search || filterStale ? "No cards match the filter" : "No cards yet"}
                description={search || filterStale ? "Try clearing the filters" : "Index a repository to generate cards"}
              />
            ) : (
              <div className="rounded-lg border border-[#30363d] bg-[#161b22] divide-y divide-[#21262d]">
                {filtered.map((card) => {
                  let sourceFiles: string[] = [];
                  try { sourceFiles = JSON.parse(card.source_files) as string[]; } catch { /* ignore */ }
                  let sourceRepos: string[] = [];
                  try { sourceRepos = JSON.parse(card.source_repos) as string[]; } catch { /* ignore */ }
                  const mainFile = sourceFiles[0];

                  const typeColor: Record<string, string> = {
                    flow: "text-blue-400 bg-blue-400/10 border-blue-400/20",
                    model: "text-purple-400 bg-purple-400/10 border-purple-400/20",
                    cross_service: "text-orange-400 bg-orange-400/10 border-orange-400/20",
                    hub: "text-[#8b949e] bg-[#8b949e]/10 border-[#8b949e]/20",
                    auto_generated: "text-green-400 bg-green-400/10 border-green-400/20",
                  };
                  const typeBadgeClass = typeColor[card.card_type] ?? typeColor.hub;
                  // For cross-service cards, show the source files as context (not title)
                  const fileHint = card.card_type === "cross_service" && mainFile
                    ? mainFile.replace(/^.*\/src\//, "").replace(/^.*\/app\//, "")
                    : null;

                  return (
                    <div
                      key={card.id}
                      onClick={() => setSelectedCard(card)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-[#1c2333]/50 cursor-pointer transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        {/* Primary: card title */}
                        <div className="flex items-center gap-2">
                          <div className="text-xs text-[#c9d1d9] font-medium truncate">{card.title}</div>
                          <span className={`flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded border font-medium ${typeBadgeClass}`}>
                            {card.card_type.replace("_", " ")}
                          </span>
                        </div>
                        {/* Secondary: flow + repos + optional file hint */}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-[#484f58] font-mono truncate max-w-[120px]">{card.flow}</span>
                          {sourceRepos.slice(0, 2).map((r) => (
                            <RepoBadge key={r} label={r} />
                          ))}
                          {fileHint && (
                            <span className="font-mono text-[9px] text-[#484f58] truncate max-w-[180px]">{fileHint}</span>
                          )}
                          <span className="text-[10px] text-[#484f58] ml-auto flex-shrink-0">{formatRelativeTime(card.updated_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {card.stale ? (
                          <span className="flex items-center gap-1 text-[10px] text-warning">
                            <AlertTriangle size={10} />Stale
                          </span>
                        ) : (
                          <CheckCircle2 size={12} className="text-success opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                        <ChevronRight size={12} className="text-[#484f58] opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {filtered.length > 0 && (
              <p className="mt-2 text-[10px] text-[#484f58]">{filtered.length} card{filtered.length !== 1 ? "s" : ""}</p>
            )}
          </div>
        </div>
      ) : (
        /* Flows grid */
        loading ? (
          <LoadingState rows={4} />
        ) : flows.length === 0 ? (
          <EmptyState icon={<Layers size={32} />} title="No flows detected yet" />
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {flows.map((f) => (
              <FlowCard
                key={f.flow}
                flow={f}
                onClick={() => {
                  setActiveTab("cards");
                  setSelectedFlow(f.flow);
                }}
              />
            ))}
          </div>
        )
      )}

      {/* Add knowledge modal */}
      {showAddKnowledge && (
        <AddKnowledgeModal onClose={() => setShowAddKnowledge(false)} />
      )}

      {/* Card detail drawer */}
      {selectedCard && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setSelectedCard(null)} />
          <CardDrawer card={selectedCard} onClose={() => setSelectedCard(null)} />
        </>
      )}
    </div>
  );
}
