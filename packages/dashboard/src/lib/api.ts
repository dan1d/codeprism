const BASE = typeof window !== "undefined" ? window.location.origin : "http://localhost:4000";

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricsSummary {
  totalQueries: number;
  cacheHits: number;
  cacheHitRate: number;
  totalCards: number;
  totalFlows: number;
  staleCards: number;
  estimatedTokensSaved: number;
  estimatedCostSaved: number;
  topQueries: Array<{ query: string; count: number }>;
  topCards: Array<{ cardId: string; title: string; flow: string; usageCount: number }>;
  queriesByDay: Array<{ date: string; total: number; cacheHits: number }>;
  devStats: Array<{ devId: string; queries: number; cacheHits: number }>;
}

export interface RepoSummary {
  repo: string;
  primaryLanguage: string;
  frameworks: string[];
  skillIds: string[];
  cardCount: number;
  staleCards: number;
  indexedFiles: number;
  lastIndexedAt: string | null;
}

export interface FlowSummary {
  flow: string;
  cardCount: number;
  fileCount: number;
}

export interface Card {
  id: string;
  title: string;
  content: string;
  card_type: string;
  flow: string;
  source_files: string;
  source_repos: string;
  tags: string;
  stale: number;
  specificity_score: number;
  updated_at: string;
  source_commit: string | null;
}

export interface ProjectDoc {
  id: string;
  repo: string;
  doc_type: string;
  title: string;
  content: string;
  stale: number;
  updated_at: string;
}

export interface InstanceInfo {
  instanceId: string;
  companyName: string;
  plan: string;
  engineVersion: string;
}

export interface ReindexStatus {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  log: string[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export const api = {
  instanceInfo: () => fetchJSON<InstanceInfo>("/api/instance-info"),

  updateInstanceInfo: (data: { companyName?: string; plan?: string }) =>
    fetchJSON<InstanceInfo>("/api/instance-info", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  metrics: (params?: { from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    const q = qs.toString();
    return fetchJSON<MetricsSummary>(`/api/metrics/summary${q ? `?${q}` : ""}`);
  },

  repos: () => fetchJSON<RepoSummary[]>("/api/repos"),

  flows: () => fetchJSON<FlowSummary[]>("/api/flows"),

  cards: (params?: { flow?: string }) => {
    const qs = new URLSearchParams();
    if (params?.flow) qs.set("flow", params.flow);
    const q = qs.toString();
    return fetchJSON<Card[]>(`/api/cards${q ? `?${q}` : ""}`);
  },

  card: (id: string) => fetchJSON<Card>(`/api/cards/${id}`),

  projectDocs: (params?: { repo?: string; type?: string }) => {
    const qs = new URLSearchParams();
    if (params?.repo) qs.set("repo", params.repo);
    if (params?.type) qs.set("type", params.type);
    const q = qs.toString();
    return fetchJSON<ProjectDoc[]>(`/api/project-docs${q ? `?${q}` : ""}`);
  },

  reindexStatus: () => fetchJSON<ReindexStatus>("/api/reindex-status"),

  reindexStale: (repo?: string) => {
    const qs = repo ? `?repo=${encodeURIComponent(repo)}` : "";
    return fetchJSON(`/api/reindex-stale${qs}`, { method: "POST" });
  },

  settings: () => fetchJSON<Record<string, string>>("/api/settings"),

  updateSettings: (data: Record<string, string>) =>
    fetchJSON<{ ok: boolean }>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
};
