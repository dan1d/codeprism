import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, CheckCircle, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ForgotWorkspace() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.forgotWorkspace(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-sm px-6">
        <div className="text-center mb-8">
          <div className="w-10 h-10 rounded-lg bg-[#161b22] border border-[#30363d] flex items-center justify-center mx-auto mb-4">
            <Mail size={20} className="text-accent" />
          </div>
          <h1 className="text-xl font-bold text-[#e1e4e8]">Find your team</h1>
          <p className="text-sm text-[#8b949e] mt-1">
            Enter your email and we'll send you direct links to every codeprism workspace you're part of.
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-[#3fb950]/30 bg-[#3fb950]/5 p-6 text-center">
            <CheckCircle className="h-8 w-8 text-[#3fb950] mx-auto mb-3" />
            <p className="text-sm font-medium text-[#3fb950]">Email sent</p>
            <p className="text-xs text-[#8b949e] mt-2">
              If <strong className="text-[#e1e4e8]">{email}</strong> is associated with any workspaces,
              you'll receive an email with the links shortly.
            </p>
            <Link
              to="/login"
              className="mt-4 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
            >
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
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
                disabled={loading || !email.trim()}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5",
                  "text-sm font-semibold text-black transition-colors",
                  "hover:bg-[#79b8ff] disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {loading ? "Sending..." : "Send me my team links"}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-[#484f58]">
              <Link to="/login" className="flex items-center justify-center gap-1 text-accent hover:underline">
                <ArrowLeft className="h-3 w-3" /> Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
