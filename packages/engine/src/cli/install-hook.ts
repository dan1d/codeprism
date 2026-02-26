/**
 * codeprism install-hook — installs git hooks for automatic KB updates.
 *
 * Works with any editor: Cursor, Windsurf, Claude Code, Zed, Lovable, VS Code.
 * For editors with the VS Code extension, git hooks are installed automatically.
 * For Claude Code, Zed, and others — run this once per repo.
 *
 * Installed hooks:
 *   post-commit   — syncs after each commit (best for non-extension editors)
 *   post-merge    — runs sync after `git pull` / `git merge`
 *   post-checkout — runs sync after branch switches (not file checkouts)
 *   post-rewrite  — runs sync after `git rebase`
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

interface HookOptions {
  base: string;
  strict: boolean;
  engineUrl?: string;
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
 * Writes (or appends to) a hook file. Idempotent — skips if already installed.
 */
async function writeHook(hookPath: string, script: string, hookName: string): Promise<void> {
  if (existsSync(hookPath)) {
    const existing = await readFile(hookPath, "utf-8");
    if (existing.includes("codeprism")) {
      console.log(`  ✓ ${hookName} — already installed at ${hookPath}`);
      return;
    }
    const appendable = script.split("\n").slice(3).join("\n");
    await writeFile(hookPath, existing.trimEnd() + "\n\n" + appendable, "utf-8");
    console.log(`  ✓ ${hookName} — appended to existing hook`);
  } else {
    await writeFile(hookPath, script, { encoding: "utf-8", mode: 0o755 });
    console.log(`  ✓ ${hookName} — installed at ${hookPath}`);
  }
}

// ---------------------------------------------------------------------------
// Hook scripts — shell + python (best-effort, non-blocking)
// ---------------------------------------------------------------------------

function syncRunner(engineUrl: string): string {
  return `
_codeprism_sync_range() {
  CODEPRISM_URL="${engineUrl}"
  CODEPRISM_EVENT="$1"
  CODEPRISM_RANGE="$2"

  CHANGES="$(git diff --name-status $CODEPRISM_RANGE 2>/dev/null || true)"
  [ -n "$CHANGES" ] || return 0

  PY="$(command -v python3 || command -v python || true)"
  [ -n "$PY" ] || return 0

  PAYLOAD="$(printf "%s" "$CHANGES" | "$PY" - <<'PY'
import json, os, subprocess, sys

repo = os.path.basename(subprocess.check_output(["git", "rev-parse", "--show-toplevel"]).decode().strip())
branch = subprocess.check_output(["git", "rev-parse", "--abbrev-ref", "HEAD"]).decode().strip()
event = os.environ.get("CODEPRISM_EVENT") or "save"

changed = []
for line in sys.stdin.read().splitlines():
    if not line.strip():
        continue
    parts = line.split("\\t")
    if len(parts) < 2:
        continue
    status, path = parts[0], parts[1]
    st = "modified"
    if status.startswith("A") or status == "??":
        st = "added"
    elif status.startswith("D"):
        st = "deleted"
    content = ""
    if st != "deleted":
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception:
            content = ""
    changed.append({"path": path, "content": content, "status": st})

print(json.dumps({"repo": repo, "branch": branch, "eventType": event, "changedFiles": changed}))
PY
)"

  printf "%s" "$PAYLOAD" | curl -sf -X POST "$CODEPRISM_URL/api/sync" \\
    -H "Content-Type: application/json" \\
    --data-binary @- \\
    > /dev/null 2>&1 || true
}`;
}

function postCommitScript(engineUrl: string): string {
  return `#!/bin/sh
# codeprism post-commit — installed by \`codeprism install-hook\`
# Syncs after each commit. Non-blocking.
${syncRunner(engineUrl)}

_codeprism_sync_range save "HEAD~1..HEAD"
`;
}

function postMergeScript(engineUrl: string): string {
  return `#!/bin/sh
# codeprism post-merge — installed by \`codeprism install-hook\`
# Syncs after git pull / merge. Non-blocking.
${syncRunner(engineUrl)}

_codeprism_sync_range merge "ORIG_HEAD..HEAD"
`;
}

function postCheckoutScript(engineUrl: string): string {
  return `#!/bin/sh
# codeprism post-checkout — installed by \`codeprism install-hook\`
# Syncs after branch switches. $3=1 for branch checkout, 0 for file checkout.
[ "$3" = "1" ] || exit 0
${syncRunner(engineUrl)}

_codeprism_sync_range save "$1..$2"
`;
}

function postRewriteScript(engineUrl: string): string {
  return `#!/bin/sh
# codeprism post-rewrite — installed by \`codeprism install-hook\`
# Syncs after git rebase. Non-blocking.
${syncRunner(engineUrl)}

_codeprism_sync_range rebase "ORIG_HEAD..HEAD"
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

  const engineUrl = opts.engineUrl ?? "http://localhost:4000";
  const hooksDir = join(gitRoot, ".git", "hooks");
  await mkdir(hooksDir, { recursive: true });

  console.log(`\nInstalling codeprism git hooks in ${hooksDir}\n`);

  await writeHook(join(hooksDir, "post-commit"),   postCommitScript(engineUrl),   "post-commit");
  await writeHook(join(hooksDir, "post-merge"),    postMergeScript(engineUrl),    "post-merge");
  await writeHook(join(hooksDir, "post-checkout"), postCheckoutScript(engineUrl), "post-checkout");
  await writeHook(join(hooksDir, "post-rewrite"),  postRewriteScript(engineUrl),  "post-rewrite");

  console.log(`
  post-commit   — syncs after each commit
  post-merge    — syncs after git pull / merge
  post-checkout — syncs after branch switch
  post-rewrite  — syncs after git rebase

  Engine URL  : ${engineUrl}

  Works with any editor: Claude Code, Zed, Lovable, Cursor, Windsurf, VS Code.
  To uninstall: remove the codeprism blocks from .git/hooks/*
`);
}
