import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  GitBranch,
  BookOpen,
  BarChart2,
  Settings,
  Plus,
  Database,
  ShieldAlert,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { api, type RepoSummary } from "@/lib/api";

const NAV_ITEMS = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Overview" },
  { to: "/dashboard/repos", icon: GitBranch, label: "Repositories" },
  { to: "/dashboard/knowledge", icon: BookOpen, label: "Knowledge Base" },
  { to: "/dashboard/rules", icon: ShieldAlert, label: "Team Rules" },
  { to: "/dashboard/team", icon: Users, label: "Team" },
  { to: "/dashboard/analytics", icon: BarChart2, label: "Analytics" },
  { to: "/dashboard/settings", icon: Settings, label: "Settings" },
] as const;

interface SidebarProps {
  companyName: string;
}

export function Sidebar({ companyName }: SidebarProps) {
  const navigate = useNavigate();
  const [repos, setRepos] = useState<RepoSummary[]>([]);

  useEffect(() => {
    api.repos().then(setRepos).catch(() => {});
  }, []);

  return (
    <aside className="fixed left-0 top-0 h-screen w-[220px] border-r border-[#21262d] bg-[#0a0c10] flex flex-col z-10">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-[#21262d]">
        <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
          <Database size={13} className="text-black" />
        </div>
        <div className="min-w-0">
          <span className="text-sm font-semibold text-[#e1e4e8] tracking-tight">srcmap</span>
          {companyName && (
            <p className="text-[10px] text-[#8b949e] truncate leading-none mt-0.5">{companyName}</p>
          )}
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/dashboard"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-[#1c2333] text-[#e1e4e8] font-medium"
                  : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22]",
              )
            }
          >
            <Icon size={15} className="flex-shrink-0" />
            {label}
          </NavLink>
        ))}

        {/* Repo quick-nav */}
        {repos.length > 0 && (
          <>
            <div className="pt-4 pb-1 px-3">
              <span className="text-[10px] font-medium text-[#484f58] uppercase tracking-wider">
                Repositories
              </span>
            </div>
            {repos.map((r) => (
              <button
                key={r.repo}
                onClick={() => navigate(`/dashboard/repos?highlight=${encodeURIComponent(r.repo)}`)}
                className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-xs text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22] transition-colors text-left"
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    r.staleCards > 0 ? "bg-warning" : "bg-success",
                  )}
                />
                <span className="truncate">{r.repo}</span>
              </button>
            ))}
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-[#21262d] space-y-1">
        <NavLink
          to="/dashboard/repos"
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22] transition-colors"
        >
          <Plus size={13} />
          Add repository
        </NavLink>
      </div>
    </aside>
  );
}
