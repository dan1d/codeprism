import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Copy, Check, ArrowRight, Loader2, AlertCircle, Terminal } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const EDITORS = [
  { id: "cursor",   label: "Cursor",     file: ".cursor/mcp.json" },
  { id: "windsurf", label: "Windsurf",   file: ".windsurf/mcp_config.json" },
  { id: "claude",   label: "Claude",     file: "~/.claude/claude_desktop_config.json" },
  { id: "zed",      label: "Zed",        file: "~/.config/zed/settings.json" },
  { id: "lovable",  label: "Lovable",    file: "Settings → Integrations → MCP" },
] as const;

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

export function AcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  const token = params.get("token");

  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeEditor, setActiveEditor] = useState<typeof EDITORS[number]["id"]>("cursor");
  const [verified, setVerified] = useState<{
    email: string;
    tenantName: string;
    tenantSlug: string;
  } | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Missing invitation token.");
      setVerifying(false);
      return;
    }

    api.verifyToken(token)
      .then((res) => {
        login(res.sessionToken, res.tenant.slug);
        setVerified({
          email: res.user.email,
          tenantName: res.tenant.name,
          tenantSlug: res.tenant.slug,
        });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Invalid or expired invitation link.");
      })
      .finally(() => setVerifying(false));
  }, [token]);

  const baseUrl = window.location.origin;
  const makeMcpConfig = (editorId: string) => {
    if (!verified) return "";
    const server = {
      url: `${baseUrl}/${verified.tenantSlug}/mcp/sse`,
      headers: {
        Authorization: "Bearer YOUR_TEAM_API_KEY",
        "X-Dev-Email": verified.email,
      },
    };
    if (editorId === "zed") {
      return JSON.stringify({ context_servers: { codeprism: server } }, null, 2);
    }
    return JSON.stringify({ mcpServers: { codeprism: server } }, null, 2);
  };
  const mcpConfig = makeMcpConfig(activeEditor);
  const hookCmd = `curl -fsSL https://raw.githubusercontent.com/codeprism/codeprism/main/scripts/install-hook.sh | sh -s -- --engine-url ${baseUrl}`;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-md px-6">
        {verifying && (
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-accent mx-auto mb-4" />
            <p className="text-sm text-[#8b949e]">Verifying your invitation...</p>
          </div>
        )}

        {error && (
          <div className="text-center">
            <AlertCircle className="h-8 w-8 text-[#f85149] mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-[#e1e4e8] mb-2">Invitation Error</h1>
            <p className="text-sm text-[#8b949e] mb-6">{error}</p>
            <a
              href="/login"
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border border-[#30363d] px-4 py-2",
                "text-sm text-[#8b949e] hover:text-[#e1e4e8] hover:border-[#8b949e] transition-colors"
              )}
            >
              Go to login
            </a>
          </div>
        )}

        {verified && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-10 h-10 rounded-lg bg-[#3fb950] flex items-center justify-center mx-auto mb-4">
                <Check size={20} className="text-black" />
              </div>
              <h1 className="text-xl font-bold text-[#e1e4e8]">Welcome to {verified.tenantName}!</h1>
              <p className="text-sm text-[#8b949e] mt-2">
                You've joined as <strong className="text-[#e1e4e8]">{verified.email}</strong>.
                Set up your editor to start using codeprism.
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
                <CopyButton text={mcpConfig} />
              </div>
              <pre className="rounded-lg border border-[#30363d] bg-[#0f1117] p-4 text-xs text-[#e1e4e8] overflow-x-auto">
                {mcpConfig}
              </pre>
              <p className="mt-2 text-xs text-[#d29922]">
                Replace <code>YOUR_TEAM_API_KEY</code> with the team API key from your admin.
              </p>
            </div>

            <div className="rounded-lg border border-[#30363d] bg-[#0f1117] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Terminal className="h-4 w-4 text-[#8b949e]" />
                <span className="text-sm text-[#e1e4e8]">Auto-sync on git commit</span>
              </div>
              <div className="flex items-center justify-between">
                <code className="text-xs text-[#8b949e]">{hookCmd}</code>
                <CopyButton text={hookCmd} />
              </div>
              <p className="mt-2 text-xs text-[#484f58]">
                Run once per repo. Works with any editor.
              </p>
            </div>

            <button
              onClick={() => navigate("/dashboard")}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3",
                "text-sm font-semibold text-black transition-colors hover:bg-[#79b8ff]"
              )}
            >
              Open Dashboard
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
