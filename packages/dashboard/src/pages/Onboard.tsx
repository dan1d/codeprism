import { useState, useEffect } from "react";
import { Copy, Check, ArrowRight, ArrowLeft, Users, Sparkles, SkipForward, Terminal } from "lucide-react";
import { api, type TenantInfo, type FoundingStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

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
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ invited: number; skipped: number } | null>(null);
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

  const handleInvite = async () => {
    if (!result) return;
    const emails = inviteEmails
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (emails.length === 0) return;

    setInviting(true);
    try {
      // We need to auth first to call invite — use magic link flow
      // For now, send invites via the admin API key from the tenant creation
      const res = await api.inviteMembers(emails);
      setInviteResult({ invited: res.invited, skipped: res.skipped });
    } catch {
      setInviteResult({ invited: 0, skipped: 0 });
    } finally {
      setInviting(false);
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
  const hookCmd = `curl -fsSL https://raw.githubusercontent.com/codeprism/codeprism/main/scripts/install-hook.sh | sh -s -- --engine-url ${typeof window !== "undefined" ? window.location.origin : ""}`;

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
              Set up codeprism for your team. Takes less than a minute.
            </p>
            {founding?.founding && (
              <div className="mb-6 rounded-lg border border-[#3fb950]/30 bg-[#3fb950]/5 px-4 py-3">
                <p className="text-sm text-[#3fb950] font-medium">
                  Founding team offer — up to 10 developers free
                </p>
                <p className="text-xs text-[#8b949e] mt-1">
                  {founding.remaining} of {founding.limit} free spots remaining. No credit card needed.
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

              <div className="rounded-lg border border-[#30363d] bg-[#0f1117] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Terminal className="h-4 w-4 text-[#8b949e]" />
                  <span className="text-sm text-[#e1e4e8]">Auto-sync on git commit</span>
                  <span className="text-xs text-[#8b949e]">(works with any editor)</span>
                </div>
                <div className="flex items-center justify-between">
                  <code className="text-xs text-[#8b949e]">{hookCmd}</code>
                  <CopyButton text={hookCmd} />
                </div>
                <p className="mt-2 text-xs text-[#484f58]">
                  Run once per repo. Installs git hooks that sync your knowledge base after every merge, checkout and rebase.
                </p>
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

        {/* Step 2: Invite team */}
        {step === 2 && (
          <>
            <h2 className="mb-2 text-lg font-semibold text-[#e1e4e8] flex items-center gap-2">
              <Users size={18} /> Invite your team
            </h2>
            <p className="mb-6 text-sm text-[#8b949e]">
              Invite developers to join your workspace. They'll receive an email with setup instructions.
            </p>

            <textarea
              value={inviteEmails}
              onChange={(e) => setInviteEmails(e.target.value)}
              placeholder={"alice@company.com\nbob@company.com\ncharlie@company.com"}
              rows={5}
              className={cn(
                "w-full rounded-lg border border-[#30363d] bg-[#0f1117] px-4 py-3 mb-4",
                "text-sm text-[#e1e4e8] placeholder:text-[#484f58] resize-none",
                "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              )}
            />

            {inviteResult && (
              <div className="rounded-lg border border-[#3fb950]/30 bg-[#3fb950]/5 p-3 mb-4">
                <p className="text-sm text-[#3fb950]">
                  {inviteResult.invited} invitation(s) sent{inviteResult.skipped > 0 ? `, ${inviteResult.skipped} already members` : ""}
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteEmails.trim()}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3",
                  "text-sm font-semibold text-black transition-colors",
                  "hover:bg-[#79b8ff] disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {inviting ? "Sending..." : "Send invitations"}
              </button>
              <button
                onClick={() => setStep(3)}
                className={cn(
                  "flex items-center gap-1 rounded-lg border border-[#30363d] px-4 py-3",
                  "text-sm text-[#8b949e] hover:text-[#e1e4e8] hover:border-[#8b949e] transition-colors"
                )}
              >
                <SkipForward size={14} /> Skip
              </button>
            </div>
          </>
        )}

        {/* Step 3: Complete */}
        {step === 3 && result && (
          <>
            <div className="text-center mb-8">
              <Sparkles className="h-10 w-10 text-accent mx-auto mb-4" />
              <h2 className="text-xl font-bold text-[#e1e4e8]">You're all set!</h2>
              <p className="text-sm text-[#8b949e] mt-2">
                Your workspace is ready. Developers who accept their invitations will appear in your Team page.
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
