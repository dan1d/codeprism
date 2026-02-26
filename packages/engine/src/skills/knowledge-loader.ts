/**
 * knowledge-loader.ts
 *
 * Loads framework best-practice knowledge from Markdown files.
 *
 * Resolution order (first hit wins for each skill):
 *   1. CODEPRISM_KNOWLEDGE_DIR/<skill-id>.md   — user / team override
 *   2. <workspace>/.codeprism/knowledge/<id>.md — workspace-local contribution
 *   3. src/skills/knowledge/<id>.md             — built-in (shipped with codeprism)
 *
 * This makes the knowledge base community-extensible: anyone can drop a
 * `myframework.md` file in CODEPRISM_KNOWLEDGE_DIR and codeprism picks it up on
 * next index — no TypeScript skill registration required.
 *
 * ## Community contribution format
 *
 * ```markdown
 * # <Framework> Best Practices
 *
 * ## Architecture
 * - bullet one
 * - bullet two
 *
 * ## Code Style
 * - bullet one
 *
 * ## Testing
 * ## Performance
 * ## Security
 * ## Anti-Patterns
 * ```
 *
 * Only recognised section headers are parsed; unknown headers are ignored.
 * Sections missing from the file produce empty arrays (the TypeScript skill
 * bestPractices is used as fallback for any empty section).
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { BestPractices } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTIN_KNOWLEDGE_DIR = join(__dirname, "knowledge");

/** Section header → BestPractices key mapping (case-insensitive match on first word). */
const SECTION_MAP: Record<string, keyof BestPractices> = {
  architecture: "architecture",
  "code style":  "codeStyle",
  "code-style":  "codeStyle",
  codestyle:     "codeStyle",
  testing:       "testing",
  performance:   "performance",
  security:      "security",
  "anti-patterns": "antiPatterns",
  antipatterns:    "antiPatterns",
  "anti patterns": "antiPatterns",
};

/**
 * Parse a knowledge Markdown file into a BestPractices object.
 * Returns null if the file cannot be read.
 */
export async function parseKnowledgeFile(filePath: string): Promise<Partial<BestPractices> | null> {
  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  const result: Partial<BestPractices> = {};
  let currentKey: keyof BestPractices | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();

    // Section header: ## Architecture, ## Code Style, etc.
    if (line.startsWith("## ")) {
      const heading = line.slice(3).toLowerCase().replace(/\s+to\s+flag$/i, "").trim();
      currentKey = SECTION_MAP[heading] ?? null;
      if (currentKey && !result[currentKey]) {
        result[currentKey] = [];
      }
      continue;
    }

    // Bullet item inside a recognised section
    if (currentKey && line.match(/^[-*]\s+/)) {
      const bullet = line.replace(/^[-*]\s+/, "").trim();
      if (bullet) {
        (result[currentKey] as string[]).push(bullet);
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Merge parsed markdown BestPractices into a base BestPractices object.
 * Non-empty arrays from the markdown override the base; empty arrays fall
 * back to the base so a partial file doesn't erase built-in content.
 */
function mergePractices(base: BestPractices, override: Partial<BestPractices>): BestPractices {
  return {
    architecture:  override.architecture?.length  ? override.architecture  : base.architecture,
    codeStyle:     override.codeStyle?.length     ? override.codeStyle     : base.codeStyle,
    testing:       override.testing?.length       ? override.testing       : base.testing,
    performance:   override.performance?.length   ? override.performance   : base.performance,
    security:      override.security?.length      ? override.security      : base.security,
    antiPatterns:  override.antiPatterns?.length  ? override.antiPatterns  : base.antiPatterns,
  };
}

/**
 * Resolve candidate knowledge file paths for a skill ID, in priority order.
 *
 * @param skillId    e.g. "rails", "react", "myframework"
 * @param workspaceRoot  root of the user's project workspace
 */
function candidatePaths(skillId: string, workspaceRoot: string): string[] {
  const candidates: string[] = [];

  // 1. Explicit env override dir (team / CI override)
  const envDir = process.env["CODEPRISM_KNOWLEDGE_DIR"];
  if (envDir) candidates.push(join(envDir, `${skillId}.md`));

  // 2. Workspace-local contribution directory
  candidates.push(join(workspaceRoot, ".codeprism", "knowledge", `${skillId}.md`));

  // 3. Built-in (shipped with codeprism engine package)
  candidates.push(join(BUILTIN_KNOWLEDGE_DIR, `${skillId}.md`));

  return candidates;
}

/**
 * Load the best-practice knowledge for a skill, applying community/user
 * overrides on top of the TypeScript skill's built-in bestPractices.
 *
 * @param skillId        Skill identifier (e.g. "rails")
 * @param base           TypeScript skill's bestPractices (fallback)
 * @param workspaceRoot  User workspace root for local knowledge lookup
 * @returns              Merged BestPractices (override wins per section)
 */
export async function loadKnowledge(
  skillId: string,
  base: BestPractices,
  workspaceRoot: string,
): Promise<BestPractices> {
  for (const path of candidatePaths(skillId, workspaceRoot)) {
    if (!existsSync(path)) continue;
    const parsed = await parseKnowledgeFile(path);
    if (parsed) return mergePractices(base, parsed);
  }
  return base;
}

/**
 * Load knowledge for multiple skills concurrently.
 * Returns a map of skillId → merged BestPractices.
 */
export async function loadAllKnowledge(
  skills: Array<{ id: string; bestPractices: BestPractices }>,
  workspaceRoot: string,
): Promise<Map<string, BestPractices>> {
  const entries = await Promise.all(
    skills.map(async (s) => [s.id, await loadKnowledge(s.id, s.bestPractices, workspaceRoot)] as const),
  );
  return new Map(entries);
}

/**
 * List all discoverable skill IDs, including community-contributed ones
 * that have no corresponding TypeScript Skill definition.
 *
 * Community frameworks: any `.md` file in CODEPRISM_KNOWLEDGE_DIR or
 * <workspace>/.codeprism/knowledge/ whose stem doesn't match a built-in skill.
 */
export async function discoverCommunitySkillIds(
  builtinIds: Set<string>,
  workspaceRoot: string,
): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const dirs: string[] = [];

  const envDir = process.env["CODEPRISM_KNOWLEDGE_DIR"];
  if (envDir) dirs.push(envDir);
  dirs.push(join(workspaceRoot, ".codeprism", "knowledge"));

  const communityIds: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const files = await readdir(dir);
      for (const f of files) {
        if (!f.endsWith(".md")) continue;
        const id = f.slice(0, -3);
        if (!builtinIds.has(id) && !communityIds.includes(id)) {
          communityIds.push(id);
        }
      }
    } catch { /* skip unreadable dirs */ }
  }
  return communityIds;
}
