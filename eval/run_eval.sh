#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  srcmap Ragas evaluation runner
#  Usage:
#    ./run_eval.sh              # full eval (all 8 test cases, Ragas on)
#    ./run_eval.sh --verbose    # print raw search results too
#    ./run_eval.sh --id eng755-cpt-icd   # single test case
# ─────────────────────────────────────────────────────────────────────
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Load env vars (API keys) ──────────────────────────────────────────
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# ── Activate virtual env (create + install if missing) ───────────────
if [ ! -f .venv/bin/activate ]; then
  echo "[setup] Creating Python virtual environment…"
  # Ragas requires Python 3.10+; prefer 3.12 from pyenv if available
  PYTHON_BIN="${PYTHON_BIN:-}"
  if [ -z "$PYTHON_BIN" ]; then
    for candidate in \
      "$HOME/.pyenv/versions/3.12.11/bin/python3" \
      "$HOME/.pyenv/versions/3.12.0/bin/python3" \
      "$(command -v python3.12 2>/dev/null)" \
      "$(command -v python3.11 2>/dev/null)" \
      "$(command -v python3.10 2>/dev/null)" \
      "$(command -v python3 2>/dev/null)"; do
      if [ -n "$candidate" ] && [ -x "$candidate" ]; then
        VER=$("$candidate" -c "import sys; print(sys.version_info.minor)")
        if [ "$VER" -ge 10 ] 2>/dev/null; then
          PYTHON_BIN="$candidate"
          break
        fi
      fi
    done
  fi
  if [ -z "$PYTHON_BIN" ]; then
    echo "[error] Python 3.10+ is required for Ragas. Install it via pyenv or brew."
    exit 1
  fi
  echo "[setup] Using $PYTHON_BIN"
  "$PYTHON_BIN" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

# Check if dependencies are installed (requests is the sentinel)
if ! python3 -c "import requests" 2>/dev/null; then
  echo "[setup] Installing Python dependencies…"
  pip install -r requirements.txt --quiet
fi

# ── Check srcmap is reachable ─────────────────────────────────────────
CODEPRISM_SERVER="${CODEPRISM_SERVER:-http://localhost:4000}"
if ! curl -sf "$CODEPRISM_SERVER/api/health" > /dev/null 2>&1; then
  echo ""
  echo "  ✗  srcmap is not running at $CODEPRISM_SERVER"
  echo "     Start it first:  cd $(dirname "$SCRIPT_DIR") && pnpm dev"
  echo ""
  exit 1
fi

# ── Run evaluation ────────────────────────────────────────────────────
if [ -n "$DEEPSEEK_API_KEY" ]; then
  JUDGE_LLM="DeepSeek-V3"
elif [ -n "$GOOGLE_API_KEY" ]; then
  JUDGE_LLM="Gemini 2.0 Flash"
elif [ -n "$OPENAI_API_KEY" ]; then
  JUDGE_LLM="GPT-4o-mini"
else
  JUDGE_LLM="none (deterministic only)"
fi

echo ""
echo "  srcmap Ragas Evaluation"
echo "  Server : $CODEPRISM_SERVER"
echo "  Judge  : $JUDGE_LLM"
echo ""

python3 evaluate.py --ragas --server "$CODEPRISM_SERVER" "$@"

# ── DeepEval (per-card contextual relevance) ──────────────────────────
echo ""
echo "  Running DeepEval (per-card relevance scoring)..."
echo ""

python3 evaluate_deepeval.py --server "$CODEPRISM_SERVER" "$@"

# ── Append Ragas metrics to history ledger ────────────────────────────
if [ -f eval_results.json ]; then
  GIT_SHA=$(git -C "$(dirname "$SCRIPT_DIR")" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  node -e "
    const fs = require('fs');
    const histPath = './history.json';
    const resultsPath = './eval_results.json';
    try {
      const history = JSON.parse(fs.readFileSync(histPath, 'utf8'));
      const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      const agg = results.aggregate_ragas || results.aggregate_deterministic || {};
      history.push({
        timestamp: new Date().toISOString(),
        git_sha: '${GIT_SHA}',
        tool: 'ragas',
        ...agg,
      });
      fs.writeFileSync(histPath, JSON.stringify(history, null, 2));
      console.log('  History ledger updated: history.json');
    } catch(e) {
      console.warn('  [warn] Could not update history.json:', e.message);
    }
  " 2>/dev/null || true
fi
