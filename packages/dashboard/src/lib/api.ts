const BASE = typeof window !== "undefined" ? window.location.origin : "http://localhost:4000";

function getSessionToken(): string | null {
  return localStorage.getItem("srcmap_session");
}

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  const session = getSessionToken();
  if (session) headers.set("X-Session-Token", session);
  if (!headers.has("Content-Type") && options?.body) headers.set("Content-Type", "application/json");

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
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
  staleCount: number;
  repos: string[];
  isPageFlow: boolean;
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

export interface RepoOverview {
  about: ProjectDoc | null;
  pages: ProjectDoc | null;
  be_overview: ProjectDoc | null;
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

export interface PublicStats {
  activeInstances: number;
  totalTokensSaved: number;
  totalQueries: number;
  totalCards: number;
  avgCacheHitRate: number;
}

export interface TenantInfo {
  slug: string;
  name: string;
  apiKey: string;
  mcpUrl: string;
  dashboardUrl: string;
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

  repoOverview: (repo: string) =>
    fetchJSON<RepoOverview>(`/api/repo-overview?repo=${encodeURIComponent(repo)}`),

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

  // ---- Team rules ----
  rules: () => fetchJSON<unknown[]>("/api/rules"),

  addRule: (name: string, description: string, severity: string, scope?: string, created_by?: string) =>
    fetchJSON<unknown>("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, severity, scope, created_by }),
    }),

  patchRule: (id: string, data: Record<string, unknown>) =>
    fetchJSON<unknown>(`/api/rules/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  deleteRule: (id: string) =>
    fetchJSON<{ deleted: string }>(`/api/rules/${encodeURIComponent(id)}`, { method: "DELETE" }),

  ruleChecks: (repo?: string) => {
    const qs = repo ? `?repo=${encodeURIComponent(repo)}` : "";
    return fetchJSON<unknown[]>(`/api/rule-checks${qs}`);
  },

  refineRule: (description: string, opts?: { name?: string; scope?: string; severity?: string }) =>
    fetchJSON<{ refined: string }>("/api/rules/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, ...opts }),
    }),

  importRules: (rules: Array<{ name: string; description: string; severity?: string; scope?: string; created_by?: string }>) =>
    fetchJSON<{ inserted: string[]; skipped: string[]; errors: string[] }>("/api/rules/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rules),
    }),

  runCheck: (repo?: string, base = "main") =>
    fetchJSON<{ passed: boolean; violations: unknown[]; checked_rules?: number; files_checked?: number; message?: string; error?: string }>("/api/rules/run-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, base }),
    }),

  // ---- Knowledge files ----
  knowledgeFiles: () =>
    fetchJSON<Array<{ id: string; source: "builtin" | "custom" }>>("/api/knowledge-files"),

  addKnowledgeFile: (skillId: string, content: string) =>
    fetchJSON<{ skillId: string; path: string; message: string }>("/api/knowledge-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId, content }),
    }),

  // ---- Repo registration ----
  registeredRepos: () =>
    fetchJSON<Array<{ name: string; path: string }>>("/api/repos/registered"),

  registerRepo: (name: string, path: string) =>
    fetchJSON<{ name: string; path: string; reindexing: boolean; message: string }>("/api/repos/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, path }),
    }),

  removeRepo: (name: string) =>
    fetchJSON<{ removed: string }>(`/api/repos/register/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),

  benchmarks: () =>
    fetchJSON<BenchmarkResponse>("/api/benchmarks"),

  submitBenchmark: (req: BenchmarkSubmitRequest) =>
    fetchJSON<BenchmarkSubmitResponse>("/api/benchmarks/submit", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  benchmarkQueue: () =>
    fetchJSON<BenchmarkQueueResponse>("/api/benchmarks/queue"),

  benchmarkDetail: (slug: string) =>
    fetchJSON<BenchmarkProject>(`/api/benchmarks/${encodeURIComponent(slug)}`),

  sandboxQuery: (query: string, repo: string) =>
    fetchJSON<SandboxResponse>("/api/benchmarks/sandbox", {
      method: "POST",
      body: JSON.stringify({ query, repo }),
    }),

  publicStats: () =>
    fetchJSON<PublicStats>("/api/public-stats"),

  foundingStatus: () =>
    fetchJSON<FoundingStatus>("/api/founding-status"),

  createTenant: (name: string, email?: string) =>
    fetchJSON<TenantInfo>("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    }),

  // ---- Auth ----
  requestMagicLink: (email: string, tenant: string) =>
    fetchJSON<{ ok: boolean; message: string }>("/api/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email, tenant }),
    }),

  verifyToken: (token: string) =>
    fetchJSON<AuthResponse>("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  logout: () =>
    fetchJSON<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  me: () =>
    fetchJSON<{ userId: string; tenantSlug: string; email: string; role: string }>("/api/auth/me"),

  // ---- Members ----
  members: () =>
    fetchJSON<MembersResponse>("/api/members"),

  inviteMembers: (emails: string[]) =>
    fetchJSON<InviteResponse>("/api/members/invite", {
      method: "POST",
      body: JSON.stringify({ emails }),
    }),

  deactivateMember: (userId: string) =>
    fetchJSON<{ deactivated: string }>(`/api/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
};

// ---- Auth types ----
export interface AuthResponse {
  sessionToken: string;
  user: { id: string; email: string; name: string };
  tenant: { slug: string; name: string };
}

export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  invitedAt: string;
  acceptedAt: string | null;
  queryCount: number;
}

export interface MembersResponse {
  members: TeamMember[];
  activeCount: number;
  maxSeats: number | null;
}

export interface InviteResponse {
  invited: number;
  skipped: number;
  details: Array<{ email: string; alreadyMember: boolean }>;
}

export interface BenchmarkCase {
  query: string;
  ticket?: string | null;
  srcmap_tokens: number;
  naive_tokens: number;
  latency_ms: number;
  cache_hit: boolean;
  flow_hit_rate: number;
  file_hit_rate: number;
  precision_at_k: number;
  result_count: number;
  quality_score?: number;
}

export interface BenchmarkProject {
  name: string;
  repo: string;
  language: string;
  framework: string;
  stats: {
    queries_tested: number;
    avg_tokens_with_srcmap: number;
    avg_tokens_without: number;
    token_reduction_pct: number;
    avg_latency_ms: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
    p99_latency_ms: number;
    cache_hit_rate: number;
    flow_hit_rate: number;
    file_hit_rate: number;
    precision_at_5: number;
  };
  live?: boolean;
  llmEnhanced?: boolean;
  cardCount?: number;
  cases: BenchmarkCase[];
}

export interface BenchmarkData {
  generated_at: string;
  projects: BenchmarkProject[];
  aggregate: {
    total_projects: number;
    total_queries: number;
    avg_token_reduction_pct: number;
    avg_latency_ms: number;
    avg_flow_hit_rate: number;
    avg_cache_hit_rate: number;
  };
}

export interface BenchmarkResponse {
  benchmarks: BenchmarkData | null;
}

export interface FoundingStatus {
  founding: boolean;
  remaining: number;
  total: number;
  limit: number;
}

export type BenchmarkProvider = "gemini" | "openai" | "deepseek" | "anthropic";

export interface BenchmarkSubmitRequest {
  url: string;
  provider?: BenchmarkProvider;
  apiKey?: string;
}

export interface BenchmarkSubmitResponse {
  queued: boolean;
  position?: number;
  requiresKey?: boolean;
  fileEstimate?: number;
  error?: string;
}

export type BenchmarkStage = "queued" | "cloning" | "analyzing" | "indexing" | "benchmarking" | "saving";

export interface BenchmarkQueueResponse {
  queue: Array<{ repo: string; status: "pending" | "running" | "done" | "error"; stage: BenchmarkStage; position: number; error?: string }>;
  slotsUsed: number;
  slotsTotal: number;
}

export interface SandboxCard {
  id: string;
  title: string;
  flow: string;
  cardType: string;
  content: string;
  sourceFiles: string[];
}

export interface SandboxResponse {
  query: string;
  cards: SandboxCard[];
  formattedContext: string;
  latencyMs: number;
  cacheHit: boolean;
  srcmapTokens: number;
  naiveFiles: number;
  naiveTokens: number;
  tokenReduction: number;
}
