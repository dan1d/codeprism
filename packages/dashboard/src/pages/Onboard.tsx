import { useState, useEffect } from "react";
import { Copy, Check, ArrowRight, ArrowLeft, Users, Sparkles, Terminal } from "lucide-react";
import { api, type TenantInfo, type FoundingStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Mirror of the server-side generateSlug logic — keeps the preview accurate. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const SUPPORT_EMAIL = "support@codeprism.dev";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#1c2333] px-2 py-1",
        "text-xs text-[#8b949e] hover:border-[#8b949e] transition-colors"
      )}
    >
      {copied ? <Check className="h-3 w-3 text-[#3fb950]" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors",
            i <= current ? "bg-accent" : "bg-[#21262d]"
          )}
        />
      ))}
    </div>
  );
}

export function Onboard() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TenantInfo | null>(null);
  const [founding, setFounding] = useState<FoundingStatus | null>(null);

  useEffect(() => {
    api.foundingStatus().then(setFounding).catch(() => {});
  }, []);

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const tenant = await api.createTenant(name.trim(), email.trim());
      setResult(tenant);
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace");
    } finally {
      setLoading(false);
    }
  };

  const EDITORS = [
    { id: "cursor",      label: "Cursor",      file: ".cursor/mcp.json" },
    { id: "windsurf",    label: "Windsurf",     file: ".windsurf/mcp_config.json" },
    { id: "claude",      label: "Claude Code",  file: "~/.claude/claude_desktop_config.json" },
    { id: "zed",         label: "Zed",          file: "~/.config/zed/settings.json" },
    { id: "lovable",     label: "Lovable",      file: "Settings → Integrations → MCP" },
  ] as const;

  const [activeEditor, setActiveEditor] = useState<typeof EDITORS[number]["id"]>("cursor");

  const makeMcpJson = (editorId: string) => {
    if (!result) return "";
    const server = {
      url: result.mcpUrl,
      headers: {
        Authorization: `Bearer ${result.apiKey}`,
        "X-Dev-Email": email,
      },
    };
    if (editorId === "zed") {
      return JSON.stringify({ context_servers: { codeprism: server } }, null, 2);
    }
    return JSON.stringify({ mcpServers: { codeprism: server } }, null, 2);
  };

  const mcpJson = makeMcpJson(activeEditor);
  const engineUrl = typeof window !== "undefined" ? window.location.origin : "";
  const hookCmd = `curl -fsSL https://raw.githubusercontent.com/dan1d/codeprism/main/scripts/install-hook.sh | sh -s -- --engine-url ${engineUrl}`;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-lg px-6 py-16">
        <StepIndicator current={step} total={4} />

        {/* Step 0: Create workspace */}
        {step === 0 && (
          <>
            <h1 className="mb-2 text-2xl font-bold text-[#e1e4e8]">
              Create your workspace
            </h1>
            <p className="mb-4 text-sm text-[#8b949e]">
              Your team's shared AI memory, ready in under 2 minutes. No credit card.
            </p>
            {founding?.founding && (
              <div className="mb-6 rounded-lg border border-[#3fb950]/30 bg-[#3fb950]/5 px-4 py-3">
                <p className="text-sm text-[#3fb950] font-medium">
                  Founding team — up to 10 developers, free forever
                </p>
                <p className="text-xs text-[#8b949e] mt-1">
                  {founding.remaining} of {founding.limit} spots left. First come, first served.
                </p>
              </div>
            )}

            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div>
                <label htmlFor="team-name" className="mb-1 block text-sm font-medium text-[#e1e4e8]">
                  Company or team name
                </label>
                <input
                  id="team-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Corp"
                  autoFocus
                  className={cn(
                    "w-full rounded-lg border border-[#30363d] bg-[#0f1117] px-4 py-3",
                    "text-[#e1e4e8] placeholder:text-[#484f58]",
                    "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  )}
                />
                {name.trim() && (
                  <p className="mt-1.5 text-xs text-[#484f58]">
                    Your workspace URL:{" "}
                    <span className="font-mono text-[#8b949e]">
                      codeprism.dev/<span className="text-accent">{toSlug(name.trim())}</span>
                    </span>
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="admin-email" className="mb-1 block text-sm font-medium text-[#e1e4e8]">
                  Your email (admin)
                </label>
                <input
                  id="admin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className={cn(
                    "w-full rounded-lg border border-[#30363d] bg-[#0f1117] px-4 py-3",
                    "text-[#e1e4e8] placeholder:text-[#484f58]",
                    "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  )}
                />
              </div>
              {error && <p className="text-sm text-[#f85149]">{error}</p>}
              <button
                type="submit"
                disabled={loading || !name.trim() || !email.trim()}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3",
                  "text-sm font-semibold text-black transition-colors",
                  "hover:bg-[#79b8ff] disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {loading ? "Creating..." : "Create workspace"}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
          </>
        )}

        {/* Step 1: API Key + MCP Config */}
        {step === 1 && result && (
          <>
            <div className="rounded-lg border border-[#3fb950]/30 bg-[#3fb950]/5 p-4 mb-6">
              <p className="text-sm font-medium text-[#3fb950]">Workspace created successfully</p>
              {founding?.founding && (
                <p className="text-xs text-[#8b949e] mt-1">You're a founding team — up to 10 developers free forever.</p>
              )}
            </div>

            <h2 className="mb-4 text-lg font-semibold text-[#e1e4e8]">Your API Key</h2>

            <div className="space-y-4 mb-6">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm text-[#8b949e]">API Key</span>
                  <CopyButton text={result.apiKey} />
                </div>
                <code className="block rounded-lg border border-[#30363d] bg-[#0f1117] px-4 py-3 font-mono text-sm text-[#e1e4e8] break-all">
                  {result.apiKey}
                </code>
                <p className="mt-1 text-xs text-[#d29922]">
                  Save this key now. It won't be shown again.
                </p>
              </div>

              <div>
                <p className="mb-2 text-sm text-[#e1e4e8]">Add to your AI editor</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {EDITORS.map((ed) => (
                    <button
                      key={ed.id}
                      onClick={() => setActiveEditor(ed.id)}
                      className={cn(
                        "rounded px-3 py-1 text-xs font-medium transition-colors",
                        activeEditor === ed.id
                          ? "bg-accent text-black"
                          : "border border-[#30363d] text-[#8b949e] hover:border-[#8b949e]"
                      )}
                    >
                      {ed.label}
                    </button>
                  ))}
                </div>
                <div className="mb-2 flex items-center justify-between">
                  <code className="text-xs text-[#8b949e]">
                    {EDITORS.find((e) => e.id === activeEditor)?.file}
                  </code>
                  <CopyButton text={mcpJson} />
                </div>
                <pre className="rounded-lg border border-[#30363d] bg-[#0f1117] p-4 text-xs text-[#e1e4e8] overflow-x-auto">
                  {mcpJson}
                </pre>
              </div>

              <div className="rounded-lg border border-[#30363d] bg-[#0f1117] p-4 space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-[#8b949e]" />
                    <span className="text-sm font-medium text-[#e1e4e8]">Auto-sync on git commit</span>
                    <span className="text-xs text-[#484f58]">works with any editor</span>
                  </div>
                  <CopyButton text={hookCmd} />
                </div>

                {/* Command block */}
                <pre className="rounded border border-[#21262d] bg-[#161b22] px-3 py-2.5 text-xs text-[#8b949e] whitespace-pre-wrap break-all leading-relaxed">
                  {hookCmd}
                </pre>

                <p className="text-xs text-[#484f58]">
                  Run once per repo. Installs git hooks that sync after every merge, checkout, and rebase.
                </p>

                {/* Branch awareness */}
                <div className="pt-1 border-t border-[#21262d]">
                  <p className="text-xs text-[#8b949e] mb-2 font-medium">Branch-aware context</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {["main", "feature/auth-v2", "hotfix/login-fix", "release/2.1", "staging", "demo"].map((b) => (
                      <span key={b} className="inline-flex items-center rounded-full border border-[#30363d] bg-[#21262d] px-2.5 py-0.5 text-[11px] font-mono text-[#8b949e]">
                        {b}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-[#484f58]">
                    Each branch gets its own isolated context — <code className="font-mono">feature/*</code>, <code className="font-mono">hotfix/*</code>, <code className="font-mono">release/*</code> globs all supported. Merged changes propagate to main automatically.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3",
                "text-sm font-semibold text-black transition-colors hover:bg-[#79b8ff]"
              )}
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}

        {/* Step 2: Invite team — this is where the value actually kicks in */}
        {step === 2 && result && (
          <>
            <div className="rounded-lg border border-[#3fb950]/30 bg-[#3fb950]/5 px-5 py-4 mb-6">
              <p className="text-sm font-semibold text-[#3fb950] flex items-center gap-2">
                <Users size={16} /> This is where codeprism gets powerful.
              </p>
              <p className="text-xs text-[#8b949e] mt-1.5 leading-relaxed">
                One developer using codeprism is useful. A whole team sharing the same knowledge graph is transformative — every AI session starts with what your team already knows.
              </p>
            </div>

            <h2 className="mb-1 text-lg font-semibold text-[#e1e4e8]">Invite your team</h2>
            <p className="mb-5 text-sm text-[#8b949e]">
              Share your workspace link. Each dev adds the MCP config to their AI tool — that's it.
            </p>

            <div className="rounded-lg border border-[#30363d] bg-[#0f1117] p-4 mb-4">
              <p className="text-xs text-[#8b949e] mb-2">Your team's workspace</p>
              <div className="flex items-center justify-between gap-2">
                <code className="text-sm text-[#e1e4e8] break-all">{result.dashboardUrl}</code>
                <CopyButton text={result.dashboardUrl} />
              </div>
            </div>

            <div className="rounded-lg border border-[#30363d] bg-[#0f1117] p-4 mb-6 text-xs text-[#8b949e] space-y-1.5">
              <p>Send teammates the workspace link above. They sign in, add the MCP config from step 1 to their editor, and they're sharing context with you immediately.</p>
              <p>You can also send formal email invitations from <strong className="text-[#c9d1d9]">Team → Invite developers</strong> once you've logged in.</p>
            </div>

            <button
              onClick={() => setStep(3)}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3",
                "text-sm font-semibold text-black transition-colors hover:bg-[#79b8ff]"
              )}
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}

        {/* Step 3: Complete */}
        {step === 3 && result && (
          <>
            <div className="text-center mb-8">
              <Sparkles className="h-10 w-10 text-accent mx-auto mb-4" />
              <h2 className="text-xl font-bold text-[#e1e4e8]">Workspace ready.</h2>
              <p className="text-sm text-[#8b949e] mt-2 max-w-sm mx-auto">
                Run <code className="text-accent text-xs">pnpm index</code> inside your repo
                to build the first knowledge graph. After that, every AI query your team makes
                gets instant context — no raw file dumps.
              </p>
              <p className="text-xs text-[#484f58] mt-3">
                Invited developers will appear in your Team page once they accept.
              </p>
            </div>

            <div className="space-y-3">
              <a
                href={result.dashboardUrl}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3",
                  "text-sm font-semibold text-black transition-colors hover:bg-[#79b8ff]"
                )}
              >
                Open Dashboard
                <ArrowRight className="h-4 w-4" />
              </a>
              <button
                onClick={() => setStep(1)}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-lg border border-[#30363d] px-6 py-3",
                  "text-sm text-[#8b949e] hover:text-[#e1e4e8] hover:border-[#8b949e] transition-colors"
                )}
              >
                <ArrowLeft className="h-4 w-4" /> Back to API key
              </button>
            </div>

            <p className="mt-6 text-center text-xs text-[#484f58]">
              Need help? <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent hover:underline">{SUPPORT_EMAIL}</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
