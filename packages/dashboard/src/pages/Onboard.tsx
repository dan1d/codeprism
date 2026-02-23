import { useState } from "react";
import { Copy, Check, ArrowRight } from "lucide-react";
import { api, type TenantInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

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

export function Onboard() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TenantInfo | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const tenant = await api.createTenant(name.trim());
      setResult(tenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace");
    } finally {
      setLoading(false);
    }
  };

  const mcpJson = result
    ? JSON.stringify(
        {
          mcpServers: {
            srcmap: {
              url: result.mcpUrl,
              headers: { Authorization: `Bearer ${result.apiKey}` },
            },
          },
        },
        null,
        2
      )
    : "";

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-lg px-6 py-16">
        <h1 className="mb-2 text-2xl font-bold text-[#e1e4e8]">
          Get started with srcmap
        </h1>
        <p className="mb-8 text-sm text-[#8b949e]">
          Create a workspace to connect your AI tools.
        </p>

        {!result ? (
          <form onSubmit={handleSubmit}>
            <label
              htmlFor="team-name"
              className="mb-2 block text-sm font-medium text-[#e1e4e8]"
            >
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
            {error && (
              <p className="mt-2 text-sm text-[#f85149]">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className={cn(
                "mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3",
                "text-sm font-semibold text-white transition-colors",
                "hover:bg-[#79b8ff] disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {loading ? "Creating..." : "Create workspace"}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        ) : (
          <div className="space-y-6">
            <div className="rounded-lg border border-[#3fb950]/30 bg-[#3fb950]/5 p-4">
              <p className="text-sm font-medium text-[#3fb950]">
                Workspace created successfully
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm text-[#8b949e]">API Key</span>
                  <CopyButton text={result.apiKey} />
                </div>
                <code className="block rounded-lg border border-[#30363d] bg-[#0f1117] px-4 py-3 font-mono-nums text-sm text-[#e1e4e8] break-all">
                  {result.apiKey}
                </code>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm text-[#8b949e]">MCP URL</span>
                  <CopyButton text={result.mcpUrl} />
                </div>
                <code className="block rounded-lg border border-[#30363d] bg-[#0f1117] px-4 py-3 font-mono-nums text-sm text-[#e1e4e8] break-all">
                  {result.mcpUrl}
                </code>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-[#e1e4e8]">
                  Add this to your <code className="text-accent">.cursor/mcp.json</code>:
                </span>
                <CopyButton text={mcpJson} />
              </div>
              <pre className="rounded-lg border border-[#30363d] bg-[#0f1117] p-4 text-sm text-[#e1e4e8] overflow-x-auto">
                {mcpJson}
              </pre>
            </div>

            <a
              href={result.dashboardUrl}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-6 py-3",
                "text-sm font-semibold text-[#e1e4e8] hover:border-[#8b949e] transition-colors"
              )}
            >
              Open Dashboard
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
