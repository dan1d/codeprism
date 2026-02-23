#!/usr/bin/env node
/**
 * srcmap generate-skills — LLM generation of skill knowledge/*.md files.
 *
 * Generates or regenerates the curated best-practice knowledge base used as
 * the framework baseline in code_style and rules prompts.
 *
 * By default, output is written to src/skills/knowledge/<skill-id>.md (built-in).
 * Use --output-dir to write to a custom directory instead — community contributions
 * and team-specific knowledge live outside the engine package.
 *
 * Usage:
 *   pnpm srcmap generate-skills                        # all built-in skills → skills/knowledge/
 *   pnpm srcmap generate-skills --skill rails          # single skill
 *   pnpm srcmap generate-skills --force                # overwrite existing files
 *   pnpm srcmap generate-skills --output-dir ./knowledge  # custom output dir
 *   pnpm srcmap generate-skills --skill myrails --output-dir ~/.srcmap/knowledge  # community skill
 *
 * Community contributions:
 *   Place <framework>.md files in SRCMAP_KNOWLEDGE_DIR or <workspace>/.srcmap/knowledge/.
 *   srcmap picks them up automatically on next index — no TypeScript required.
 *   See: https://github.com/your-org/srcmap#community-knowledge
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
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
const BUILTIN_KNOWLEDGE_DIR = join(__dirname, "../skills/knowledge");

/**
 * Authoritative community/official style guide sources per skill.
 * Raw GitHub URLs preferred (direct markdown); official docs URLs as fallback.
 * Content is fetched and passed to the LLM as grounding context so the
 * generated file is extracted from real authoritative material, not hallucinated.
 */
const SKILL_SOURCES: Record<string, string[]> = {
  rails: [
    "https://raw.githubusercontent.com/rubocop/ruby-style-guide/master/README.adoc",
    "https://raw.githubusercontent.com/rubocop/rails-style-guide/master/README.adoc",
  ],
  react: [
    "https://raw.githubusercontent.com/airbnb/javascript/master/react/README.md",
  ],
  vue: [
    "https://raw.githubusercontent.com/pablohpsilva/vuejs-component-style-guide/master/README.md",
  ],
  nextjs: [
    "https://raw.githubusercontent.com/alan2207/bulletproof-react/master/docs/project-standards.md",
  ],
  go: [
    "https://raw.githubusercontent.com/uber-go/guide/master/style.md",
  ],
  python: [
    "https://raw.githubusercontent.com/google/styleguide/gh-pages/pyguide.md",
  ],
  django: [
    "https://raw.githubusercontent.com/HackSoftware/Django-Styleguide/master/README.md",
  ],
  nestjs: [
    "https://raw.githubusercontent.com/nestjs/nest/master/readme.md",
  ],
  angular: [
    "https://raw.githubusercontent.com/mgechev/angular-style-guide/master/README.md",
  ],
  laravel: [
    "https://raw.githubusercontent.com/alexeymezenin/laravel-best-practices/master/README.md",
  ],
  spring: [
    "https://raw.githubusercontent.com/spring-guides/tut-spring-boot-kotlin/main/README.adoc",
  ],
};

/** Fetch a URL and return the text, truncated to maxChars. Returns null on failure. */
async function fetchSource(url: string, maxChars = 6000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "srcmap-generate-skills/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // Strip AsciiDoc headers/attributes (for RuboCop guides which use .adoc)
    const cleaned = text
      .replace(/^:.*$/gm, "")        // AsciiDoc attributes
      .replace(/^\[.*\]$/gm, "")     // AsciiDoc roles
      .replace(/^={1,6}\s+/gm, "# ") // AsciiDoc headings → markdown
      .replace(/\r\n/g, "\n");
    return cleaned.slice(0, maxChars);
  } catch {
    return null;
  }
}

/** Fetch all sources for a skill and return combined context (up to ~8000 chars total). */
async function fetchSkillSources(skillId: string): Promise<string> {
  const urls = SKILL_SOURCES[skillId];
  if (!urls?.length) return "";

  const parts: string[] = [];
  for (const url of urls) {
    const text = await fetchSource(url, 4000);
    if (text) {
      parts.push(`### From: ${url}\n\n${text}`);
    }
  }
  return parts.join("\n\n---\n\n").slice(0, 8000);
}

export interface GenerateSkillsOptions {
  /** Only regenerate this skill ID */
  skillFilter?: string;
  /** Overwrite existing .md files */
  force?: boolean;
  /**
   * Custom output directory.
   * Default: src/skills/knowledge/ (built-in, shipped with srcmap).
   * Set this to write community / team knowledge outside the engine package,
   * e.g. ~/.srcmap/knowledge/ or <workspace>/.srcmap/knowledge/.
   */
  outputDir?: string;
}

const SKILL_GENERATION_PROMPT = (skill: { id: string; label: string }, sourceContext = "") => `
You are generating curated best-practice documentation for the "${skill.label}" framework.

This document seeds the framework baseline injected into code_style and rules prompts
by the srcmap indexer. It must be:
- Authoritative (grounded in the official/community sources provided below when available)
- Opinionated (clear "prefer X over Y" statements, not "you can use either")
- Concise (7-10 bullets per section, no prose paragraphs)
- Project-agnostic (not specific to any one codebase)
${sourceContext ? `
## Authoritative Sources (extract and reformat from these — do not hallucinate)

${sourceContext}

---

` : ""}
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

  const outputDir = opts.outputDir
    ? resolve(opts.outputDir)
    : BUILTIN_KNOWLEDGE_DIR;

  const isCommunityDir = outputDir !== BUILTIN_KNOWLEDGE_DIR;

  // For community dirs, allow arbitrary skill IDs (not just built-in ones)
  let skills: Skill[];
  if (opts.skillFilter) {
    skills = ALL_SKILLS.filter((s) => s.id === opts.skillFilter);
    if (skills.length === 0) {
      if (isCommunityDir) {
        // Community mode: generate for any skill ID, even if not registered
        skills = [{ id: opts.skillFilter, label: opts.skillFilter } as Skill];
      } else {
        console.error(`[generate-skills] Unknown skill ID "${opts.skillFilter}". Known: ${ALL_SKILLS.map((s) => s.id).join(", ")}\n  Tip: use --output-dir to generate community skills.`);
        process.exit(1);
      }
    }
  } else {
    skills = ALL_SKILLS;
  }

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  console.log(`\n=== srcmap generate-skills ===`);
  console.log(`LLM: ${llm.model}`);
  console.log(`Skills: ${skills.map((s) => s.id).join(", ")}`);
  console.log(`Output: ${outputDir}`);
  if (isCommunityDir) {
    console.log(`Mode: community/custom (srcmap will load these via SRCMAP_KNOWLEDGE_DIR or .srcmap/knowledge/)`);
  }
  console.log();

  let written = 0;
  let skipped = 0;

  for (const skill of skills) {
    const outputPath = join(outputDir, `${skill.id}.md`);

    if (!opts.force && existsSync(outputPath)) {
      const existing = await readFile(outputPath, "utf-8").catch(() => "");
      if (existing.trim().length > 200) {
        console.log(`  [skip] ${skill.id} — file exists (use --force to overwrite)`);
        skipped++;
        continue;
      }
    }

    // Fetch authoritative source material to ground the generation
    const sourcesAvailable = !!SKILL_SOURCES[skill.id]?.length;
    process.stdout.write(`  [${sourcesAvailable ? "fetch+" : ""}generating] ${skill.label ?? skill.id} (${skill.id})...`);

    try {
      const sourceContext = sourcesAvailable ? await fetchSkillSources(skill.id) : "";
      if (sourcesAvailable && !sourceContext) {
        process.stdout.write(" (sources unavailable, using LLM knowledge)");
      }
      const prompt = SKILL_GENERATION_PROMPT({ id: skill.id, label: skill.label ?? skill.id }, sourceContext);
      const content = await llm.generate(prompt, { maxTokens: 1500 });

      await writeFile(outputPath, content.trim() + "\n", "utf-8");
      console.log(` ✓ (${content.length} chars)`);
      written++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(` ✗ ${msg}`);
    }

    // Brief pause between calls to respect rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n=== Done: ${written} generated, ${skipped} skipped ===`);
  if (isCommunityDir) {
    console.log(`\nTo activate: set SRCMAP_KNOWLEDGE_DIR=${outputDir}`);
    console.log(`  or place files in <workspace>/.srcmap/knowledge/`);
  } else {
    console.log(`\nIMPORTANT: Review generated files before committing!`);
    console.log(`  cd ${outputDir} && ls -la`);
  }
}
