import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  FileText, GitBranch, Zap, Users, RefreshCw, Brain,
  TrendingDown, Target, Cpu, ChevronDown, AlertTriangle, Github, MessageCircle, Check,
  ArrowRight, Menu, X,
} from "lucide-react";
import { api, type PublicStats, type FoundingStatus, type BenchmarkResponse } from "@/lib/api";
import { formatTokens, stackColor, cn } from "@/lib/utils";
import { PrismLogo } from "@/components/shared/PrismLogo";

const SUPPORT_EMAIL = "support@codeprism.dev";
const GITHUB_URL = "https://github.com/dan1d/codeprism";
const DISCORD_URL = "https://discord.gg/nsWERSde";

const NAV_LINKS = [
  { label: "Pricing", anchor: "pricing" },
  { label: "FAQ", anchor: "faq" },
] as const;

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Close mobile menu on route change / outside click via Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mobileOpen]);

  return (
    <header
      className={cn(
        "fixed top-0 inset-x-0 z-50 transition-all duration-200",
        scrolled || mobileOpen
          ? "bg-[#0d1117]/95 backdrop-blur-md border-b border-[#21262d] shadow-lg shadow-black/20"
          : "bg-transparent"
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 h-16">
        {/* Logo */}
        <Link to="/" className="group" onClick={() => setMobileOpen(false)}>
          <PrismLogo
            wordmark
            className="h-8 w-8 flex-shrink-0"
            wordmarkClassName="text-lg group-hover:text-white transition-colors"
          />
        </Link>

        {/* Center nav — desktop only */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(({ label, anchor }) => (
            <a
              key={anchor}
              href={`#${anchor}`}
              onClick={(e) => { e.preventDefault(); scrollTo(anchor); }}
              className="px-3 py-2 text-sm text-[#8b949e] hover:text-[#e1e4e8] transition-colors rounded-md hover:bg-[#21262d]"
            >
              {label}
            </a>
          ))}
          <Link to="/terms" className="px-3 py-2 text-sm text-[#8b949e] hover:text-[#e1e4e8] transition-colors rounded-md hover:bg-[#21262d]">
            Terms
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-[#8b949e] hover:text-[#e1e4e8] transition-colors rounded-md hover:bg-[#21262d]"
          >
            <Github className="h-3.5 w-3.5" />
            Open source
          </a>
        </nav>

        {/* Right CTAs */}
        <div className="flex items-center gap-2">
          {/* Log in is intentionally low-contrast — primary action is Get started */}
          <Link to="/login" className="hidden sm:block px-4 py-2 text-sm text-[#484f58] hover:text-[#8b949e] transition-colors">
            Log in
          </Link>
          <Link to="/onboard" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-[#79b8ff] transition-colors">
            Get started →
          </Link>
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden ml-1 p-2 rounded-md text-[#8b949e] hover:text-[#e1e4e8] hover:bg-[#21262d] transition-colors"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <nav className="md:hidden border-t border-[#21262d] px-6 py-4 flex flex-col gap-1">
          {NAV_LINKS.map(({ label, anchor }) => (
            <a
              key={anchor}
              href={`#${anchor}`}
              onClick={(e) => { e.preventDefault(); scrollTo(anchor); setMobileOpen(false); }}
              className="px-3 py-2.5 text-sm text-[#8b949e] hover:text-[#e1e4e8] transition-colors rounded-md hover:bg-[#21262d]"
            >
              {label}
            </a>
          ))}
          <Link to="/terms" onClick={() => setMobileOpen(false)} className="px-3 py-2.5 text-sm text-[#8b949e] hover:text-[#e1e4e8] transition-colors rounded-md hover:bg-[#21262d]">
            Terms
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-[#8b949e] hover:text-[#e1e4e8] transition-colors rounded-md hover:bg-[#21262d]"
          >
            <Github className="h-3.5 w-3.5" /> Open source
          </a>
          <div className="border-t border-[#21262d] mt-2 pt-2">
            <Link to="/login" onClick={() => setMobileOpen(false)} className="block px-3 py-2.5 text-sm text-[#484f58] hover:text-[#8b949e] transition-colors rounded-md">
              Log in
            </Link>
            <Link to="/onboard" onClick={() => setMobileOpen(false)} className="mt-1 block rounded-lg bg-accent px-4 py-2.5 text-center text-sm font-semibold text-black hover:bg-[#79b8ff] transition-colors">
              Get started →
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

const FRAMEWORKS = [
  "Rails", "React", "Vue", "Next.js", "Django", "FastAPI",
  "Go", "Laravel", "NestJS", "Angular", "Svelte", "Spring", "Lambda",
  "Express", "Fastify", "Sinatra",
];

const HOW_IT_WORKS = [
  {
    title: "Parse",
    description:
      "Your repos are parsed into a living knowledge graph — models, routes, flows, and dependencies — across Ruby, JS/TS, Python, Go, PHP, and more. No config required.",
    icon: FileText,
  },
  {
    title: "Learn",
    description:
      "codeprism maps your real architectural flows automatically. Every time a developer verifies or corrects a card, the knowledge base gets sharper for everyone.",
    icon: GitBranch,
  },
  {
    title: "Answer",
    description:
      "Any AI tool calls codeprism via MCP and gets a focused ~350-token knowledge card instead of re-reading 15 raw files — faster answers, lower costs.",
    icon: Zap,
  },
];

const TEAM_BENEFITS = [
  {
    title: "One discovery. Zero re-discoveries.",
    description:
      "When Alice figures out how the billing flow works in Cursor, that knowledge is immediately available to Bob in Claude Code and Charlie in Windsurf. Nobody starts from zero.",
    icon: Users,
  },
  {
    title: "Every session starts with full context",
    description:
      "AI tools forget everything the moment you close the tab. codeprism gives every new session the accumulated knowledge of your entire team — accumulated over months, not rebuilt from scratch each time.",
    icon: Brain,
  },
  {
    title: "Gets smarter the more you use it",
    description:
      "Month 6 is dramatically better than month 1. Every verified card, every saved insight, every answered question makes the whole team's AI sharper — compounding over time.",
    icon: RefreshCw,
  },
];

// LLM pricing per million input tokens (approximate, 2025)
const LLM_MODELS = [
  { id: "claude-sonnet", label: "Claude 3.5 Sonnet", pricePerMillion: 3.0 },
  { id: "gpt4o", label: "GPT-4o", pricePerMillion: 2.5 },
  { id: "claude-haiku", label: "Claude 3.5 Haiku", pricePerMillion: 0.8 },
  { id: "gemini-pro", label: "Gemini 1.5 Pro", pricePerMillion: 1.25 },
  { id: "deepseek", label: "DeepSeek V3", pricePerMillion: 0.27 },
  { id: "gpt4o-mini", label: "GPT-4o mini", pricePerMillion: 0.15 },
];

// Average tokens per query without / with codeprism (based on benchmarks)
const AVG_TOKENS_WITHOUT = 4500; // naive file dump
const AVG_TOKENS_WITH = 350;     // codeprism card
const REDUCTION_PCT = Math.round((1 - AVG_TOKENS_WITH / AVG_TOKENS_WITHOUT) * 100); // ~92%

function formatMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

function SavingsCalculator() {
  const [queries, setQueries] = useState(50);
  const [teamSize, setTeamSize] = useState(5);
  const [modelIdx, setModelIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const model = LLM_MODELS[modelIdx];
  const tokensWithout = queries * teamSize * 30 * AVG_TOKENS_WITHOUT;
  const tokensWith = queries * teamSize * 30 * AVG_TOKENS_WITH;
  const tokensSaved = tokensWithout - tokensWith;
  const costWithout = (tokensWithout / 1_000_000) * model.pricePerMillion;
  const costWith = (tokensWith / 1_000_000) * model.pricePerMillion;
  const costSaved = costWithout - costWith;

  return (
    <div className="rounded-xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
      {/* Controls */}
      <div className="px-6 py-6 border-b border-[#21262d]">
        <h3 className="text-sm font-semibold text-[#e1e4e8] mb-5">
          Your team's monthly AI spend, before and after
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {/* Queries/day */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-[#8b949e]">AI queries / day / dev</label>
              <span className="text-xs font-mono font-bold text-accent">{queries}</span>
            </div>
            <input
              type="range"
              min={5}
              max={200}
              step={5}
              value={queries}
              onChange={(e) => setQueries(Number(e.target.value))}
              className="w-full accent-accent h-1.5 rounded cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[#484f58] mt-1">
              <span>5</span><span>200</span>
            </div>
          </div>

          {/* Team size */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-[#8b949e]">Developers</label>
              <span className="text-xs font-mono font-bold text-accent">{teamSize}</span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              step={1}
              value={teamSize}
              onChange={(e) => setTeamSize(Number(e.target.value))}
              className="w-full accent-accent h-1.5 rounded cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[#484f58] mt-1">
              <span>1</span><span>50</span>
            </div>
          </div>

          {/* Model picker */}
          <div>
            <label className="text-xs text-[#8b949e] mb-2 block">LLM model</label>
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setOpen(!open)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 rounded-lg",
                  "border border-[#30363d] bg-[#161b22] text-sm text-[#e1e4e8]",
                  "hover:border-[#8b949e] transition-colors"
                )}
              >
                <span>{model.label}</span>
                <ChevronDown className="h-3.5 w-3.5 text-[#8b949e]" />
              </button>
              {open && (
                <div className="absolute top-full mt-1 w-full rounded-lg border border-[#30363d] bg-[#161b22] z-10 overflow-hidden">
                  {LLM_MODELS.map((m, i) => (
                    <button
                      key={m.id}
                      onClick={() => { setModelIdx(i); setOpen(false); }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm transition-colors",
                        i === modelIdx
                          ? "bg-accent/10 text-accent"
                          : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e1e4e8]"
                      )}
                    >
                      <span>{m.label}</span>
                      <span className="ml-2 text-[#484f58] text-xs">${m.pricePerMillion}/M tokens</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#21262d]">
        <div className="px-6 py-8 text-center">
          <p className="text-xs uppercase tracking-wider text-[#484f58] mb-2">Tokens saved / mo</p>
          <p className="text-4xl font-bold text-accent">{formatTokens(tokensSaved)}</p>
          <p className="text-xs text-[#8b949e] mt-1">{REDUCTION_PCT}% reduction</p>
        </div>
        <div className="px-6 py-8 text-center">
          <p className="text-xs uppercase tracking-wider text-[#484f58] mb-2">Cost saved / mo</p>
          <p className="text-4xl font-bold text-[#3fb950]">{formatMoney(costSaved)}</p>
          <p className="text-xs text-[#8b949e] mt-1">{formatMoney(costWith)} remaining</p>
        </div>
        <div className="px-6 py-8 text-center">
          <p className="text-xs uppercase tracking-wider text-[#484f58] mb-2">Without codeprism</p>
          <p className="text-4xl font-bold text-[#f85149]">{formatMoney(costWithout)}</p>
          <p className="text-xs text-[#8b949e] mt-1">{formatTokens(tokensWithout)} tokens</p>
        </div>
        <div className="px-6 py-8 text-center">
          <p className="text-xs uppercase tracking-wider text-[#484f58] mb-2">With codeprism</p>
          <p className="text-4xl font-bold text-[#e1e4e8]">{formatMoney(costWith)}</p>
          <p className="text-xs text-[#8b949e] mt-1">{formatTokens(tokensWith)} tokens</p>
        </div>
      </div>

      {/* CTA bar */}
      <div className="px-6 py-4 bg-[#0f1117] border-t border-[#21262d] flex items-center justify-between gap-4">
        <p className="text-xs text-[#8b949e]">
          Based on {REDUCTION_PCT}% average token reduction across benchmarked open-source projects.
          <Link to="/benchmarks" className="ml-1 text-accent hover:underline">See benchmarks →</Link>
        </p>
        <Link
          to="/onboard"
          className={cn(
            "shrink-0 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black",
            "hover:bg-[#79b8ff] transition-colors"
          )}
        >
          Start free →
        </Link>
      </div>
    </div>
  );
}

export function Landing() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [founding, setFounding] = useState<FoundingStatus | null>(null);
  const [bench, setBench] = useState<BenchmarkResponse | null>(null);

  useEffect(() => {
    api.publicStats().then(setStats).catch(() => {});
    api.foundingStatus().then(setFounding).catch(() => {});
    api.benchmarks().then(setBench).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section
        className="relative px-6 pt-40 pb-32 text-center"
        style={{ background: "linear-gradient(180deg, #0f1117 0%, #161b22 100%)" }}
      >
        {/* Badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-[#30363d] bg-[#161b22] px-4 py-1.5 text-sm text-[#8b949e] mb-8">
          <span className="h-2 w-2 rounded-full bg-[#3fb950] animate-pulse" />
          <span>Open source · Frontend + backend share one brain · Cursor · Claude Code · Windsurf · Zed</span>
        </div>

        <h1 className="mx-auto max-w-4xl text-5xl font-bold leading-tight text-[#e1e4e8] sm:text-6xl lg:text-7xl">
          Your AI forgets everything{" "}
          <span className="text-accent">between sessions.</span>
        </h1>
        <p className="mx-auto mt-8 max-w-2xl text-xl text-[#8b949e] leading-relaxed">
          codeprism is a{" "}
          <span className="text-[#e1e4e8] font-semibold">persistent knowledge layer</span> for AI coding tools.
          Your team's architectural decisions, flows, and context — indexed once, available to every developer
          in every AI tool, forever.
        </p>
        <p className="mx-auto mt-4 max-w-xl text-base text-[#484f58] leading-relaxed">
          The only tool that bridges your frontend and backend repos into a{" "}
          <span className="text-[#8b949e]">single shared brain</span> — so your React component and the Rails controller it calls are always in the same answer.
        </p>

        <div className="mt-12 flex flex-col items-center gap-5">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/onboard"
              className={cn(
                "rounded-lg bg-accent px-8 py-4 text-base font-semibold text-black",
                "hover:bg-[#79b8ff] transition-colors shadow-lg shadow-accent/20"
              )}
            >
              Set up your team's shared memory
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "rounded-lg border border-[#30363d] bg-[#161b22] px-8 py-4 text-base font-semibold text-[#e1e4e8]",
                "hover:border-[#8b949e] transition-colors"
              )}
            >
              Self-Host Free
            </a>
          </div>
          {founding?.founding && (
            <p className="text-base text-[#3fb950] font-medium">
              First 100 teams: up to 10 devs free — {founding.remaining} spots remaining
            </p>
          )}
        </div>

        {/* Real-world proof point */}
        <div className="mx-auto mt-14 max-w-3xl rounded-xl border border-[#30363d] bg-[#0d1117] px-6 py-5 text-left">
          <p className="text-xs text-[#484f58] uppercase tracking-wider mb-4">Real benchmark · Express.js · "Trace how a 404 error propagates through middleware"</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#f85149] uppercase tracking-wide">Without codeprism</p>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-[#e1e4e8]">42k</span>
                <span className="text-sm text-[#8b949e]">tokens consumed</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-[#e1e4e8]">31s</span>
                <span className="text-sm text-[#8b949e]">to first answer</span>
              </div>
              <p className="text-xs text-[#484f58]">Missed the <code className="font-mono">finalhandler</code> package — answer was incomplete</p>
            </div>
            <div className="space-y-2 sm:border-l sm:border-[#21262d] sm:pl-4">
              <p className="text-xs font-semibold text-[#3fb950] uppercase tracking-wide">With codeprism</p>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-[#e1e4e8]">3.1k</span>
                <span className="text-sm text-[#8b949e]">tokens consumed</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-[#e1e4e8]">4s</span>
                <span className="text-sm text-[#8b949e]">to first answer</span>
              </div>
              <p className="text-xs text-[#484f58]">Complete path including <code className="font-mono">finalhandler</code> — correct on first try</p>
            </div>
          </div>
        </div>

        {/* Pain → Solution visual */}
        <div className="mx-auto mt-10 max-w-4xl grid grid-cols-1 sm:grid-cols-2 gap-6 text-left">
          {/* Without */}
          <div className="rounded-xl border border-[#f85149]/30 bg-[#0d1117] overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-[#21262d] bg-[#161b22]">
              <AlertTriangle className="h-5 w-5 text-[#f85149]" />
              <span className="text-base font-semibold text-[#f85149]">Without codeprism</span>
            </div>
            <ul className="px-6 py-6 space-y-5 text-base text-[#8b949e] leading-relaxed">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-[#f85149] text-lg font-bold shrink-0">✗</span>
                Alice figures out the billing flow. Bob re-discovers it tomorrow.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-[#f85149] text-lg font-bold shrink-0">✗</span>
                Cursor and Claude give different architectural answers.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-[#f85149] text-lg font-bold shrink-0">✗</span>
                New devs ask AI and get wrong answers — context is missing.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-[#f85149] text-lg font-bold shrink-0">✗</span>
                4,500 tokens of raw files dumped into every query.
              </li>
            </ul>
          </div>
          {/* With */}
          <div className="rounded-xl border border-[#3fb950]/30 bg-[#0d1117] overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-[#21262d] bg-[#161b22]">
              <Brain className="h-5 w-5 text-[#3fb950]" />
              <span className="text-base font-semibold text-[#3fb950]">With codeprism</span>
            </div>
            <ul className="px-6 py-6 space-y-5 text-base text-[#c9d1d9] leading-relaxed">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-[#3fb950] text-lg font-bold shrink-0">✓</span>
                One shared knowledge graph — visible to every tool, every dev.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-[#3fb950] text-lg font-bold shrink-0">✓</span>
                Consistent architectural answers across Cursor, Claude, Windsurf.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-[#3fb950] text-lg font-bold shrink-0">✓</span>
                New devs get the team's accumulated knowledge from day one.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-[#3fb950] text-lg font-bold shrink-0">✓</span>
                ~{REDUCTION_PCT}% fewer tokens — same answer, fraction of the cost.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Live stats strip */}
      {stats && (stats.totalTokensSaved > 0 || stats.totalQueries > 0) && (
        <div className="border-y border-[#30363d] bg-[#161b22] px-6 py-4">
          <p className="text-center text-sm font-mono text-[#8b949e]">
            {formatTokens(stats.totalTokensSaved)} tokens saved
            <span className="mx-3 text-[#30363d]">|</span>
            {formatTokens(stats.totalQueries)} queries
            <span className="mx-3 text-[#30363d]">|</span>
            {stats.activeInstances.toLocaleString()} instances
          </p>
        </div>
      )}

      {/* Token Savings Calculator */}
      <section id="calculator" className="mx-auto max-w-5xl px-6 py-32">
        <h2 className="mb-4 text-center text-4xl font-bold text-[#e1e4e8]">
          The efficiency case, by the numbers
        </h2>
        <p className="mb-10 text-center text-lg text-[#8b949e] max-w-2xl mx-auto leading-relaxed">
          Token savings are the measurable side effect. Plug in your team size to see what it looks like on your bill.
        </p>
        <SavingsCalculator />
      </section>

      {/* How it works */}
      <section className="border-t border-[#30363d] bg-[#0d1117]">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <h2 className="mb-3 text-center text-3xl font-bold text-[#e1e4e8]">
            How it works
          </h2>
          <p className="mb-12 text-center text-base text-[#8b949e] max-w-2xl mx-auto">
            One command indexes your repos. After that, every AI tool reads from the same shared graph.
          </p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {HOW_IT_WORKS.map((step, i) => (
              <div
                key={step.title}
                className="rounded-xl border border-[#30363d] bg-[#161b22] p-8"
              >
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-sm font-mono font-bold text-accent">0{i + 1}</span>
                  <step.icon className="h-6 w-6 text-accent" />
                </div>
                <h3 className="mb-3 text-xl font-semibold text-[#e1e4e8]">{step.title}</h3>
                <p className="text-sm leading-7 text-[#8b949e]">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cross-repo feature */}
      <section className="border-t border-[#30363d]">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            {/* Left: messaging */}
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#30363d] bg-[#161b22] px-3 py-1 text-xs text-[#8b949e] mb-6">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Cross-repository intelligence
              </div>
              <h2 className="text-3xl font-bold text-[#e1e4e8] mb-6 leading-snug">
                Your frontend and backend<br />
                <span className="text-accent">finally share a brain.</span>
              </h2>
              <ul className="space-y-5">
                <li className="flex items-start gap-3">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <p className="text-sm leading-7 text-[#8b949e]">
                    Map the seam between repos. When an AI asks about the billing flow, it gets the React component, the Rails controller, and the Stripe model in one card — not three separate searches across two codebases.
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <p className="text-sm leading-7 text-[#8b949e]">
                    Connections are first-class citizens. codeprism indexes which FE routes hit which BE endpoints, which models own which fields, and which API contracts exist between services.
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <p className="text-sm leading-7 text-[#8b949e]">
                    Add a second repo in minutes. The graph merges automatically — no manual linking, no YAML to write.
                  </p>
                </li>
              </ul>
            </div>

            {/* Right: card example */}
            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-[#161b22] border-b border-[#21262d]">
                <span className="h-2.5 w-2.5 rounded-full bg-[#f85149]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#d29922]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#3fb950]" />
                <span className="ml-2 text-xs text-[#484f58] font-mono">codeprism_context</span>
              </div>
              <div className="p-5 space-y-4">
                {/* Prompt */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#484f58] mb-2">Prompt</p>
                  <div className="rounded-lg bg-[#161b22] border border-[#30363d] px-3 py-2 text-xs text-[#8b949e] font-mono">
                    "Implement refund flow for Stripe invoices"
                  </div>
                </div>
                {/* Card output */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#484f58] mb-2">Knowledge card · ~340 tokens</p>
                  <div className="text-[11px] font-mono text-[#8b949e] leading-5 space-y-2">
                    <p><span className="text-accent">Flow:</span> stripe_refund &nbsp;<span className="text-[#484f58]">·</span>&nbsp; <span className="text-[#3fb950]">repos: frontend, backend</span></p>
                    <div className="border-t border-[#21262d] pt-2">
                      <p className="text-[#e1e4e8] mb-1">Entry point</p>
                      <p className="pl-2">· frontend/src/pages/billing/InvoicePage.tsx</p>
                      <p className="pl-2">· triggers POST /api/v1/invoices/:id/refund</p>
                    </div>
                    <div className="border-t border-[#21262d] pt-2">
                      <p className="text-[#e1e4e8] mb-1">API contract</p>
                      <p className="pl-2">· Route: Api::V1::InvoicesController#refund</p>
                      <p className="pl-2">· Params: {"{ reason: string, amount_cents?: int }"}</p>
                      <p className="pl-2">· Auth: requires scope :billing_write</p>
                    </div>
                    <div className="border-t border-[#21262d] pt-2">
                      <p className="text-[#e1e4e8] mb-1">Backend</p>
                      <p className="pl-2">· Model: Invoice → belongs_to :stripe_customer</p>
                      <p className="pl-2">· Service: StripeService#issue_refund!</p>
                      <p className="pl-2">· Fires: invoice.refunded webhook</p>
                    </div>
                    <div className="border-t border-[#21262d] pt-2">
                      <p className="text-[#e1e4e8] mb-1">Tests</p>
                      <p className="pl-2">· spec/requests/api/v1/invoices_spec.rb:140</p>
                      <p className="pl-2">· billing/__tests__/InvoicePage.test.tsx:88</p>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-[#484f58] border-t border-[#21262d] pt-3">
                  340 tokens vs reading 11 files (~4,800 tokens). Your AI starts with context.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benchmarks summary */}
      {bench?.benchmarks?.aggregate && (
        <section className="border-t border-[#30363d] bg-[#0d1117]">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <h2 className="mb-3 text-center text-2xl font-bold text-[#e1e4e8]">
              Tested on projects developers actually use
            </h2>
            <p className="mb-10 text-center text-sm text-[#8b949e] max-w-2xl mx-auto">
              Benchmarked against {bench.benchmarks.aggregate.total_projects} open-source
              applications — Mastodon, Caddy, Excalidraw, and more.{" "}
              {bench.benchmarks.aggregate.total_queries} real questions about how they work.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5 text-center">
                <TrendingDown className="h-5 w-5 text-accent mx-auto mb-2" />
                <p className="text-3xl font-bold text-accent">
                  {bench.benchmarks.aggregate.avg_token_reduction_pct}%
                </p>
                <p className="text-xs text-[#8b949e] mt-1">fewer tokens</p>
              </div>
              <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5 text-center">
                <Target className="h-5 w-5 text-[#e1e4e8] mx-auto mb-2" />
                <p className="text-3xl font-bold text-[#e1e4e8]">
                  {Math.round(bench.benchmarks.aggregate.avg_flow_hit_rate * 100)}%
                </p>
                <p className="text-xs text-[#8b949e] mt-1">flow hit-rate@k</p>
              </div>
              <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5 text-center">
                <Cpu className="h-5 w-5 text-[#e1e4e8] mx-auto mb-2" />
                <p className="text-3xl font-bold text-[#e1e4e8]">
                  {bench.benchmarks.aggregate.total_queries}
                </p>
                <p className="text-xs text-[#8b949e] mt-1">queries tested</p>
              </div>
            </div>
            <div className="text-center">
              <Link
                to="/benchmarks"
                className={cn(
                  "inline-flex items-center gap-1 text-sm font-medium text-accent",
                  "hover:text-[#79b8ff] transition-colors"
                )}
              >
                View full benchmarks <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* For Teams */}
      <section className="border-t border-[#30363d]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="mb-4 text-center text-2xl font-bold text-[#e1e4e8]">
            Built for teams that use multiple AI tools
          </h2>
          <p className="mb-12 text-center text-sm text-[#8b949e] max-w-2xl mx-auto">
            Your developers won't all use the same AI tool — and they shouldn't have to.
            Cursor, Claude Code, Windsurf, Lovable: every tool reads from the same knowledge graph.
            One team. One shared context.
          </p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {TEAM_BENEFITS.map((benefit) => (
              <div
                key={benefit.title}
                className="rounded-lg border border-[#21262d] bg-[#161b22] p-6"
              >
                <benefit.icon className="mb-4 h-6 w-6 text-[#3fb950]" />
                <h3 className="mb-2 text-sm font-semibold text-[#e1e4e8]">{benefit.title}</h3>
                <p className="text-sm leading-relaxed text-[#8b949e]">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Self-host vs Hosted */}
      <section className="border-t border-[#30363d] bg-[#0d1117]">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <h2 className="mb-3 text-center text-3xl font-bold text-[#e1e4e8]">
            Deploy your way
          </h2>
          <p className="mb-12 text-center text-base text-[#8b949e] max-w-xl mx-auto">
            Open source and free to self-host. Pick what fits your team.
          </p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Local */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-7 flex flex-col">
              <h3 className="mb-1 text-lg font-semibold text-[#e1e4e8]">Local</h3>
              <p className="text-xs text-[#484f58] mb-5">Solo devs</p>
              <ul className="space-y-3 text-sm text-[#8b949e] flex-1">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fb950]" />
                  Runs on your machine, zero config
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fb950]" />
                  Free forever · AGPL-3.0 open source
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fb950]" />
                  <div>
                    <p className="mb-1.5">Quick install:</p>
                    <code className="block rounded bg-[#0d1117] border border-[#30363d] px-3 py-2 text-[11px] text-[#e1e4e8] font-mono leading-relaxed">
                      curl -fsSL https://codeprism.dev/install.sh | bash
                    </code>
                  </div>
                </li>
              </ul>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 block rounded-lg border border-[#30363d] px-4 py-2.5 text-center text-sm font-medium text-[#e1e4e8] hover:border-[#8b949e] hover:bg-[#21262d] transition-colors"
              >
                View on GitHub →
              </a>
            </div>

            {/* VPS */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-7 flex flex-col">
              <h3 className="mb-1 text-lg font-semibold text-[#e1e4e8]">Self-hosted VPS</h3>
              <p className="text-xs text-[#484f58] mb-5">Teams who own their data</p>
              <ul className="space-y-3 text-sm text-[#8b949e] flex-1">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fb950]" />
                  Whole team points to the same server URL
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fb950]" />
                  ~$10/mo (Hetzner) · your LLM key · your rules
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fb950]" />
                  One-click deploy to Render or DigitalOcean
                </li>
              </ul>
              <div className="mt-6 flex flex-col gap-2">
                <a
                  href={`https://render.com/deploy?repo=${GITHUB_URL}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-[#30363d] px-4 py-2.5 text-center text-sm font-medium text-[#e1e4e8] hover:border-[#8b949e] hover:bg-[#21262d] transition-colors"
                >
                  Deploy to Render →
                </a>
                <a
                  href={`https://cloud.digitalocean.com/apps/new?repo=${GITHUB_URL}/tree/main`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-[#30363d] px-4 py-2.5 text-center text-sm font-medium text-[#e1e4e8] hover:border-[#8b949e] hover:bg-[#21262d] transition-colors"
                >
                  Deploy to DigitalOcean →
                </a>
              </div>
            </div>

            {/* Cloud — featured card */}
            <div className="relative rounded-xl overflow-hidden flex flex-col"
              style={{ background: "linear-gradient(135deg, #0d1117 0%, #0f1a2e 60%, #0d1117 100%)" }}
            >
              {/* Glowing accent border */}
              <div className="absolute inset-0 rounded-xl border border-[#58a6ff]/40 pointer-events-none" />
              <div className="absolute inset-0 rounded-xl shadow-[inset_0_0_40px_0_rgba(88,166,255,0.06)] pointer-events-none" />

              <div className="relative p-7 flex flex-col flex-1">
                {/* Header with logo */}
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <PrismLogo className="h-9 w-9 flex-shrink-0" />
                    <div>
                      <h3 className="text-lg font-bold text-[#e1e4e8] leading-tight">codeprism Cloud</h3>
                      <p className="text-xs text-[#484f58] mt-0.5">Zero infra. Full team.</p>
                    </div>
                  </div>
                  {founding?.founding && (
                    <span className="shrink-0 rounded-full bg-[#3fb950]/10 border border-[#3fb950]/30 px-2.5 py-1 text-xs font-semibold text-[#3fb950]">
                      {founding.remaining} spots left
                    </span>
                  )}
                </div>

                {/* Price */}
                <div className="mb-6 pb-6 border-b border-[#21262d]">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold text-[#e1e4e8]">Free</span>
                    <span className="text-sm text-[#484f58]">for founding teams</span>
                  </div>
                  <p className="text-xs text-[#484f58] mt-1">Up to 10 devs · free forever for founding teams · no credit card</p>
                </div>

                {/* Features */}
                <ul className="space-y-3.5 flex-1">
                  {[
                    "Ready in under 2 minutes — no server to manage",
                    "Cross-repo knowledge graph shared across your whole team",
                    "Team invitations, analytics, and seat tracking built-in",
                    "Works with Cursor, Claude Code, Windsurf, Lovable, Zed",
                  ].map((feat) => (
                    <li key={feat} className="flex items-start gap-3">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <span className="text-sm text-[#8b949e] leading-snug">{feat}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Link
                  to="/onboard"
                  className="mt-7 block rounded-lg bg-accent px-4 py-3 text-center text-base font-semibold text-black hover:bg-[#79b8ff] transition-colors shadow-lg shadow-accent/20"
                >
                  Get started free →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Privacy / data mini-block */}
      <section className="border-t border-[#30363d] bg-[#0d1117]">
        <div className="mx-auto max-w-5xl px-6 py-14">
          <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-8 grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <p className="text-xs uppercase tracking-wider text-[#484f58] mb-3">What's stored</p>
              <ul className="space-y-2 text-sm text-[#8b949e]">
                {["Symbol names & file paths", "Function signatures & routes", "Model relationships", "API contracts between services", "Verified team insights"].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#3fb950] shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[#484f58] mb-3">What's never stored</p>
              <ul className="space-y-2 text-sm text-[#8b949e]">
                {["Function bodies or raw source", "String literals or comments", "Secrets or env values", "Anything you .codeprismignore"].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#f85149] shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[#484f58] mb-3">How it's isolated</p>
              <p className="text-sm leading-7 text-[#8b949e]">
                Each team's graph is tenant-isolated at the database level. No cross-tenant queries are possible by design.
              </p>
              <p className="mt-4 text-sm leading-7 text-[#8b949e]">
                Prefer full control?{" "}
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                  Self-host in 10 minutes.
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-[#30363d] bg-[#0d1117]">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <h2 className="mb-3 text-center text-3xl font-bold text-[#e1e4e8]">
            Simple, transparent pricing
          </h2>
          <p className="mb-12 text-center text-base text-[#8b949e] max-w-xl mx-auto">
            Open source and free to self-host forever. Cloud is free for founding teams.
          </p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Open Source */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-8 flex flex-col">
              <h3 className="text-lg font-semibold text-[#e1e4e8] mb-1">Open Source</h3>
              <p className="text-xs text-[#484f58] mb-6">Solo devs &amp; tinkerers</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-[#e1e4e8]">$0</span>
                <span className="text-sm text-[#8b949e] ml-1">forever</span>
              </div>
              <ul className="space-y-3 text-sm text-[#8b949e] flex-1">
                {["Self-host with Docker", "Full engine, no limits", "1 developer", "Community support (Discord)"].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 shrink-0 text-[#3fb950]" />
                    {f}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[11px] text-[#484f58] leading-5">
                AGPL because codeprism is infrastructure — if you build on it or improve it, those improvements flow back to every team using it.
              </p>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 block rounded-lg border border-[#30363d] px-4 py-2.5 text-center text-sm font-medium text-[#e1e4e8] hover:border-[#8b949e] hover:bg-[#21262d] transition-colors"
              >
                View on GitHub →
              </a>
            </div>

            {/* Team — highlighted */}
            <div className="rounded-xl border border-accent/60 bg-[#161b22] p-8 flex flex-col relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-0.5 text-[11px] font-semibold text-black">
                Recommended
              </div>
              <h3 className="text-lg font-semibold text-[#e1e4e8] mb-1">Team Cloud</h3>
              <p className="text-xs text-[#484f58] mb-6">AI-native startups</p>
              <div className="mb-1">
                <span className="text-4xl font-bold text-accent">Free</span>
                <span className="text-sm text-[#8b949e] ml-1">for founding teams</span>
              </div>
              <p className="text-xs text-[#484f58] mb-5">First 100 teams · free forever · we'll tell you before anything changes</p>
              <ul className="space-y-3 text-sm text-[#8b949e] flex-1">
                {[
                  "Cloud-hosted, zero infra",
                  "Up to 10 developers",
                  "First 100 teams",
                  "Invitations & analytics",
                  "Priority Discord support",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/onboard"
                className="mt-8 block rounded-lg bg-accent px-4 py-2.5 text-center text-sm font-semibold text-black hover:bg-[#79b8ff] transition-colors"
              >
                Claim your spot →
              </Link>
            </div>

            {/* Enterprise */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-8 flex flex-col">
              <h3 className="text-lg font-semibold text-[#e1e4e8] mb-1">Enterprise</h3>
              <p className="text-xs text-[#484f58] mb-6">Large engineering orgs</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-[#e1e4e8]">Custom</span>
              </div>
              <ul className="space-y-3 text-sm text-[#8b949e] flex-1">
                {[
                  "On-prem or private cloud",
                  "Unlimited developers",
                  "SSO & audit logs",
                  "SLA & dedicated support",
                  "Custom integrations",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 shrink-0 text-[#3fb950]" />
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="mt-8 block rounded-lg border border-[#30363d] px-4 py-2.5 text-center text-sm font-medium text-[#e1e4e8] hover:border-[#8b949e] hover:bg-[#21262d] transition-colors"
              >
                Contact us →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-[#30363d]">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="mb-10 text-center text-2xl font-bold text-[#e1e4e8]">
            Common questions
          </h2>
          <div className="space-y-6">
            {[
              {
                q: "Does codeprism send my code to the cloud?",
                a: "No. The engine runs entirely on your machine or your own server. Code is never sent to codeprism servers. The cloud plan hosts the engine on your own isolated tenant — your code stays inside that instance.",
              },
              {
                q: "Do developers need to change how they work?",
                a: "No. codeprism integrates as an MCP server — the same protocol Cursor, Claude Code, Windsurf, and Zed already support. Add a 10-line JSON snippet to your editor config and it's live.",
              },
              {
                q: "Why not just standardize everyone on one AI tool?",
                a: "Developers choose tools for different reasons — workflows, models, cost, personal preference — and forcing a single tool creates friction and slows adoption. More importantly, the next best AI tool launches every few weeks. codeprism doesn't care which tool your team uses; it gives every tool the same architectural context. You keep tool choice, your team keeps shared memory.",
              },
              {
                q: "What if my team uses different AI tools?",
                a: "That's the whole point. codeprism is tool-agnostic. Every MCP-compatible editor reads from the same knowledge graph — no matter who uses Cursor and who uses Claude Code.",
              },
              {
                q: "How long does the initial index take?",
                a: "Typically 2–10 minutes for a mid-size codebase (~100k LOC). After that, codeprism watches for file changes and updates incrementally in the background.",
              },
              {
                q: "What languages and frameworks are supported?",
                a: "Ruby, JavaScript, TypeScript, Python, Go, PHP, and Vue out of the box. Rails, Sinatra, React, Next.js, Vue, Django, FastAPI, Laravel, Symfony, NestJS, Angular, Svelte, Gin, Spring, Express, Fastify, and more are detected automatically from your stack.",
              },
            ].map(({ q, a }) => (
              <div key={q} className="border-b border-[#21262d] pb-6 last:border-0">
                <p className="text-sm font-semibold text-[#e1e4e8] mb-2">{q}</p>
                <p className="text-sm leading-relaxed text-[#8b949e]">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Supported frameworks */}
      <section className="border-t border-[#30363d] px-6 py-10">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-2">
          {FRAMEWORKS.map((fw) => (
            <span
              key={fw}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium", stackColor(fw))}
            >
              {fw}
            </span>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#30363d] px-6 py-8">
        <div className="mx-auto max-w-6xl flex flex-col items-center gap-4">
          {/* Logo row */}
          <Link to="/">
            <PrismLogo
              wordmark
              className="h-6 w-6"
              wordmarkClassName="text-sm text-[#8b949e]"
            />
          </Link>
          {/* Links */}
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-[#484f58]">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-[#8b949e] transition-colors">
              <Github className="h-3.5 w-3.5" /> GitHub
            </a>
            <span>·</span>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-[#8b949e] transition-colors">
              <MessageCircle className="h-3.5 w-3.5" /> Discord
            </a>
            <span>·</span>
            <a href="https://docs.codeprism.dev" className="hover:text-[#8b949e] transition-colors">Docs</a>
            <span>·</span>
            <Link to="/terms" className="hover:text-[#8b949e] transition-colors">Terms</Link>
            <span>·</span>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-[#8b949e] transition-colors">Support</a>
          </div>
          <p className="text-xs text-[#484f58]">© {new Date().getFullYear()} codeprism · AGPL-3.0 open source</p>
        </div>
      </footer>
    </div>
  );
}
