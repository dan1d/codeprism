/**
 * codeprism rules — CLI helpers for managing team rules from the terminal.
 */

import { randomUUID } from "node:crypto";
import { getDb, closeDb } from "../db/connection.js";
import type { TeamRule } from "../db/schema.js";

const SEVERITY_COLOR: Record<string, string> = {
  error:   "\x1b[31m", // red
  warning: "\x1b[33m", // yellow
  info:    "\x1b[36m", // cyan
};
const RESET = "\x1b[0m";
const DIM   = "\x1b[2m";
const BOLD  = "\x1b[1m";

export async function listRules(): Promise<void> {
  const db = getDb();
  const rules = db.prepare(
    "SELECT * FROM team_rules ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, name"
  ).all() as TeamRule[];
  closeDb();

  if (rules.length === 0) {
    console.log("\nNo team rules defined yet. Add one with:\n  codeprism rules add --name '...' --desc '...'\n");
    return;
  }

  console.log(`\n${BOLD}Team Rules${RESET} (${rules.length})\n`);
  for (const r of rules) {
    const col = SEVERITY_COLOR[r.severity] ?? "";
    const status = r.enabled ? "" : ` ${DIM}[disabled]${RESET}`;
    console.log(`  ${col}[${r.severity.toUpperCase()}]${RESET}${status} ${BOLD}${r.name}${RESET}`);
    console.log(`  ${DIM}${r.id}${RESET}`);
    console.log(`  ${r.description}`);
    if (r.scope) console.log(`  ${DIM}scope: ${r.scope}${RESET}`);
    if (r.created_by) console.log(`  ${DIM}by: ${r.created_by}${RESET}`);
    console.log();
  }
}

export async function addRule(opts: {
  name?: string;
  desc?: string;
  severity?: string;
  scope?: string;
  by?: string;
}): Promise<void> {
  if (!opts.name?.trim() || !opts.desc?.trim()) {
    console.error("Error: --name and --desc are required.\n");
    console.error("  Example: codeprism rules add --name 'No one-line methods' --desc 'Methods must use a do/end block and span multiple lines' --severity warning --by leo\n");
    process.exit(1);
  }

  const validSeverities = ["error", "warning", "info"];
  const severity = validSeverities.includes(opts.severity ?? "") ? opts.severity! : "warning";

  const db = getDb();
  const id = `rule_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  db.prepare(`
    INSERT INTO team_rules (id, name, description, severity, scope, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, opts.name.trim(), opts.desc.trim(), severity, opts.scope?.trim() || null, opts.by?.trim() || null);
  closeDb();

  const col = SEVERITY_COLOR[severity] ?? "";
  console.log(`\n${col}✓${RESET} Rule added: ${BOLD}${opts.name}${RESET} ${DIM}(${id})${RESET}\n`);
  console.log(`  It will be checked on the next "codeprism check" run.\n`);
}

export async function deleteRule(id: string): Promise<void> {
  const db = getDb();
  const rule = db.prepare("SELECT * FROM team_rules WHERE id = ?").get(id) as TeamRule | undefined;
  if (!rule) {
    console.error(`\nRule not found: ${id}\nRun "codeprism rules list" to see available IDs.\n`);
    closeDb();
    process.exit(1);
  }
  db.prepare("DELETE FROM team_rules WHERE id = ?").run(id);
  closeDb();
  console.log(`\n✓ Deleted rule: ${rule.name} (${id})\n`);
}
