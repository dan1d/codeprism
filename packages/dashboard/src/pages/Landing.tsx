import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, GitBranch, Zap } from "lucide-react";
import { api, type PublicStats } from "@/lib/api";
import { formatTokens, stackColor, cn } from "@/lib/utils";

const FRAMEWORKS = [
  "Rails", "React", "Vue", "Next.js", "Django", "FastAPI",
  "Go", "Laravel", "NestJS", "Angular", "Svelte", "Spring", "Lambda",
];

const HOW_IT_WORKS = [
  {
    title: "Parse",
    description:
      "Tree-sitter extracts structure from Ruby, JS/TS, Vue, Python, Go",
    icon: FileText,
  },
  {
    title: "Graph",
    description:
      "Louvain community detection finds natural feature flows across repos",
    icon: GitBranch,
  },
  {
    title: "Serve",
    description:
      "Your AI calls srcmap_search() and gets a 200-token card instead of reading 15 files",
    icon: Zap,
  },
];

export function Landing() {
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    api.publicStats().then(setStats).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section
        className="relative px-6 py-24 text-center"
        style={{
          background: "linear-gradient(180deg, #0f1117 0%, #161b22 100%)",
        }}
      >
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight text-[#e1e4e8] sm:text-5xl">
          Your AI already knows how to code.
          <br />
          It just doesn't know{" "}
          <span className="text-accent">YOUR</span> code.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-[#8b949e]">
          srcmap builds a knowledge graph of your codebase and serves it to your
          AI via MCP. 200 tokens instead of 7,000.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            to="/onboard"
            className={cn(
              "rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white",
              "hover:bg-[#79b8ff] transition-colors"
            )}
          >
            Get Started Free
          </Link>
          <a
            href="https://github.com/srcmap/srcmap"
            className={cn(
              "rounded-lg border border-[#30363d] bg-[#161b22] px-6 py-3 text-sm font-semibold text-[#e1e4e8]",
              "hover:border-[#8b949e] transition-colors"
            )}
          >
            Self-Host
          </a>
        </div>
      </section>

      {/* Live stats strip */}
      {stats && (
        <div className="border-y border-[#30363d] bg-[#161b22] px-6 py-4">
          <p className="text-center text-sm font-mono-nums text-[#8b949e]">
            {formatTokens(stats.totalTokensSaved)} tokens saved
            <span className="mx-3 text-[#30363d]">|</span>
            {formatTokens(stats.totalQueries)} queries
            <span className="mx-3 text-[#30363d]">|</span>
            {stats.activeInstances.toLocaleString()} instances
          </p>
        </div>
      )}

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="mb-10 text-center text-2xl font-bold text-[#e1e4e8]">
          How it works
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {HOW_IT_WORKS.map((step) => (
            <div
              key={step.title}
              className="rounded-lg border border-[#30363d] bg-[#161b22] p-6"
            >
              <step.icon className="mb-4 h-6 w-6 text-accent" />
              <h3 className="mb-2 text-lg font-semibold text-[#e1e4e8]">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-[#8b949e]">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Self-host vs Hosted */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <h2 className="mb-10 text-center text-2xl font-bold text-[#e1e4e8]">
          Deploy your way
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-6">
            <h3 className="mb-4 text-lg font-semibold text-[#e1e4e8]">
              Self-hosted
            </h3>
            <ul className="space-y-3 text-sm text-[#8b949e]">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fb950]" />
                <code className="text-[#e1e4e8]">docker compose up -d</code>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fb950]" />
                Your server, your data
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fb950]" />
                Free forever
              </li>
            </ul>
          </div>
          <div className="rounded-lg border border-accent/50 bg-[#161b22] p-6">
            <h3 className="mb-4 text-lg font-semibold text-[#e1e4e8]">
              Hosted
            </h3>
            <ul className="space-y-3 text-sm text-[#8b949e]">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                One-click setup
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                We handle infrastructure
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                Free tier available
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Supported frameworks */}
      <section className="border-t border-[#30363d] px-6 py-10">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-2">
          {FRAMEWORKS.map((fw) => (
            <span
              key={fw}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                stackColor(fw)
              )}
            >
              {fw}
            </span>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#30363d] px-6 py-6">
        <div className="flex items-center justify-center gap-4 text-sm text-[#8b949e]">
          <span>AGPL-3.0</span>
          <span className="text-[#30363d]">|</span>
          <a
            href="https://github.com/srcmap/srcmap"
            className="hover:text-accent transition-colors"
          >
            GitHub
          </a>
          <span className="text-[#30363d]">|</span>
          <a
            href="https://docs.srcmap.ai"
            className="hover:text-accent transition-colors"
          >
            Documentation
          </a>
        </div>
      </footer>
    </div>
  );
}
