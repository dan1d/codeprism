#!/bin/sh
#
# codeprism install-hook (standalone)
#
# Installs git hooks that sync changed files to a remote codeprism engine.
# Works for any editor (Claude Code, Zed, Lovable, Cursor, Windsurf, VS Code).
#
# Usage:
#   ./install-hook.sh --engine-url https://YOUR_ENGINE
#
# Or via curl:
#   curl -fsSL https://raw.githubusercontent.com/codeprism/codeprism/main/scripts/install-hook.sh | sh -s -- --engine-url https://YOUR_ENGINE
#

set -eu

ENGINE_URL=""
SYNC_NOW="0"

while [ $# -gt 0 ]; do
  case "$1" in
    --engine-url)
      ENGINE_URL="${2:-}"
      shift 2
      ;;
    --sync-now)
      SYNC_NOW="1"
      shift 1
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$ENGINE_URL" ]; then
  echo "Missing --engine-url" >&2
  exit 2
fi

GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$GIT_ROOT" ]; then
  echo "Not a git repository. Run inside a repo." >&2
  exit 1
fi

HOOKS_DIR="$GIT_ROOT/.git/hooks"
mkdir -p "$HOOKS_DIR"

write_hook() {
  name="$1"
  path="$HOOKS_DIR/$name"
  content="$2"

  if [ -f "$path" ] && grep -q "codeprism" "$path"; then
    echo "  ✓ $name — already installed"
    return 0
  fi

  if [ -f "$path" ]; then
    echo "" >> "$path"
    printf "%s\n" "$content" >> "$path"
    chmod +x "$path" || true
    echo "  ✓ $name — appended"
  else
    printf "%s\n" "$content" > "$path"
    chmod +x "$path" || true
    echo "  ✓ $name — installed"
  fi
}

SYNC_FN="$(cat <<'EOF'
_codeprism_sync_range() {
  CODEPRISM_URL="__ENGINE_URL__"
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
    parts = line.split("\t")
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

  printf "%s" "$PAYLOAD" | curl -sf -X POST "$CODEPRISM_URL/api/sync" \
    -H "Content-Type: application/json" \
    --data-binary @- \
    > /dev/null 2>&1 || true
}
EOF
)"

SYNC_FN="$(printf "%s" "$SYNC_FN" | sed "s|__ENGINE_URL__|$ENGINE_URL|g")"

POST_COMMIT="$(cat <<EOF
#!/bin/sh
# codeprism post-commit — installed by install-hook.sh
# Syncs after each commit. Non-blocking.

$SYNC_FN

_codeprism_sync_range save "HEAD~1..HEAD"
EOF
)"

POST_MERGE="$(cat <<EOF
#!/bin/sh
# codeprism post-merge — installed by install-hook.sh
# Syncs after git pull / merge. Non-blocking.

$SYNC_FN

_codeprism_sync_range merge "ORIG_HEAD..HEAD"
EOF
)"

POST_CHECKOUT="$(cat <<EOF
#!/bin/sh
# codeprism post-checkout — installed by install-hook.sh
# Syncs after branch switches. \$3=1 for branch checkout, 0 for file checkout.
[ "\$3" = "1" ] || exit 0

$SYNC_FN

_codeprism_sync_range save "\$1..\$2"
EOF
)"

POST_REWRITE="$(cat <<EOF
#!/bin/sh
# codeprism post-rewrite — installed by install-hook.sh
# Syncs after git rebase. Non-blocking.

$SYNC_FN

_codeprism_sync_range rebase "ORIG_HEAD..HEAD"
EOF
)"

echo ""
echo "Installing codeprism git hooks in $HOOKS_DIR"
echo ""

write_hook "post-commit" "$POST_COMMIT"
write_hook "post-merge" "$POST_MERGE"
write_hook "post-checkout" "$POST_CHECKOUT"
write_hook "post-rewrite" "$POST_REWRITE"

echo ""
echo "Done. Hooks installed:"
echo "  - post-commit"
echo "  - post-merge"
echo "  - post-checkout"
echo "  - post-rewrite"
echo ""

if [ "$SYNC_NOW" = "1" ]; then
  echo "Running initial sync (all tracked files)…"
  PY="$(command -v python3 || command -v python || true)"
  if [ -z "$PY" ]; then
    echo "python/python3 not found; skipping initial sync." >&2
    exit 0
  fi

  FILES="$(git ls-files 2>/dev/null || true)"
  if [ -z "$FILES" ]; then
    echo "No tracked files found; skipping initial sync."
    exit 0
  fi

  PAYLOAD="$(printf "%s\n" "$FILES" | "$PY" - <<'PY'
import json, os, subprocess, sys

repo = os.path.basename(subprocess.check_output(["git", "rev-parse", "--show-toplevel"]).decode().strip())
branch = subprocess.check_output(["git", "rev-parse", "--abbrev-ref", "HEAD"]).decode().strip()

changed = []
for path in sys.stdin.read().splitlines():
    if not path.strip():
        continue
    content = ""
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception:
        content = ""
    changed.append({"path": path, "content": content, "status": "modified"})

print(json.dumps({"repo": repo, "branch": branch, "eventType": "merge", "changedFiles": changed}))
PY
)"

  printf "%s" "$PAYLOAD" | curl -sf -X POST "$ENGINE_URL/api/sync" \
    -H "Content-Type: application/json" \
    --data-binary @- \
    > /dev/null 2>&1 || true

  echo "Initial sync sent."
  echo ""
fi
