import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Github, MessageCircle, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PrismLogo } from "@/components/shared/PrismLogo";

const GITHUB_URL = "https://github.com/dan1d/codeprism";
const DISCORD_URL = "https://discord.gg/nsWERSde";

const NAV_LINKS = [
  { label: "Pricing", anchor: "pricing" },
  { label: "FAQ", anchor: "faq" },
] as const;

export function useGithubStars(repo: string): string | null {
  const [stars, setStars] = useState<string | null>(null);
  useEffect(() => {
    fetch(`https://api.github.com/repos/${repo}`)
      .then((r) => r.json())
      .then((d) => {
        const count = d?.stargazers_count;
        if (typeof count === "number") {
          setStars(count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count));
        }
      })
      .catch(() => {});
  }, [repo]);
  return stars;
}

/**
 * Site-wide top navigation bar.
 *
 * On the landing page, anchor links scroll to sections.
 * On other pages, they navigate to /#anchor instead.
 */
export function SiteNav({ variant = "landing" }: { variant?: "landing" | "page" }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const stars = useGithubStars("dan1d/codeprism");

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mobileOpen]);

  function handleAnchor(e: React.MouseEvent<HTMLAnchorElement>, anchor: string) {
    if (variant === "landing") {
      e.preventDefault();
      document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth" });
    }
    setMobileOpen(false);
  }

  function anchorHref(anchor: string) {
    return variant === "landing" ? `#${anchor}` : `/#${anchor}`;
  }

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

        {/* Center nav — desktop */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(({ label, anchor }) => (
            <a
              key={anchor}
              href={anchorHref(anchor)}
              onClick={(e) => handleAnchor(e, anchor)}
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
            {stars && <span className="text-xs text-[#484f58]">★ {stars}</span>}
          </a>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-[#8b949e] hover:text-[#e1e4e8] transition-colors rounded-md hover:bg-[#21262d]"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Discord
          </a>
        </nav>

        {/* Right CTAs */}
        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="hidden sm:block px-4 py-2 text-sm text-[#8b949e] hover:text-[#e1e4e8] transition-colors border border-[#30363d] rounded-lg hover:border-[#8b949e]"
          >
            Sign in to your team →
          </Link>
          <Link to="/onboard" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-[#79b8ff] transition-colors">
            Get started →
          </Link>
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
        <nav className="md:hidden border-t border-[#21262d] px-6 py-4 flex flex-col gap-1 bg-[#0d1117]/95 backdrop-blur-md">
          {NAV_LINKS.map(({ label, anchor }) => (
            <a
              key={anchor}
              href={anchorHref(anchor)}
              onClick={(e) => handleAnchor(e, anchor)}
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
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-[#8b949e] hover:text-[#e1e4e8] transition-colors rounded-md hover:bg-[#21262d]"
          >
            <MessageCircle className="h-3.5 w-3.5" /> Discord
          </a>
          <div className="border-t border-[#21262d] mt-2 pt-2">
            <Link to="/login" onClick={() => setMobileOpen(false)} className="block px-3 py-2.5 text-sm text-[#8b949e] hover:text-[#e1e4e8] transition-colors rounded-md">
              Sign in to your team →
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
