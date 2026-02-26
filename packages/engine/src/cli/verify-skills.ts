#!/usr/bin/env node
/**
 * Development smoke test: verify that skill detection produces expected IDs
 * for the repos in this workspace.
 *
 * Usage: pnpm --filter @codeprism/engine exec tsx src/cli/verify-skills.ts
 */
import { detectStackProfile } from "../indexer/stack-profiler.js";
import { resolveSkills } from "../skills/index.js";
import { loadWorkspace } from "../utils/workspace.js";

const workspace = loadWorkspace(import.meta.url);
const repoDirs = workspace.repos;

console.log(`\n=== codeprism skill detection smoke test ===\n`);

let allGood = true;
for (const repo of repoDirs) {
  const profile = detectStackProfile(repo.path);
  const skills = resolveSkills(profile.skillIds);

  const status = profile.skillIds.length > 0 ? "✓" : "⚠ no skills detected";
  console.log(`${status}  ${repo.name}`);
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
