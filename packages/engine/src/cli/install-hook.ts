/**
 * srcmap install-hook — writes a pre-push git hook to .git/hooks/pre-push.
 *
 * The installed hook runs `srcmap check` before every git push and blocks
 * the push if any error-severity rules are violated.
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
    return execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

export async function installHook(cwd: string, opts: HookOptions): Promise<void> {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) {
    console.error("\nNot a git repository (or no git found). Run this from inside a git repo.\n");
    process.exit(1);
  }

  const hooksDir = join(gitRoot, ".git", "hooks");
  await mkdir(hooksDir, { recursive: true });

  const hookPath = join(hooksDir, "pre-push");
  const strictFlag = opts.strict ? " --strict" : "";

  const hookScript = `#!/bin/sh
# srcmap pre-push hook — installed by \`srcmap install-hook\`
# Runs srcmap check before every push. Blocks push on error-severity violations.
# To skip: git push --no-verify
#
# Re-install or update: srcmap install-hook --base ${opts.base}${opts.strict ? " --strict" : ""}
# Remove: rm .git/hooks/pre-push

set -e

echo "[srcmap] Checking team rules before push…"

if ! command -v srcmap > /dev/null 2>&1; then
  # Try via pnpm (monorepo)
  if command -v pnpm > /dev/null 2>&1; then
    pnpm srcmap check --base ${opts.base}${strictFlag} --triggered-by pre-push
  else
    echo "[srcmap] Warning: srcmap not found in PATH. Skipping rule check."
    echo "[srcmap] Install: npm i -g @srcmap/cli  or run from your monorepo root."
    exit 0
  fi
else
  srcmap check --base ${opts.base}${strictFlag} --triggered-by pre-push
fi
`;

  // Don't clobber an existing hook — append or warn
  if (existsSync(hookPath)) {
    const existing = await readFile(hookPath, "utf-8");
    if (existing.includes("srcmap")) {
      console.log(`\n✓ Pre-push hook already contains srcmap check at:\n  ${hookPath}\n`);
      console.log(`  To reinstall with new options, delete the hook first:\n  rm ${hookPath}\n`);
      return;
    }
    // Append to existing hook
    await writeFile(hookPath, existing.trimEnd() + "\n\n" + hookScript.split("\n").slice(3).join("\n"), "utf-8");
    console.log(`\n✓ Appended srcmap check to existing pre-push hook:\n  ${hookPath}\n`);
  } else {
    await writeFile(hookPath, hookScript, { encoding: "utf-8", mode: 0o755 });
    console.log(`\n✓ Pre-push hook installed at:\n  ${hookPath}\n`);
  }

  console.log(`  Base branch : ${opts.base}`);
  console.log(`  Strict mode : ${opts.strict ? "on (blocks on warnings too)" : "off (only blocks on errors)"}`);
  console.log(`\n  Every "git push" will now run "srcmap check" first.`);
  console.log(`  To bypass: git push --no-verify\n`);
}
