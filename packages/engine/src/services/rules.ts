import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import { getLLMFromDb } from "./instance.js";

export function insertTeamRule(fields: {
  name: string;
  description: string;
  severity: string;
  scope?: string | null;
  created_by?: string | null;
}) {
  const db = getDb();
  const validSeverities = ["error", "warning", "info"];
  const severity = validSeverities.includes(fields.severity) ? fields.severity : "warning";
  const id = `rule_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  db.prepare(`
    INSERT INTO team_rules (id, name, description, severity, scope, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, fields.name.trim(), fields.description.trim(), severity, fields.scope?.trim() || null, fields.created_by?.trim() || null);
  return db.prepare("SELECT * FROM team_rules WHERE id = ?").get(id);
}

export function listRules() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM team_rules
    ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, name
  `).all();
}

export function updateRule(id: string, body: Record<string, unknown>) {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM team_rules WHERE id = ?").get(id);
  if (!existing) return null;

  const allowed = ["name", "description", "severity", "scope", "enabled"] as const;
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of allowed) {
    if (key in body) {
      sets.push(`${key} = ?`);
      values.push(key === "enabled" ? (body[key] ? 1 : 0) : body[key]);
    }
  }
  if (sets.length === 0) return undefined;

  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE team_rules SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM team_rules WHERE id = ?").get(id);
}

export function deleteRule(id: string): boolean {
  const db = getDb();
  const info = db.prepare("DELETE FROM team_rules WHERE id = ?").run(id);
  return info.changes > 0;
}

export function listRuleChecks(repo?: string, limit = 20) {
  const db = getDb();
  return repo
    ? db.prepare("SELECT * FROM rule_checks WHERE repo = ? ORDER BY checked_at DESC LIMIT ?").all(repo, limit)
    : db.prepare("SELECT * FROM rule_checks ORDER BY checked_at DESC LIMIT ?").all(limit);
}

export async function refineRule(description: string, context?: { name?: string; scope?: string; severity?: string }): Promise<string> {
  const llm = getLLMFromDb();
  if (!llm) throw new Error("No LLM configured. Add an LLM provider in Settings.");

  const parts = [
    context?.name ? `Rule name: "${context.name}"` : null,
    context?.scope ? `Tech stack / scope: ${context.scope}` : null,
    context?.severity ? `Severity: ${context.severity}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `You are helping a developer write a precise code-review rule description.

The rule description is given verbatim to an LLM that reviews git diffs. It must be:
- Specific and unambiguous (say exactly what to look for in the added lines)
- Actionable (describe what IS and IS NOT allowed with clear examples when helpful)
- Concise (2-4 sentences maximum)
- Free of vague words like "avoid", "try to", "consider", "maybe"

${parts ? `Context:\n${parts}\n\n` : ""}Original (rough) description written by the user:
"${description.trim()}"

Rewrite this as a precise, LLM-readable rule description. Output ONLY the rewritten description — no preamble, no quotes, no explanation.`;

  const refined = await llm.generate(prompt, { maxTokens: 300, temperature: 0.2 });
  return refined.trim();
}

export function importRules(rules: Array<{
  name?: string;
  description?: string;
  severity?: string;
  scope?: string;
  created_by?: string;
}>): { inserted: string[]; skipped: string[]; errors: string[] } {
  const db = getDb();
  const existing = (db.prepare("SELECT LOWER(name) as n FROM team_rules").all() as { n: string }[]).map((r) => r.n);

  const inserted: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const rule of rules) {
    if (!rule.name?.trim() || !rule.description?.trim()) {
      errors.push(`Rule missing name or description: ${JSON.stringify(rule).slice(0, 60)}`);
      continue;
    }
    if (existing.includes(rule.name.trim().toLowerCase())) {
      skipped.push(rule.name.trim());
      continue;
    }
    insertTeamRule({
      name: rule.name,
      description: rule.description,
      severity: rule.severity ?? "warning",
      scope: rule.scope,
      created_by: rule.created_by,
    });
    inserted.push(rule.name.trim());
    existing.push(rule.name.trim().toLowerCase());
  }

  return { inserted, skipped, errors };
}

export async function runCheck(repo?: string, base = "main") {
  const db = getDb();

  const activeRules = db.prepare("SELECT COUNT(*) as n FROM team_rules WHERE enabled = 1").get() as { n: number };
  if (activeRules.n === 0) {
    return { passed: true, violations: [], message: "No active rules to check." };
  }

  const row = db.prepare("SELECT value FROM search_config WHERE key = 'extra_repos'").get() as { value: string } | undefined;
  const registeredRepos: Array<{ name: string; path: string }> = row ? JSON.parse(row.value) : [];

  let repoPath: string | null = null;
  if (repo) {
    repoPath = registeredRepos.find((r) => r.name === repo)?.path ?? null;
  } else if (registeredRepos.length > 0) {
    repoPath = registeredRepos[0]!.path;
  }

  if (!repoPath) {
    try {
      const { loadWorkspaceConfig } = await import("../config/workspace-config.js");
      const { userWorkspaceRootFrom } = await import("../utils/workspace.js");
      const wsRoot = userWorkspaceRootFrom(import.meta.url);
      const wsConfig = loadWorkspaceConfig(wsRoot);
      const wsRepos = wsConfig.repos;
      if (repo) {
        repoPath = wsRepos.find((r) => r.name === repo)?.path ?? null;
      } else if (wsRepos.length > 0) {
        repoPath = wsRepos[0]!.path;
      }
    } catch { /* workspace config not available */ }
  }

  if (!repoPath) {
    throw new Error("No repo path found. Add a repository in the Repositories page, or ensure srcmap.config.json is configured.");
  }

  const { runCheckCore } = await import("../cli/check.js");
  return runCheckCore(repoPath, { base, repo, strict: false, triggeredBy: "ui" });
}
