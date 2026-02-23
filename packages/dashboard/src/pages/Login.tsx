import { useState } from "react";
import { Mail, ArrowRight, CheckCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function Login() {
  const [email, setEmail] = useState("");
  const [tenant, setTenant] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !tenant.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await api.requestMagicLink(email.trim(), tenant.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send login link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-sm px-6">
        <div className="text-center mb-8">
          <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center mx-auto mb-4">
            <Mail size={20} className="text-black" />
          </div>
          <h1 className="text-xl font-bold text-[#e1e4e8]">Sign in to srcmap</h1>
          <p className="text-sm text-[#8b949e] mt-1">We'll send you a magic link to sign in.</p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-[#3fb950]/30 bg-[#3fb950]/5 p-6 text-center">
            <CheckCircle className="h-8 w-8 text-[#3fb950] mx-auto mb-3" />
            <p className="text-sm font-medium text-[#3fb950]">Check your email</p>
            <p className="text-xs text-[#8b949e] mt-2">
              We sent a sign-in link to <strong className="text-[#e1e4e8]">{email}</strong>.
              Click the link in your email to continue.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="tenant" className="mb-1 block text-xs font-medium text-[#8b949e]">
                Workspace slug
              </label>
              <input
                id="tenant"
                type="text"
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                placeholder="acme-corp"
                className={cn(
                  "w-full rounded-lg border border-[#30363d] bg-[#0f1117] px-3 py-2.5",
                  "text-sm text-[#e1e4e8] placeholder:text-[#484f58]",
                  "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                )}
              />
            </div>
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-medium text-[#8b949e]">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoFocus
                className={cn(
                  "w-full rounded-lg border border-[#30363d] bg-[#0f1117] px-3 py-2.5",
                  "text-sm text-[#e1e4e8] placeholder:text-[#484f58]",
                  "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                )}
              />
            </div>
            {error && <p className="text-sm text-[#f85149]">{error}</p>}
            <button
              type="submit"
              disabled={loading || !email.trim() || !tenant.trim()}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5",
                "text-sm font-semibold text-black transition-colors",
                "hover:bg-[#79b8ff] disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {loading ? "Sending..." : "Send magic link"}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-[#484f58] mt-6">
          Don't have a workspace? <a href="/onboard" className="text-accent hover:underline">Create one</a>
        </p>
      </div>
    </div>
  );
}
