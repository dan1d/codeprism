#!/usr/bin/env python3
"""
codeprism DeepEval evaluation — per-card relevance scoring.

Runs alongside the existing Ragas evaluation. DeepEval's ContextualRelevancy
gives per-card relevance scores which reveal *which card types* are causing
noise. ContextualPrecision measures position-weighted relevance (rank 1 > rank 5).

Usage:
  python3 evaluate_deepeval.py
  python3 evaluate_deepeval.py --server http://localhost:4000
  python3 evaluate_deepeval.py --model ollama/qwen2.5:7b   # free local judge
  python3 evaluate_deepeval.py --id eng755-cpt-icd          # single test case

Requirements:
  pip install deepeval requests
  # For local judge (free):
  #   brew install ollama && ollama pull qwen2.5:7b
  # For cloud judge:
  #   export DEEPEVAL_API_KEY=... (or set OPENAI_API_KEY / GOOGLE_API_KEY)
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

SCRIPT_DIR = Path(__file__).parent
GOLDEN_PATH = SCRIPT_DIR / "golden_dataset.json"
HISTORY_PATH = SCRIPT_DIR / "history.json"
RESULTS_PATH = SCRIPT_DIR / "deepeval_results.json"


# ---------------------------------------------------------------------------
# codeprism search helper
# ---------------------------------------------------------------------------

def search_codeprism(server: str, query: str, limit: int = 10) -> list[dict]:
    """Call codeprism hybrid search and return the raw card list."""
    try:
        resp = requests.get(
            f"{server}/api/search",
            params={"q": query, "limit": limit},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("cards", data.get("results", []))
    except Exception as e:
        print(f"  [warn] search failed for '{query[:50]}': {e}", file=sys.stderr)
        return []


# ---------------------------------------------------------------------------
# Build DeepEval test cases from golden dataset
# ---------------------------------------------------------------------------

def build_test_cases(server: str, golden: list[dict], ids: list[str] | None = None):
    """
    For each golden entry, call codeprism and build a DeepEvalTestCase.
    Returns list of (test_case, expected_flows) tuples.
    """
    from deepeval.test_case import LLMTestCase

    cases = []
    for entry in golden:
        if ids and entry["id"] not in ids:
            continue

        query = entry.get("query", entry.get("description", ""))
        expected_flows: list[str] = entry.get("expected_flows", [])
        ground_truth = entry.get("ground_truth", " ".join(expected_flows))

        print(f"  Searching: {query[:60]}...")
        cards = search_codeprism(server, query)
        if not cards:
            print(f"  [skip] no results for {entry['id']}")
            continue

        # Format retrieved contexts as strings (card title + content excerpt)
        retrieval_context = []
        for card in cards:
            title = card.get("title", "")
            content = card.get("content", "")[:400]
            card_type = card.get("card_type", "")
            retrieval_context.append(f"[{card_type}] {title}\n{content}")

        tc = LLMTestCase(
            input=query,
            actual_output="\n\n".join(retrieval_context[:3]),  # top-3 as "answer"
            expected_output=ground_truth,
            retrieval_context=retrieval_context,
            context=retrieval_context,
            name=entry["id"],
        )
        cases.append((tc, expected_flows, cards))
        time.sleep(0.2)  # be gentle with codeprism

    return cases


# ---------------------------------------------------------------------------
# Metric computation
# ---------------------------------------------------------------------------

def run_metrics(test_cases_data: list, model_name: str | None) -> list[dict]:
    """Run DeepEval metrics and return per-case results."""
    try:
        from deepeval.metrics import (
            ContextualPrecisionMetric,
            ContextualRelevancyMetric,
        )
    except ImportError:
        print("[error] deepeval not installed. Run: pip install deepeval")
        sys.exit(1)

    # Configure judge model
    judge_kwargs = {}
    if model_name:
        # Supports: "ollama/qwen2.5:7b", "gpt-4o-mini", "gemini/gemini-2.0-flash"
        judge_kwargs["model"] = model_name

    precision_metric = ContextualPrecisionMetric(threshold=0.5, **judge_kwargs)
    relevancy_metric = ContextualRelevancyMetric(threshold=0.5, **judge_kwargs)

    results = []
    for tc, expected_flows, cards in test_cases_data:
        print(f"\n  [{tc.name}] measuring...")
        case_result = {
            "id": tc.name,
            "query": tc.input,
            "retrieved_cards": [
                {
                    "title": c.get("title", ""),
                    "card_type": c.get("card_type", ""),
                    "flow": c.get("flow", ""),
                    "score": c.get("score", 0),
                }
                for c in cards[:10]
            ],
            "expected_flows": expected_flows,
            "contextual_precision": None,
            "contextual_relevancy": None,
            "card_type_breakdown": {},
            "per_card_relevance": [],
        }

        # Card type breakdown
        type_counts: dict[str, int] = {}
        for c in cards:
            ct = c.get("card_type", "unknown")
            type_counts[ct] = type_counts.get(ct, 0) + 1
        case_result["card_type_breakdown"] = type_counts

        # Run metrics (may require LLM calls)
        try:
            precision_metric.measure(tc)
            case_result["contextual_precision"] = precision_metric.score
            print(f"    Contextual Precision: {precision_metric.score:.3f}")
        except Exception as e:
            print(f"    [warn] ContextualPrecision failed: {e}")

        try:
            relevancy_metric.measure(tc)
            case_result["contextual_relevancy"] = relevancy_metric.score
            print(f"    Contextual Relevancy: {relevancy_metric.score:.3f}")

            # Per-card relevance from the metric's internals (if available)
            if hasattr(relevancy_metric, "verdicts"):
                for i, verdict in enumerate(relevancy_metric.verdicts or []):
                    card_title = cards[i].get("title", "") if i < len(cards) else f"card-{i}"
                    card_type = cards[i].get("card_type", "") if i < len(cards) else ""
                    case_result["per_card_relevance"].append({
                        "rank": i + 1,
                        "title": card_title,
                        "card_type": card_type,
                        "relevant": getattr(verdict, "verdict", None),
                        "reason": getattr(verdict, "reason", ""),
                    })
        except Exception as e:
            print(f"    [warn] ContextualRelevancy failed: {e}")

        results.append(case_result)

    return results


# ---------------------------------------------------------------------------
# Aggregate and persist results
# ---------------------------------------------------------------------------

def aggregate(results: list[dict]) -> dict:
    valid_precision = [r["contextual_precision"] for r in results if r["contextual_precision"] is not None]
    valid_relevancy = [r["contextual_relevancy"] for r in results if r["contextual_relevancy"] is not None]

    def mean(vals):
        return sum(vals) / len(vals) if vals else None

    # Card type noise analysis — which types appear most in results?
    type_totals: dict[str, int] = {}
    for r in results:
        for ct, count in r.get("card_type_breakdown", {}).items():
            type_totals[ct] = type_totals.get(ct, 0) + count

    return {
        "avg_contextual_precision": mean(valid_precision),
        "avg_contextual_relevancy": mean(valid_relevancy),
        "n_cases": len(results),
        "n_cases_with_precision": len(valid_precision),
        "n_cases_with_relevancy": len(valid_relevancy),
        "card_type_totals": type_totals,
    }


def append_to_history(aggregate_scores: dict, git_sha: str | None) -> None:
    history: list[dict] = []
    if HISTORY_PATH.exists():
        try:
            history = json.loads(HISTORY_PATH.read_text())
        except Exception:
            pass

    history.append({
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "git_sha": git_sha,
        "tool": "deepeval",
        **aggregate_scores,
    })

    HISTORY_PATH.write_text(json.dumps(history, indent=2))
    print(f"\n  History updated: {HISTORY_PATH}")


def get_git_sha() -> str | None:
    try:
        import subprocess
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=SCRIPT_DIR.parent,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip() or None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="codeprism DeepEval evaluation")
    parser.add_argument("--server", default="http://localhost:4000", help="codeprism server URL")
    parser.add_argument("--model", default=None, help="Judge model (e.g. ollama/qwen2.5:7b)")
    parser.add_argument("--id", dest="ids", action="append", help="Run specific test case IDs")
    parser.add_argument("--no-history", action="store_true", help="Skip appending to history.json")
    args = parser.parse_args()

    # Check codeprism is running
    try:
        requests.get(f"{args.server}/api/health", timeout=5).raise_for_status()
    except Exception:
        print(f"\n  ✗  codeprism is not running at {args.server}")
        print(f"     Start it first: cd {SCRIPT_DIR.parent} && pnpm dev\n")
        sys.exit(1)

    # Load golden dataset
    if not GOLDEN_PATH.exists():
        print(f"[error] Golden dataset not found at {GOLDEN_PATH}")
        sys.exit(1)

    golden = json.loads(GOLDEN_PATH.read_text())
    print(f"\n  codeprism DeepEval Evaluation")
    print(f"  Server : {args.server}")
    print(f"  Judge  : {args.model or 'default (requires API key)'}")
    print(f"  Cases  : {len(golden)} in dataset\n")

    # Build test cases
    test_cases_data = build_test_cases(args.server, golden, args.ids)
    if not test_cases_data:
        print("[error] No test cases could be built (check codeprism is running and has cards)")
        sys.exit(1)

    # Run metrics
    results = run_metrics(test_cases_data, args.model)

    # Save per-case results
    output = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "server": args.server,
        "model": args.model,
        "cases": results,
        "aggregate": aggregate(results),
    }
    RESULTS_PATH.write_text(json.dumps(output, indent=2))
    print(f"\n  Results saved: {RESULTS_PATH}")

    # Print summary
    agg = output["aggregate"]
    print("\n  ── DeepEval Summary ───────────────────────────────")
    if agg["avg_contextual_precision"] is not None:
        print(f"  Contextual Precision : {agg['avg_contextual_precision']:.3f}")
    if agg["avg_contextual_relevancy"] is not None:
        print(f"  Contextual Relevancy : {agg['avg_contextual_relevancy']:.3f}")
    print(f"  Cases evaluated      : {agg['n_cases']}")
    if agg["card_type_totals"]:
        print(f"  Card type breakdown  : {agg['card_type_totals']}")
    print()

    # Append to history
    if not args.no_history:
        append_to_history(agg, get_git_sha())


if __name__ == "__main__":
    main()
