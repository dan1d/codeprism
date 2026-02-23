#!/usr/bin/env node
/**
 * Development smoke test: verify that skill detection produces expected IDs
 * for the repos in this workspace.
 *
 * Usage: pnpm --filter @srcmap/engine exec tsx src/cli/verify-skills.ts
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { detectStackProfile } from "../indexer/stack-profiler.js";
import { resolveSkills } from "../skills/index.js";
import { userWorkspaceRootFrom } from "../utils/workspace.js";

const WORKSPACE_ROOT = userWorkspaceRootFrom(import.meta.url);

const entries = readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
const repoDirs = entries
  .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "srcmap")
  .map((e) => join(WORKSPACE_ROOT, e.name))
  .filter(
    (dir) =>
      existsSync(join(dir, "package.json")) ||
      existsSync(join(dir, "Gemfile")) ||
      existsSync(join(dir, "go.mod")),
  );

console.log(`\n=== srcmap skill detection smoke test ===\n`);

let allGood = true;
for (const dir of repoDirs) {
  const name = dir.split("/").at(-1) ?? dir;
  const profile = detectStackProfile(dir);
  const skills = resolveSkills(profile.skillIds);

  const status = profile.skillIds.length > 0 ? "✓" : "⚠ no skills detected";
  console.log(`${status}  ${name}`);
  console.log(`   language: ${profile.primaryLanguage}`);
  console.log(`   frameworks: ${profile.frameworks.join(", ") || "(none)"}`);
  console.log(`   skill IDs: ${profile.skillIds.join(", ") || "(none)"}`);
  console.log(`   resolved: ${skills.map((s) => s.label).join(", ") || "(none)"}`);
  console.log();

  if (profile.skillIds.length === 0 && profile.primaryLanguage !== "unknown") {
    allGood = false;
  }
}

console.log(
  allGood
    ? "All repos have at least one skill."
    : "WARNING: some repos have no skills detected.",
);
process.exit(allGood ? 0 : 1);
