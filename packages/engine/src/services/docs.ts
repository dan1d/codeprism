import { readFileSync, existsSync } from "node:fs";
import { writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { getDb } from "../db/connection.js";
import type { ProjectDoc } from "../db/schema.js";
import { buildRefreshDocPrompt, buildFrameworkBaseline, DOC_SYSTEM_PROMPT, type DocType } from "../indexer/doc-prompts.js";
import { resolveSkills } from "../skills/index.js";
import { getLLMFromDb } from "./instance.js";
import { getWorkspaceRoot, safeParseJsonArray } from "./utils.js";

const _moduleDir = dirname(fileURLToPath(import.meta.url));

export function listProjectDocs(repo?: string, docType?: string): ProjectDoc[] {
  const db = getDb();
  if (repo && docType) {
    return [db.prepare("SELECT * FROM project_docs WHERE repo = ? AND doc_type = ?").get(repo, docType)].filter(Boolean) as ProjectDoc[];
  } else if (repo) {
    return db.prepare("SELECT * FROM project_docs WHERE repo = ? ORDER BY doc_type").all(repo) as ProjectDoc[];
  }
  return db.prepare("SELECT * FROM project_docs ORDER BY repo, doc_type").all() as ProjectDoc[];
}

export async function refreshDocs(targetRepo?: string): Promise<{ refreshed: number; skipped: number; errors: string[] }> {
  const db = getDb();

  const llm = getLLMFromDb();
  if (!llm) throw new Error("LLM not configured. Set SRCMAP_LLM_PROVIDER and SRCMAP_LLM_API_KEY to enable refresh.");

  const staleQuery = targetRepo
    ? "SELECT * FROM project_docs WHERE stale = 1 AND repo = ? ORDER BY repo, doc_type"
    : "SELECT * FROM project_docs WHERE stale = 1 ORDER BY repo, doc_type";

  const staleDocs = (targetRepo
    ? db.prepare(staleQuery).all(targetRepo)
    : db.prepare(staleQuery).all()
  ) as ProjectDoc[];

  if (staleDocs.length === 0) {
    return { refreshed: 0, skipped: 0, errors: [] };
  }

  let refreshed = 0;
  let skipped = 0;
  const errors: string[] = [];

  const repoBaselines = new Map<string, string>();
  const getRepoBaseline = (repo: string): string => {
    if (repoBaselines.has(repo)) return repoBaselines.get(repo)!;
    const profileRow = db
      .prepare("SELECT skill_ids FROM repo_profiles WHERE repo = ?")
      .get(repo) as { skill_ids: string } | undefined;
    if (!profileRow) { repoBaselines.set(repo, ""); return ""; }
    const skillIds = safeParseJsonArray(profileRow.skill_ids);
    const skills = resolveSkills(skillIds);
    const baseline = skills.length > 0
      ? buildFrameworkBaseline(skills.map((s) => s.bestPractices))
      : "";
    repoBaselines.set(repo, baseline);
    return baseline;
  };

  for (const doc of staleDocs) {
    const sourceFilePaths = safeParseJsonArray(doc.source_file_paths);

    const availableFiles = sourceFilePaths
      .filter((p) => existsSync(p))
      .map((p) => {
        try {
          const raw = readFileSync(p, "utf-8");
          const lines = raw.split("\n");
          const content = lines.length > 120
            ? lines.slice(0, 120).join("\n") + `\n... (${lines.length - 120} more lines)`
            : raw.trimEnd();
          return { path: p, content };
        } catch { return null; }
      })
      .filter((f): f is { path: string; content: string } => f !== null);

    if (availableFiles.length === 0) {
      skipped++;
      errors.push(`${doc.repo}/${doc.doc_type}: no source files available on disk`);
      continue;
    }

    try {
      const baseline = getRepoBaseline(doc.repo);
      const prompt = buildRefreshDocPrompt(doc.doc_type as DocType, doc.repo, availableFiles, baseline);
      const newContent = await llm.generate(prompt, { systemPrompt: DOC_SYSTEM_PROMPT, maxTokens: 1200 });

      db.prepare(
        `UPDATE project_docs SET content = ?, stale = 0, updated_at = datetime('now') WHERE id = ?`,
      ).run(newContent, doc.id);

      refreshed++;
    } catch (err) {
      skipped++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${doc.repo}/${doc.doc_type}: LLM error — ${msg.slice(0, 100)}`);
    }
  }

  return { refreshed, skipped, errors };
}

export async function listKnowledgeFiles(): Promise<Array<{ id: string; source: "builtin" | "custom" }>> {
  const workspaceRoot = getWorkspaceRoot();
  const customDir = join(workspaceRoot, ".srcmap", "knowledge");
  const builtinDir = resolve(_moduleDir, "../skills/knowledge");

  const readDir = async (dir: string, source: "builtin" | "custom") => {
    if (!existsSync(dir)) return [];
    try {
      const files = await readdir(dir);
      return files
        .filter((f) => f.endsWith(".md"))
        .map((f) => ({ id: f.slice(0, -3), source }));
    } catch { return []; }
  };

  const [builtin, custom] = await Promise.all([
    readDir(builtinDir, "builtin"),
    readDir(customDir, "custom"),
  ]);

  const customIds = new Set(custom.map((f) => f.id));
  return [
    ...custom,
    ...builtin.filter((f) => !customIds.has(f.id)),
  ].sort((a, b) => a.id.localeCompare(b.id));
}

export async function saveKnowledgeFile(skillId: string, content: string): Promise<{ skillId: string; path: string }> {
  const sanitized = skillId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  if (!sanitized) throw new Error("Invalid skillId");
  if (content.length > 500_000) throw new Error("Content exceeds 500 KB limit");

  const workspaceRoot = getWorkspaceRoot();
  const customDir = join(workspaceRoot, ".srcmap", "knowledge");
  await mkdir(customDir, { recursive: true });

  const filePath = join(customDir, `${sanitized}.md`);
  await writeFile(filePath, content.trim() + "\n", "utf-8");

  return { skillId: sanitized, path: filePath };
}
