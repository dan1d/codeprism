#!/usr/bin/env node
/**
 * srcmap generate-skills — one-time LLM generation of skill knowledge/*.md files.
 *
 * Generates or regenerates the curated best-practice knowledge base used as
 * the framework baseline in code_style and rules prompts.
 *
 * Output files are written to src/skills/knowledge/<skill-id>.md and MUST be
 * human-reviewed before committing — they are static, version-controlled docs.
 *
 * Usage:
 *   pnpm srcmap generate-skills              # all skills
 *   pnpm srcmap generate-skills --skill rails # single skill
 *   pnpm srcmap generate-skills --force       # overwrite existing files
 */

import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLLMProvider } from "../llm/provider.js";
import {
  railsSkill, reactSkill, vueSkill, nextjsSkill, goSkill,
  pythonSkill, fastapiSkill, lambdaSkill, laravelSkill, djangoSkill,
  nestjsSkill, ginSkill, svelteSkill, angularSkill, springSkill, djangoRestSkill,
} from "../skills/index.js";
import type { Skill } from "../skills/types.js";

const ALL_SKILLS: Skill[] = [
  railsSkill, reactSkill, vueSkill, nextjsSkill, goSkill,
  pythonSkill, fastapiSkill, lambdaSkill, laravelSkill, djangoSkill,
  nestjsSkill, ginSkill, svelteSkill, angularSkill, springSkill, djangoRestSkill,
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = join(__dirname, "../skills/knowledge");

export interface GenerateSkillsOptions {
  /** Only regenerate this skill ID */
  skillFilter?: string;
  /** Overwrite existing .md files */
  force?: boolean;
}

const SKILL_GENERATION_PROMPT = (skill: { id: string; label: string }) => `
You are generating curated best-practice documentation for the "${skill.label}" framework.

This document seeds the framework baseline injected into code_style and rules prompts
by the srcmap indexer. It must be:
- Authoritative (from official docs, RFCs, widely-accepted community guides)
- Opinionated (clear "prefer X over Y" statements, not "you can use either")
- Concise (7-10 bullets per section, no prose paragraphs)
- Project-agnostic (not specific to any one codebase)

Write a Markdown document with EXACTLY these sections:

# ${skill.label} Best Practices

> Curated conventions used by srcmap to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
(7-10 bullets: structural decisions, layering, module boundaries, key patterns)

## Code Style
(7-10 bullets: naming conventions, method length, language idioms, readability rules)

## Testing
(5-7 bullets: test framework, factories vs fixtures, test scope, coverage philosophy)

## Performance
(5-7 bullets: N+1 prevention, caching, query optimization, profiling approach)

## Security
(5-7 bullets: authentication, authorization, input validation, secret management)

## Anti-Patterns
(5-7 bullets: common mistakes to avoid in ${skill.label} codebases)

Output ONLY the Markdown document. No preamble, no explanation.
`.trim();

export async function generateSkillKnowledge(opts: GenerateSkillsOptions = {}): Promise<void> {
  const llm = createLLMProvider();
  if (!llm) {
    console.error(
      "[generate-skills] No LLM configured.\n" +
      "  Set SRCMAP_LLM_PROVIDER + SRCMAP_LLM_API_KEY and retry.\n" +
      "  Tip: use a high-quality model (claude-sonnet, gpt-4o) for best results."
    );
    process.exit(1);
  }

  const skills = opts.skillFilter
    ? ALL_SKILLS.filter((s) => s.id === opts.skillFilter)
    : ALL_SKILLS;

  if (opts.skillFilter && skills.length === 0) {
    console.error(`[generate-skills] Unknown skill ID "${opts.skillFilter}". Known: ${ALL_SKILLS.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n=== srcmap generate-skills ===`);
  console.log(`LLM: ${llm.model}`);
  console.log(`Skills: ${skills.map((s) => s.id).join(", ")}`);
  console.log(`Output: ${KNOWLEDGE_DIR}\n`);

  let written = 0;
  let skipped = 0;

  for (const skill of skills) {
    const outputPath = join(KNOWLEDGE_DIR, `${skill.id}.md`);

    if (!opts.force && existsSync(outputPath)) {
      const existing = await readFile(outputPath, "utf-8").catch(() => "");
      if (existing.trim().length > 200) {
        console.log(`  [skip] ${skill.id} — file exists (use --force to overwrite)`);
        skipped++;
        continue;
      }
    }

    process.stdout.write(`  [generating] ${skill.label} (${skill.id})...`);

    try {
      const prompt = SKILL_GENERATION_PROMPT(skill);
      const content = await llm.generate(prompt, { maxTokens: 1200 });

      await writeFile(outputPath, content.trim() + "\n", "utf-8");
      console.log(` ✓ (${content.length} chars)`);
      written++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(` ✗ ${msg}`);
    }

    // Brief pause between calls to respect rate limits
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`\n=== Done: ${written} generated, ${skipped} skipped ===`);
  console.log(`\nIMPORTANT: Review generated files before committing!`);
  console.log(`  cd ${KNOWLEDGE_DIR} && ls -la`);
}
