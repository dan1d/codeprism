/**
 * Active branch context — stored in search_config so all MCP queries are
 * automatically scoped to what the developer is currently working on.
 *
 * Keys stored in search_config:
 *   active_branch        — raw branch name ("add-some-weird-thing")
 *   active_ticket_id     — extracted ticket ID ("ENG-123") or "" if none
 *   active_context_hint  — humanised query hint ("add some weird thing")
 *   active_epic          — epic name ("orlando demo") or "" if not from an epic
 *   active_repo          — repo name where the checkout happened
 *   active_updated_at    — ISO timestamp
 */

import { getDb } from "../db/connection.js";

export interface ActiveContext {
  branch: string;
  ticketId: string | null;
  contextHint: string;
  epicBranch: string | null;
  repo: string;
  updatedAt: string;
}

export interface CheckoutContextInput {
  branch: string;
  repo: string;
  ticketId: string | null;
  contextHint: string;
  epicBranch: string | null;
}

const KEYS = [
  "active_branch",
  "active_ticket_id",
  "active_context_hint",
  "active_epic",
  "active_repo",
  "active_updated_at",
] as const;

function upsertConfig(db: ReturnType<typeof getDb>, key: string, value: string): void {
  db.prepare(
    "INSERT INTO search_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  ).run(key, value);
}

/**
 * Persists the checkout context from a branch switch into search_config.
 * Called by POST /api/context/checkout (triggered by the post-checkout git hook).
 */
export function storeCheckoutContext(input: CheckoutContextInput): ActiveContext {
  const db = getDb();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    upsertConfig(db, "active_branch",       input.branch);
    upsertConfig(db, "active_ticket_id",    input.ticketId ?? "");
    upsertConfig(db, "active_context_hint", input.contextHint);
    upsertConfig(db, "active_epic",         input.epicBranch ?? "");
    upsertConfig(db, "active_repo",         input.repo);
    upsertConfig(db, "active_updated_at",   now);
  });
  tx();

  return {
    branch:      input.branch,
    ticketId:    input.ticketId,
    contextHint: input.contextHint,
    epicBranch:  input.epicBranch,
    repo:        input.repo,
    updatedAt:   now,
  };
}

/**
 * Returns the current active context stored in search_config.
 * Returns null if no checkout has been recorded yet.
 */
export function getActiveContext(): ActiveContext | null {
  const db = getDb();
  const rows = db
    .prepare(`SELECT key, value FROM search_config WHERE key IN (${KEYS.map(() => "?").join(",")})`)
    .all(...KEYS) as Array<{ key: string; value: string }>;

  if (rows.length === 0) return null;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (!map["active_branch"]) return null;

  return {
    branch:      map["active_branch"] ?? "",
    ticketId:    map["active_ticket_id"] || null,
    contextHint: map["active_context_hint"] ?? "",
    epicBranch:  map["active_epic"] || null,
    repo:        map["active_repo"] ?? "",
    updatedAt:   map["active_updated_at"] ?? "",
  };
}

/**
 * Builds a search query string from the active context.
 * Used by MCP srcmap_context when no explicit description is provided.
 *
 * Combines ticket ID + epic + context hint in priority order so the
 * search captures the most relevant cards without duplication.
 */
export function buildContextQuery(ctx: ActiveContext): string {
  const parts: string[] = [];
  if (ctx.ticketId) parts.push(ctx.ticketId);
  if (ctx.epicBranch) parts.push(ctx.epicBranch);
  if (ctx.contextHint && ctx.contextHint !== ctx.epicBranch) parts.push(ctx.contextHint);
  return parts.join(" ").trim() || ctx.branch;
}
