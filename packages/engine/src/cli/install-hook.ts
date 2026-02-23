/**
 * srcmap install-hook — installs git hooks for automatic KB updates and rule checks.
 *
 * Installed hooks:
 *   pre-push      — runs `srcmap check` before every push (blocks on errors)
 *   post-merge    — runs `srcmap sync` after `git pull` / `git merge`
 *   post-checkout — runs `srcmap sync` after branch switches (not file checkouts)
 *   post-rewrite  — runs `srcmap sync` after `git rebase`
 *
 * Branch classification in `srcmap sync` ensures demo/* and experimental
 * branches never pollute the shared knowledge base.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

interface HookOptions {
  base: string;
  strict: boolean;
}

function findGitRoot(cwd: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Writes (or appends to) a hook file. If the hook already contains the
 * srcmap marker, it is left untouched.
 */
async function writeHook(hookPath: string, script: string, hookName: string): Promise<void> {
  if (existsSync(hookPath)) {
    const existing = await readFile(hookPath, "utf-8");
    if (existing.includes("srcmap")) {
      console.log(`  ✓ ${hookName} — already installed at ${hookPath}`);
      return;
    }
    // Append below the existing content
    const appendable = script.split("\n").slice(3).join("\n"); // drop shebang block
    await writeFile(hookPath, existing.trimEnd() + "\n\n" + appendable, "utf-8");
    console.log(`  ✓ ${hookName} — appended to existing hook`);
  } else {
    await writeFile(hookPath, script, { encoding: "utf-8", mode: 0o755 });
    console.log(`  ✓ ${hookName} — installed at ${hookPath}`);
  }
}

// ---------------------------------------------------------------------------
// Hook scripts
// ---------------------------------------------------------------------------

function prePushScript(opts: HookOptions): string {
  const strictFlag = opts.strict ? " --strict" : "";
  return `#!/bin/sh
# srcmap pre-push — installed by \`srcmap install-hook\`
# Runs \`srcmap check\` before every push. Blocks on error-severity violations.
# To bypass: git push --no-verify

set -e

echo "[srcmap] Checking team rules before push…"

_srcmap_run() {
  if command -v srcmap > /dev/null 2>&1; then
    srcmap "$@"
  elif command -v pnpm > /dev/null 2>&1; then
    pnpm srcmap "$@"
  else
    echo "[srcmap] Warning: srcmap not found. Skipping."
    exit 0
  fi
}

_srcmap_run check --base ${opts.base}${strictFlag} --triggered-by pre-push
`;
}

function postMergeScript(): string {
  return `#!/bin/sh
# srcmap post-merge — installed by \`srcmap install-hook\`
# Runs \`srcmap sync\` after git pull / git merge to invalidate stale cards.
# Demo and experimental branches are silently skipped.
# Non-blocking: always exits 0.

_srcmap_run() {
  if command -v srcmap > /dev/null 2>&1; then
    srcmap "$@"
  elif command -v pnpm > /dev/null 2>&1; then
    pnpm srcmap "$@"
  else
    exit 0
  fi
}

_srcmap_run sync --event-type merge || true
`;
}

function postCheckoutScript(): string {
  return `#!/bin/sh
# srcmap post-checkout — installed by \`srcmap install-hook\`
# Runs \`srcmap sync --event-type checkout\` after branch switches.
# Passes the previous HEAD sha ($1) so the parent branch (e.g. epic/*)
# can be detected and stored as context for automatic MCP scoping.
#
# $1 = previous HEAD sha
# $2 = new HEAD sha
# $3 = 1 for branch checkout, 0 for file checkout
# Non-blocking: always exits 0.

# Only act on branch switches, not file checkouts
[ "$3" = "1" ] || exit 0

_srcmap_run() {
  if command -v srcmap > /dev/null 2>&1; then
    srcmap "$@"
  elif command -v pnpm > /dev/null 2>&1; then
    pnpm srcmap "$@"
  else
    exit 0
  fi
}

_srcmap_run sync --event-type checkout --prev-head "$1" || true
`;
}

function postRewriteScript(): string {
  return `#!/bin/sh
# srcmap post-rewrite — installed by \`srcmap install-hook\`
# Runs \`srcmap sync\` after git rebase to invalidate stale cards.
# Non-blocking: always exits 0.

_srcmap_run() {
  if command -v srcmap > /dev/null 2>&1; then
    srcmap "$@"
  elif command -v pnpm > /dev/null 2>&1; then
    pnpm srcmap "$@"
  else
    exit 0
  fi
}

_srcmap_run sync --event-type rebase || true
`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function installHook(cwd: string, opts: HookOptions): Promise<void> {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) {
    console.error("\nNot a git repository (or no git found). Run this from inside a git repo.\n");
    process.exit(1);
  }

  const hooksDir = join(gitRoot, ".git", "hooks");
  await mkdir(hooksDir, { recursive: true });

  console.log(`\nInstalling srcmap git hooks in ${hooksDir}\n`);

  await writeHook(join(hooksDir, "pre-push"),      prePushScript(opts),  "pre-push");
  await writeHook(join(hooksDir, "post-merge"),    postMergeScript(),    "post-merge");
  await writeHook(join(hooksDir, "post-checkout"), postCheckoutScript(), "post-checkout");
  await writeHook(join(hooksDir, "post-rewrite"),  postRewriteScript(),  "post-rewrite");

  console.log(`
  pre-push      — blocks push if error-severity team rules are violated
  post-merge    — invalidates stale cards after git pull / merge
  post-checkout — invalidates stale cards after branch switch
  post-rewrite  — invalidates stale cards after git rebase

  Base branch   : ${opts.base}
  Strict mode   : ${opts.strict ? "on (blocks on warnings)" : "off"}

  Branch rules for sync:
    demo/* / *-demo / *_demo → skipped (never pollutes KB)
    main / master / develop / staging / epic/* → full invalidation + cross-repo
    feature/* / fix/* / hotfix/* → lightweight (per-card only)

  To bypass pre-push: git push --no-verify
`);
}
