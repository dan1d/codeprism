import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ShieldAlert,
  AlertTriangle,
  Info,
  Loader2,
  X,
  Upload,
  Play,
  CheckCircle2,
  XCircle,
  Sparkles,
  FileJson,
  ChevronDown,
  ChevronRight,
  Wand2,
  RotateCcw,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingState } from "@/components/shared/LoadingState";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamRule {
  id: string;
  name: string;
  description: string;
  severity: "error" | "warning" | "info";
  scope: string | null;
  enabled: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface RuleViolation {
  rule_id: string;
  rule_name: string;
  severity: "error" | "warning" | "info";
  file: string;
  line: number | null;
  snippet: string;
  explanation: string;
}

// ---------------------------------------------------------------------------
// Severity config
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG = {
  error: {
    icon: ShieldAlert,
    label: "Error",
    badge: "text-red-400 bg-red-400/10 border-red-400/20",
    text: "text-red-400",
    desc: "Blocks the push",
  },
  warning: {
    icon: AlertTriangle,
    label: "Warning",
    badge: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
    text: "text-yellow-400",
    desc: "Non-blocking",
  },
  info: {
    icon: Info,
    label: "Info",
    badge: "text-blue-400 bg-blue-400/10 border-blue-400/20",
    text: "text-blue-400",
    desc: "Informational only",
  },
} as const;

// ---------------------------------------------------------------------------
// Starter rule templates (quick-add)
// ---------------------------------------------------------------------------

interface RuleTemplate {
  name: string;
  description: string;
  severity: "error" | "warning" | "info";
  scope?: string;
  emoji: string;
}

const STARTER_RULES: RuleTemplate[] = [
  {
    emoji: "📏",
    name: "No one-line methods",
    description: "Methods must use a do/end block and span multiple lines. Single-line shorthand like `def foo = bar` is not allowed.",
    severity: "warning",
    scope: "rails",
  },
  {
    emoji: "🔑",
    name: "Always use strong params",
    description: "Controller actions must use strong parameters (permit) before passing params to models. Direct mass-assignment from params is not allowed.",
    severity: "error",
    scope: "rails",
  },
  {
    emoji: "🚫",
    name: "No raw SQL in controllers",
    description: "SQL strings must not be written directly in controllers. Use ActiveRecord query methods or move SQL into model scopes.",
    severity: "error",
    scope: "rails",
  },
  {
    emoji: "📝",
    name: "No TODO comments in new code",
    description: "Lines added in this diff must not contain TODO, FIXME, or HACK comments. Open a ticket instead.",
    severity: "warning",
  },
  {
    emoji: "🔒",
    name: "No hardcoded secrets",
    description: "Strings that look like API keys, passwords, or tokens must not appear in added lines. Use environment variables or a secrets manager.",
    severity: "error",
  },
  {
    emoji: "⚛️",
    name: "No inline styles in React",
    description: "React components must not use the `style={{}}` prop for layout. Use Tailwind utility classes or CSS modules instead.",
    severity: "warning",
    scope: "react",
  },
  {
    emoji: "🧪",
    name: "Tests required for new services",
    description: "Every new service class or module added must have a corresponding spec/test file in the diff.",
    severity: "warning",
    scope: "rails",
  },
  {
    emoji: "📦",
    name: "No console.log in production code",
    description: "console.log, console.warn, and console.error must not appear in non-test files in the diff.",
    severity: "warning",
    scope: "react",
  },
];

const EXAMPLE_JSON = JSON.stringify(
  [
    {
      name: "No one-line methods",
      description: "Methods must use a do/end block and span multiple lines.",
      severity: "warning",
      scope: "rails",
      created_by: "leo",
    },
    {
      name: "No hardcoded secrets",
      description: "API keys and passwords must not appear in code. Use env vars.",
      severity: "error",
    },
  ],
  null,
  2
);

// ---------------------------------------------------------------------------
// Import modal
// ---------------------------------------------------------------------------

interface ImportModalProps {
  existingNames: string[];
  onClose: () => void;
  onImported: (rules: TeamRule[]) => void;
}

function ImportModal({ existingNames, onClose, onImported }: ImportModalProps) {
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<RuleTemplate[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ inserted: string[]; skipped: string[]; errors: string[] } | null>(null);
  const [showExample, setShowExample] = useState(false);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRaw(text);
      tryParse(text);
    };
    reader.readAsText(file);
  };

  const tryParse = (text: string) => {
    setParseError(null);
    setParsed(null);
    try {
      const data = JSON.parse(text) as unknown;
      if (!Array.isArray(data)) throw new Error("Must be a JSON array");
      const valid = data.filter((r): r is RuleTemplate =>
        typeof (r as Record<string, unknown>).name === "string" &&
        typeof (r as Record<string, unknown>).description === "string"
      );
      if (valid.length === 0) throw new Error("No valid rule objects found (need name + description)");
      setParsed(valid);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  const handleImport = async () => {
    if (!parsed) return;
    setSaving(true);
    try {
      const res = await api.importRules(parsed);
      setResult(res);
      // Re-fetch full rules to get server-assigned IDs
      const updated = await api.rules() as TeamRule[];
      onImported(updated);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSaving(false);
    }
  };

  const duplicates = parsed?.filter((r) => existingNames.includes(r.name.toLowerCase())) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-[680px] max-h-[88vh] bg-[#0f1117] border border-[#30363d] rounded-xl shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#21262d] flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileJson size={15} className="text-accent" />
            <h2 className="text-sm font-semibold text-[#e1e4e8]">Import Rules from JSON</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded text-[#484f58] hover:text-[#8b949e]">
            <X size={15} />
          </button>
        </div>

        {result ? (
          /* Done state */
          <div className="p-6 space-y-4">
            <div className="rounded-lg border border-success/30 bg-success/10 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-success">
                <CheckCircle2 size={15} />
                Import complete
              </div>
              {result.inserted.length > 0 && (
                <p className="text-xs text-[#8b949e]">
                  Added {result.inserted.length} rule{result.inserted.length !== 1 ? "s" : ""}:{" "}
                  <span className="text-[#c9d1d9]">{result.inserted.join(", ")}</span>
                </p>
              )}
              {result.skipped.length > 0 && (
                <p className="text-xs text-[#484f58]">
                  Skipped (already exist): {result.skipped.join(", ")}
                </p>
              )}
              {result.errors.length > 0 && (
                <p className="text-xs text-danger">{result.errors.join("; ")}</p>
              )}
            </div>
            <button onClick={onClose} className="w-full px-3 py-2 rounded-md text-xs bg-[#1c2333] border border-[#30363d] text-[#c9d1d9] hover:border-accent/50 transition-colors">
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex flex-1 min-h-0">
              {/* Left: editor */}
              <div className="flex-1 flex flex-col p-5 border-r border-[#21262d] min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-medium text-[#484f58] uppercase tracking-wider">
                    Paste or upload JSON
                  </label>
                  <label className="flex items-center gap-1 px-2 py-1 rounded border border-[#30363d] text-[10px] text-[#8b949e] hover:border-[#484f58] cursor-pointer transition-colors">
                    <Upload size={10} />
                    Upload .json
                    <input type="file" accept=".json" onChange={handleFile} className="sr-only" />
                  </label>
                </div>
                <textarea
                  value={raw}
                  onChange={(e) => { setRaw(e.target.value); tryParse(e.target.value); }}
                  placeholder={EXAMPLE_JSON}
                  rows={12}
                  className="flex-1 w-full px-3 py-2.5 rounded-md border border-[#30363d] bg-[#161b22] text-[11px] text-[#c9d1d9] font-mono resize-none focus:outline-none focus:border-accent/50 leading-relaxed"
                  spellCheck={false}
                />

                {parseError && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-danger">
                    <XCircle size={12} />
                    {parseError}
                  </div>
                )}

                {parsed && !parseError && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-success">
                    <CheckCircle2 size={12} />
                    {parsed.length} rule{parsed.length !== 1 ? "s" : ""} ready to import
                    {duplicates.length > 0 && (
                      <span className="text-[#484f58]">· {duplicates.length} will be skipped (already exist)</span>
                    )}
                  </div>
                )}
              </div>

              {/* Right: example format */}
              <div className="w-56 flex-shrink-0 p-4 overflow-y-auto">
                <button
                  onClick={() => setShowExample((v) => !v)}
                  className="flex items-center gap-1 text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-3 hover:text-[#8b949e] transition-colors"
                >
                  {showExample ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  Format guide
                </button>

                {showExample && (
                  <div className="space-y-3 text-[10px] text-[#8b949e]">
                    <p>A JSON array of rule objects.</p>
                    <div className="space-y-2">
                      {[
                        { field: "name", req: true, desc: "Short rule title" },
                        { field: "description", req: true, desc: "What the LLM checks for — be specific" },
                        { field: "severity", req: false, desc: '"error" blocks push, "warning" is advisory, "info" is FYI' },
                        { field: "scope", req: false, desc: "rails, react, go, etc. Leave blank for all" },
                        { field: "created_by", req: false, desc: "Team member name" },
                      ].map(({ field, req, desc }) => (
                        <div key={field}>
                          <span className="font-mono text-[#c9d1d9]">{field}</span>
                          {req && <span className="text-danger ml-1">*</span>}
                          <p className="mt-0.5 leading-relaxed">{desc}</p>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => { setRaw(EXAMPLE_JSON); tryParse(EXAMPLE_JSON); }}
                      className="mt-2 px-2 py-1 rounded border border-[#30363d] text-[#8b949e] hover:border-accent/50 hover:text-accent transition-colors"
                    >
                      Load example
                    </button>
                  </div>
                )}

                {!showExample && (
                  <div className="space-y-1.5 text-[10px] text-[#484f58]">
                    <p>Required fields:</p>
                    <p className="font-mono text-[#8b949e]">name, description</p>
                    <p className="mt-2">Optional:</p>
                    <p className="font-mono text-[#8b949e]">severity, scope, created_by</p>
                    <button
                      onClick={() => { setRaw(EXAMPLE_JSON); tryParse(EXAMPLE_JSON); }}
                      className="mt-3 px-2 py-1 rounded border border-[#30363d] text-[#8b949e] hover:border-accent/50 hover:text-accent transition-colors"
                    >
                      Load example
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-[#21262d] flex gap-2 flex-shrink-0">
              <button onClick={onClose} className="flex-1 px-3 py-2 rounded-md text-xs text-[#8b949e] border border-[#30363d] hover:border-[#484f58] transition-colors">
                Cancel
              </button>
              <button
                onClick={() => void handleImport()}
                disabled={!parsed || saving || parsed.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs bg-accent text-black font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {saving ? "Importing…" : `Import ${parsed ? parsed.length : ""} rule${parsed?.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add single rule modal
// ---------------------------------------------------------------------------

interface AddRuleModalProps {
  initial?: Partial<RuleTemplate>;
  onClose: () => void;
  onAdded: (rule: TeamRule) => void;
}

function AddRuleModal({ initial, onClose, onAdded }: AddRuleModalProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [severity, setSeverity] = useState<"error" | "warning" | "info">(initial?.severity ?? "warning");
  const [scope, setScope] = useState(initial?.scope ?? "");
  const [createdBy, setCreatedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refine state
  const [refining, setRefining] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [originalBeforeRefine, setOriginalBeforeRefine] = useState<string | null>(null);

  const handleRefine = async () => {
    if (!description.trim()) return;
    setRefining(true);
    setSuggestion(null);
    setRefineError(null);
    try {
      const res = await api.refineRule(description, { name: name || undefined, scope: scope || undefined, severity });
      setSuggestion(res.refined);
      setOriginalBeforeRefine(description);
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : "Refinement failed");
    } finally {
      setRefining(false);
    }
  };

  const acceptSuggestion = () => {
    if (suggestion) {
      setDescription(suggestion);
      setSuggestion(null);
      setOriginalBeforeRefine(null);
    }
  };

  const dismissSuggestion = () => {
    setSuggestion(null);
    setOriginalBeforeRefine(null);
  };

  const revertToOriginal = () => {
    if (originalBeforeRefine !== null) {
      setDescription(originalBeforeRefine);
      setSuggestion(null);
      setOriginalBeforeRefine(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !description.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const rule = await api.addRule(name.trim(), description.trim(), severity, scope || undefined, createdBy || undefined);
      onAdded(rule as TeamRule);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-[520px] bg-[#0f1117] border border-[#30363d] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#21262d]">
          <div className="flex items-center gap-2">
            <ShieldAlert size={15} className="text-accent" />
            <h2 className="text-sm font-semibold text-[#e1e4e8]">
              {initial ? "Add Starter Rule" : "Add Rule"}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded text-[#484f58] hover:text-[#8b949e]">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-1.5">Rule Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="No one-line methods"
              className="w-full px-3 py-2 rounded-md border border-[#30363d] bg-[#161b22] text-xs text-[#c9d1d9] placeholder:text-[#484f58] focus:outline-none focus:border-accent/50"
              autoFocus
            />
          </div>

          {/* Description + Refine */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-medium text-[#484f58] uppercase tracking-wider">
                Rule Description
                <span className="ml-1 normal-case font-normal">— what the LLM looks for in your diff</span>
              </label>
              <button
                type="button"
                onClick={() => void handleRefine()}
                disabled={refining || !description.trim()}
                title="Let the LLM rewrite this into a precise, actionable rule"
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors",
                  refining
                    ? "border-accent/30 text-accent/60 cursor-wait"
                    : "border-[#30363d] text-[#8b949e] hover:border-accent/50 hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed",
                )}
              >
                {refining
                  ? <Loader2 size={10} className="animate-spin" />
                  : <Wand2 size={10} />
                }
                {refining ? "Refining…" : "Refine with AI"}
              </button>
            </div>

            <textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); setSuggestion(null); }}
              placeholder="Write roughly what you want — e.g. 'no long methods' or 'dont use one liners' — then hit Refine with AI to sharpen it."
              rows={3}
              className={cn(
                "w-full px-3 py-2.5 rounded-md border bg-[#161b22] text-xs text-[#c9d1d9] placeholder:text-[#484f58] resize-none focus:outline-none leading-relaxed transition-colors",
                suggestion ? "border-accent/30" : "border-[#30363d] focus:border-accent/50",
              )}
            />

            {/* AI suggestion card */}
            {suggestion && (
              <div className="mt-2 rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-accent">
                  <Wand2 size={11} />
                  AI suggestion
                  <span className="text-[#484f58] font-normal ml-1">— review and accept or dismiss</span>
                </div>
                <p className="text-xs text-[#c9d1d9] leading-relaxed">{suggestion}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={acceptSuggestion}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] bg-accent text-black font-medium hover:bg-accent-hover transition-colors"
                  >
                    <CheckCircle2 size={10} />
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={dismissSuggestion}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[#8b949e] hover:text-[#c9d1d9] transition-colors"
                  >
                    Keep mine
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRefine()}
                    disabled={refining}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[#484f58] hover:text-[#8b949e] transition-colors ml-auto"
                  >
                    <RotateCcw size={9} />
                    Try again
                  </button>
                </div>
              </div>
            )}

            {/* Revert link — shown after accepting a suggestion */}
            {!suggestion && originalBeforeRefine !== null && description !== originalBeforeRefine && (
              <button
                type="button"
                onClick={revertToOriginal}
                className="mt-1 flex items-center gap-1 text-[10px] text-[#484f58] hover:text-[#8b949e] transition-colors"
              >
                <RotateCcw size={9} />
                Revert to original
              </button>
            )}

            {refineError && (
              <p className="mt-1 text-[10px] text-danger flex items-center gap-1">
                <AlertTriangle size={10} />
                {refineError}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-1.5">Severity</label>
              <div className="flex gap-1.5 flex-wrap">
                {(["error", "warning", "info"] as const).map((s) => {
                  const cfg = SEVERITY_CONFIG[s];
                  return (
                    <label key={s} className={cn("flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] cursor-pointer transition-colors", severity === s ? cfg.badge : "border-[#30363d] text-[#8b949e] hover:border-[#484f58]")}>
                      <input type="radio" name="severity" value={s} checked={severity === s} onChange={() => setSeverity(s)} className="sr-only" />
                      {cfg.label}
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] text-[#484f58] mt-1">{SEVERITY_CONFIG[severity].desc}</p>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-1.5">Scope <span className="font-normal normal-case">(optional)</span></label>
              <input type="text" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="rails, react, go…" className="w-full px-3 py-2 rounded-md border border-[#30363d] bg-[#161b22] text-xs text-[#c9d1d9] placeholder:text-[#484f58] focus:outline-none focus:border-accent/50" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-1.5">Created by <span className="font-normal normal-case">(optional)</span></label>
            <input type="text" value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} placeholder="leo" className="w-full px-3 py-2 rounded-md border border-[#30363d] bg-[#161b22] text-xs text-[#c9d1d9] placeholder:text-[#484f58] focus:outline-none focus:border-accent/50" />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-danger/10 border border-danger/30 text-xs text-danger">
              <AlertTriangle size={12} />
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-3 py-2 rounded-md text-xs text-[#8b949e] border border-[#30363d] hover:border-[#484f58] transition-colors">Cancel</button>
            <button type="submit" disabled={saving || !name.trim() || !description.trim()} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs bg-accent text-black font-medium hover:bg-accent-hover transition-colors disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {saving ? "Saving…" : "Add Rule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run Check panel
// ---------------------------------------------------------------------------

interface CheckPanelProps {
  onClose: () => void;
}

function CheckPanel({ onClose }: CheckPanelProps) {
  const [base, setBase] = useState("main");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ passed: boolean; violations: RuleViolation[]; checked_rules?: number; files_checked?: number; message?: string; error?: string } | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await api.runCheck(undefined, base);
      setResult(res as typeof result);
    } catch (err) {
      setResult({ passed: false, violations: [], error: err instanceof Error ? err.message : "Check failed" });
    } finally {
      setRunning(false);
    }
  };

  const byFile = result?.violations
    ? Object.entries(
        result.violations.reduce<Record<string, RuleViolation[]>>((acc, v) => {
          (acc[v.file] ??= []).push(v);
          return acc;
        }, {})
      )
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-[600px] max-h-[80vh] bg-[#0f1117] border border-[#30363d] rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[#21262d]">
          <div className="flex items-center gap-2">
            <Play size={14} className="text-accent" />
            <h2 className="text-sm font-semibold text-[#e1e4e8]">Run Rule Check</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded text-[#484f58] hover:text-[#8b949e]"><X size={15} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-[10px] font-medium text-[#484f58] uppercase tracking-wider mb-1.5">Compare against branch</label>
              <input
                type="text"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder="main"
                className="w-full px-3 py-2 rounded-md border border-[#30363d] bg-[#161b22] text-xs text-[#c9d1d9] font-mono focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="pt-5">
              <button
                onClick={() => void run()}
                disabled={running}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-xs bg-accent text-black font-medium hover:bg-accent-hover transition-colors disabled:opacity-60"
              >
                {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                {running ? "Checking…" : "Run Check"}
              </button>
            </div>
          </div>

          <p className="text-[10px] text-[#484f58]">
            Diffs the current HEAD against the base branch and asks the LLM to find rule violations.
            Requires at least one registered repository with a git history.
          </p>

          {result && (
            <div className="space-y-3">
              <div className={cn(
                "flex items-center gap-2 p-3 rounded-lg border text-sm font-medium",
                result.error ? "border-danger/30 bg-danger/10 text-danger"
                  : result.passed ? "border-success/30 bg-success/10 text-success"
                  : "border-danger/30 bg-danger/10 text-danger",
              )}>
                {result.error ? <XCircle size={14} /> : result.passed ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                {result.error
                  ? result.error
                  : result.message
                  ? result.message
                  : result.passed
                  ? `All rules passed · ${result.files_checked ?? "?"} files checked`
                  : `${result.violations.length} violation${result.violations.length !== 1 ? "s" : ""} found`
                }
              </div>

              {byFile.map(([file, violations]) => (
                <div key={file} className="rounded-lg border border-[#30363d] bg-[#161b22] overflow-hidden">
                  <div className="px-3 py-2 bg-[#1c2333] text-[11px] font-mono text-[#8b949e] border-b border-[#30363d]">{file}</div>
                  <div className="divide-y divide-[#21262d]">
                    {violations.map((v, i) => {
                      const cfg = SEVERITY_CONFIG[v.severity] ?? SEVERITY_CONFIG.warning;
                      return (
                        <div key={i} className="px-3 py-2.5 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={cn("text-[9px] px-1.5 py-0.5 rounded border font-medium", cfg.badge)}>{cfg.label}</span>
                            <span className="text-xs text-[#c9d1d9] font-medium">{v.rule_name}</span>
                            {v.line && <span className="text-[10px] text-[#484f58] font-mono">line {v.line}</span>}
                          </div>
                          <p className="text-[11px] text-[#8b949e]">{v.explanation}</p>
                          {v.snippet && (
                            <code className="block text-[10px] text-[#484f58] font-mono bg-[#0f1117] px-2 py-1 rounded truncate">{v.snippet}</code>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Starter rules section
// ---------------------------------------------------------------------------

interface StarterSectionProps {
  existingNames: string[];
  onAdd: (template: RuleTemplate) => void;
}

function StarterSection({ existingNames, onAdd }: StarterSectionProps) {
  const [open, setOpen] = useState(false);
  const remaining = STARTER_RULES.filter((r) => !existingNames.includes(r.name.toLowerCase()));

  if (remaining.length === 0) return null;

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full px-4 py-3 hover:bg-[#1c2333]/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={13} className="text-accent" />
          <span className="text-xs font-medium text-[#c9d1d9]">Starter rules</span>
          <span className="text-[10px] text-[#484f58]">— common patterns, one click to add</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#484f58]">{remaining.length} available</span>
          {open ? <ChevronDown size={13} className="text-[#484f58]" /> : <ChevronRight size={13} className="text-[#484f58]" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-[#21262d] p-3 grid grid-cols-2 gap-2">
          {remaining.map((rule) => {
            const cfg = SEVERITY_CONFIG[rule.severity];
            return (
              <button
                key={rule.name}
                onClick={() => onAdd(rule)}
                className="flex items-start gap-2.5 p-3 rounded-lg border border-[#30363d] bg-[#0f1117] hover:border-accent/40 hover:bg-[#1c2333]/40 transition-all text-left group"
              >
                <span className="text-base flex-shrink-0">{rule.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-[#c9d1d9] group-hover:text-accent transition-colors">{rule.name}</span>
                    <span className={cn("text-[8px] px-1 py-0.5 rounded border", cfg.badge)}>{cfg.label}</span>
                  </div>
                  {rule.scope && <span className="text-[10px] text-[#484f58]">{rule.scope}</span>}
                  <p className="text-[10px] text-[#484f58] mt-0.5 leading-relaxed line-clamp-2">{rule.description}</p>
                </div>
                <Plus size={12} className="text-[#484f58] group-hover:text-accent flex-shrink-0 mt-0.5 transition-colors" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule row
// ---------------------------------------------------------------------------

function RuleRow({ rule, onToggle, onDelete }: { rule: TeamRule; onToggle: (id: string, en: boolean) => void; onDelete: (id: string) => void }) {
  const cfg = SEVERITY_CONFIG[rule.severity] ?? SEVERITY_CONFIG.warning;
  const SeverityIcon = cfg.icon;

  return (
    <div className={cn("flex items-start gap-3 px-4 py-3.5 border-b border-[#21262d] last:border-0 transition-opacity", !rule.enabled && "opacity-45")}>
      <SeverityIcon size={13} className={cn("flex-shrink-0 mt-0.5", cfg.text)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-xs font-medium", rule.enabled ? "text-[#e1e4e8]" : "text-[#484f58]")}>{rule.name}</span>
          <span className={cn("text-[9px] px-1.5 py-0.5 rounded border font-medium", cfg.badge)}>{cfg.label}</span>
          {rule.scope && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#1c2333] text-[#8b949e] border border-[#30363d]">{rule.scope}</span>}
          {rule.created_by && <span className="text-[10px] text-[#484f58]">by {rule.created_by}</span>}
        </div>
        <p className="text-[11px] text-[#8b949e] mt-0.5 leading-relaxed">{rule.description}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={() => onToggle(rule.id, !rule.enabled)} title={rule.enabled ? "Disable" : "Enable"} className="p-1.5 rounded text-[#484f58] hover:text-[#c9d1d9] hover:bg-[#1c2333] transition-colors">
          {rule.enabled ? <ToggleRight size={16} className="text-success" /> : <ToggleLeft size={16} />}
        </button>
        <button onClick={() => onDelete(rule.id)} title="Delete" className="p-1.5 rounded text-[#484f58] hover:text-danger hover:bg-danger/10 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rules page
// ---------------------------------------------------------------------------

export function Rules() {
  const [rules, setRules] = useState<TeamRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"add" | "import" | "check" | null>(null);
  const [starterTemplate, setStarterTemplate] = useState<RuleTemplate | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.rules()
      .then((r) => setRules(r as TeamRule[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const existingNames = rules.map((r) => r.name.toLowerCase());
  const enabledCount = rules.filter((r) => r.enabled).length;

  const handleToggle = async (id: string, enabled: boolean) => {
    await api.patchRule(id, { enabled: enabled ? 1 : 0 });
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled: enabled ? 1 : 0 } : r));
  };

  const handleDelete = async (id: string) => {
    await api.deleteRule(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleStarterClick = (template: RuleTemplate) => {
    setStarterTemplate(template);
    setModal("add");
  };

  const errorRules   = rules.filter((r) => r.severity === "error");
  const warningRules = rules.filter((r) => r.severity === "warning");
  const infoRules    = rules.filter((r) => r.severity === "info");

  return (
    <div>
      <div className="flex items-start justify-between mb-0">
        <PageHeader
          title="Team Rules"
          subtitle={rules.length > 0 ? `${rules.length} rule${rules.length !== 1 ? "s" : ""} · ${enabledCount} active` : undefined}
        />
        <div className="flex items-center gap-2 mt-1">
          {rules.length > 0 && (
            <button
              onClick={() => setModal("check")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#1c2333] border border-[#30363d] text-[#c9d1d9] hover:border-success/50 hover:text-success transition-colors"
            >
              <Play size={11} />
              Run Check
            </button>
          )}
          <button
            onClick={() => setModal("import")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#1c2333] border border-[#30363d] text-[#c9d1d9] hover:border-accent/50 hover:text-accent transition-colors"
          >
            <Upload size={11} />
            Import
          </button>
          <button
            onClick={() => { setStarterTemplate(null); setModal("add"); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-accent text-black font-medium hover:bg-accent-hover transition-colors"
          >
            <Plus size={11} />
            Add Rule
          </button>
        </div>
      </div>

      <div className="space-y-4 mt-4">
        {loading ? (
          <LoadingState rows={4} />
        ) : (
          <>
            {/* Starter rules (shown when no rules or as a helper) */}
            <StarterSection existingNames={existingNames} onAdd={handleStarterClick} />

            {rules.length === 0 ? (
              <EmptyState
                icon={<ShieldAlert size={32} />}
                title="No team rules yet"
                description="Add rules above, import a JSON file, or pick from the starter templates. Rules are checked by the LLM against the git diff before every push."
              />
            ) : (
              <>
                {[
                  { label: "Errors", items: errorRules, desc: "Block the push when violated" },
                  { label: "Warnings", items: warningRules, desc: "Advisory — non-blocking by default" },
                  { label: "Info", items: infoRules, desc: "Informational only" },
                ].map(({ label, items, desc }) =>
                  items.length > 0 ? (
                    <div key={label}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-medium text-[#484f58] uppercase tracking-wider">{label}</span>
                        <span className="text-[10px] text-[#30363d]">—</span>
                        <span className="text-[10px] text-[#484f58]">{desc}</span>
                      </div>
                      <div className="rounded-lg border border-[#30363d] bg-[#161b22] overflow-hidden">
                        {items.map((rule) => (
                          <RuleRow
                            key={rule.id}
                            rule={rule}
                            onToggle={(id, en) => void handleToggle(id, en)}
                            onDelete={(id) => void handleDelete(id)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {modal === "add" && (
        <AddRuleModal
          initial={starterTemplate ?? undefined}
          onClose={() => { setModal(null); setStarterTemplate(null); }}
          onAdded={(rule) => setRules((prev) => [...prev, rule])}
        />
      )}
      {modal === "import" && (
        <ImportModal
          existingNames={existingNames}
          onClose={() => setModal(null)}
          onImported={(updated) => setRules(updated)}
        />
      )}
      {modal === "check" && (
        <CheckPanel onClose={() => setModal(null)} />
      )}
    </div>
  );
}
