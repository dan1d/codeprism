import { useState, useEffect } from "react";
import { Users, UserPlus, Shield, Clock, Eye, XCircle } from "lucide-react";
import { api, type TeamMember, type MembersResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active:      { label: "Active",     color: "bg-[#3fb950]" },
  invited:     { label: "Pending",    color: "bg-[#d29922]" },
  detected:    { label: "Detected",   color: "bg-[#58a6ff]" },
  deactivated: { label: "Deactivated", color: "bg-[#484f58]" },
};

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_LABELS[status] ?? { label: status, color: "bg-[#484f58]" };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#8b949e]">
      <span className={cn("w-1.5 h-1.5 rounded-full", info.color)} />
      {info.label}
    </span>
  );
}

export function Team() {
  const { user } = useAuth();
  const [data, setData] = useState<MembersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);

  const refresh = () => {
    api.members()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const emails = inviteEmails
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (emails.length === 0) return;

    setInviting(true);
    setInviteResult(null);
    try {
      const res = await api.inviteMembers(emails);
      setInviteResult(`${res.invited} invited, ${res.skipped} already members`);
      setInviteEmails("");
      refresh();
    } catch (err) {
      setInviteResult(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  const handleDeactivate = async (member: TeamMember) => {
    if (!confirm(`Deactivate ${member.email}?`)) return;
    try {
      await api.deactivateMember(member.userId);
      refresh();
    } catch { /* ignore */ }
  };

  const isAdmin = user?.role === "admin";
  const seatPercent = data && data.maxSeats
    ? Math.min(100, (data.activeCount / data.maxSeats) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-[#e1e4e8] flex items-center gap-2">
          <Users size={18} /> Team
        </h1>
        <p className="text-sm text-[#8b949e] mt-1">
          Manage your team members and track developer adoption.
        </p>
      </div>

      {/* Seat usage */}
      {data && (
        <div className="rounded-lg border border-[#21262d] bg-[#0d1117] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#8b949e]">Seat usage</span>
            <span className="text-sm font-mono text-[#e1e4e8]">
              {data.activeCount}{data.maxSeats ? ` / ${data.maxSeats}` : ""} active
            </span>
          </div>
          {data.maxSeats && (
            <div className="w-full h-2 rounded-full bg-[#21262d] overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  seatPercent >= 90 ? "bg-[#f85149]" : seatPercent >= 70 ? "bg-[#d29922]" : "bg-[#3fb950]"
                )}
                style={{ width: `${seatPercent}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Invite form */}
      {isAdmin && (
        <div className="rounded-lg border border-[#21262d] bg-[#0d1117] p-4">
          <h2 className="text-sm font-medium text-[#e1e4e8] flex items-center gap-2 mb-3">
            <UserPlus size={14} /> Invite developers
          </h2>
          <form onSubmit={handleInvite}>
            <textarea
              value={inviteEmails}
              onChange={(e) => setInviteEmails(e.target.value)}
              placeholder="Enter email addresses (one per line or comma-separated)"
              rows={3}
              className={cn(
                "w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2",
                "text-sm text-[#e1e4e8] placeholder:text-[#484f58] resize-none",
                "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              )}
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                type="submit"
                disabled={inviting || !inviteEmails.trim()}
                className={cn(
                  "rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-black",
                  "hover:bg-[#79b8ff] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                )}
              >
                {inviting ? "Sending..." : "Send invitations"}
              </button>
              {inviteResult && (
                <span className="text-xs text-[#8b949e]">{inviteResult}</span>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Member list */}
      <div className="rounded-lg border border-[#21262d] bg-[#0d1117] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#21262d]">
          <h2 className="text-sm font-medium text-[#e1e4e8]">Members</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-[#484f58]">Loading...</div>
        ) : !data?.members.length ? (
          <div className="p-8 text-center text-sm text-[#484f58]">No team members yet. Invite developers above.</div>
        ) : (
          <div className="divide-y divide-[#21262d]">
            {data.members.map((m) => (
              <div key={m.userId} className="flex items-center gap-4 px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-[#21262d] flex items-center justify-center flex-shrink-0">
                  <span className="text-xs text-[#8b949e] font-medium">
                    {m.email[0]?.toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#e1e4e8] truncate">
                      {m.name || m.email}
                    </span>
                    {m.role === "admin" && (
                      <Shield size={12} className="text-[#d29922] flex-shrink-0" />
                    )}
                  </div>
                  <span className="text-xs text-[#484f58]">{m.email}</span>
                </div>
                <StatusBadge status={m.status} />
                <div className="flex items-center gap-2 text-xs text-[#484f58]">
                  {m.acceptedAt ? (
                    <span className="flex items-center gap-1">
                      <Eye size={10} /> Joined {new Date(m.acceptedAt).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Clock size={10} /> Invited {new Date(m.invitedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {isAdmin && m.userId !== user?.userId && m.status !== "deactivated" && (
                  <button
                    onClick={() => handleDeactivate(m)}
                    className="text-[#484f58] hover:text-[#f85149] transition-colors"
                    title="Deactivate member"
                  >
                    <XCircle size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
