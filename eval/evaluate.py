#!/usr/bin/env python3
"""
codeprism Ragas Evaluation Harness
================================
Evaluates codeprism search quality using two complementary approaches:

  1. Deterministic metrics (no LLM, always free):
       - Flow Hit Rate   : fraction of expected flows found in results
       - File Hit Rate   : fraction of expected file fragments found in source_files
       - Precision@K     : fraction of results that match any expected flow

  2. Ragas LLM metrics (requires GOOGLE_API_KEY or OPENAI_API_KEY):
       - Context Precision  : are retrieved contexts relevant to the question?
       - Context Recall     : do retrieved contexts cover the ground truth answer?

Usage:
    # Deterministic only (no API key needed):
    python evaluate.py

    # Full Ragas evaluation with Gemini:
    GOOGLE_API_KEY=<key> python evaluate.py --ragas

    # Test a single case:
    python evaluate.py --id eng755-cpt-icd

    # Point at a non-local server:
    python evaluate.py --server http://my-codeprism:4000

Output:
    Prints a table to stdout and writes eval_results.json to the same directory.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

CODEPRISM_DEFAULT = "http://localhost:4000"
DATASET_PATH = Path(__file__).parent / "golden_dataset.json"
RESULTS_PATH = Path(__file__).parent / "eval_results.json"
SEARCH_LIMIT = 10


# ─── HTTP helpers ──────────────────────────────────────────────────────────────

def search(server: str, query: str, limit: int = SEARCH_LIMIT) -> List[dict]:
    """Call GET /api/search and return the results list."""
    url = f"{server}/api/search"
    try:
        resp = requests.get(url, params={"q": query, "limit": limit}, timeout=30)
        resp.raise_for_status()
        return resp.json().get("results", [])
    except requests.exceptions.ConnectionError:
        print(f"\n[ERROR] Cannot reach codeprism at {server}.")
        print("        Make sure the server is running: cd codeprism && pnpm dev")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(f"\n[ERROR] HTTP {e.response.status_code} from /api/search: {e.response.text}")
        sys.exit(1)


def check_health(server: str) -> dict:
    try:
        resp = requests.get(f"{server}/api/health", timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[WARN] Health check failed: {e}")
        return {}


# ─── Deterministic metrics ─────────────────────────────────────────────────────

def compute_deterministic(test_case: dict, results: List[dict]) -> dict:
    """
    Returns a dict with:
      flow_hit_rate   : fraction of expected_flows present in any result
      file_hit_rate   : fraction of expected_file_fragments present across all source_files
      precision_at_k  : fraction of retrieved results matching any expected flow
      found_flows     : list of expected flows that were actually found
      missing_flows   : list of expected flows not found
    """
    expected_flows = set(f.lower() for f in test_case.get("expected_flows", []))
    expected_files = [f.lower() for f in test_case.get("expected_file_fragments", [])]
    k = len(results)

    # Gather all flows and source files from results
    result_flows = set()
    all_source_files: List[str] = []
    for r in results:
        flow = (r.get("flow") or "").lower()
        result_flows.add(flow)
        for sf in r.get("source_files", []):
            all_source_files.append(sf.lower())

    # Flow hit rate
    found_flows = expected_flows & result_flows
    missing_flows = expected_flows - result_flows
    flow_hit_rate = len(found_flows) / len(expected_flows) if expected_flows else 1.0

    # File fragment hit rate (check if fragment appears in any source file path)
    all_files_combined = " ".join(all_source_files)
    found_file_frags = [f for f in expected_files if f in all_files_combined]
    file_hit_rate = len(found_file_frags) / len(expected_files) if expected_files else 1.0

    # Precision@K: how many retrieved results belong to an expected flow
    relevant_results = sum(
        1 for r in results
        if (r.get("flow") or "").lower() in expected_flows
    )
    precision_at_k = relevant_results / k if k > 0 else 0.0

    return {
        "flow_hit_rate": round(flow_hit_rate, 3),
        "file_hit_rate": round(file_hit_rate, 3),
        "precision_at_k": round(precision_at_k, 3),
        "found_flows": sorted(found_flows),
        "missing_flows": sorted(missing_flows),
        "result_count": k,
    }


# ─── Ragas metrics ─────────────────────────────────────────────────────────────

def run_ragas(test_cases: List[dict], all_results: Dict[str, List[dict]]) -> Dict[str, Any]:
    """
    Builds a Ragas Dataset from our test cases and runs context_precision
    and context_recall using Gemini Flash as the judge LLM.

    Returns a dict mapping test case id -> ragas scores, plus aggregate means.
    """
    try:
        from datasets import Dataset
        from ragas import evaluate
        # Ragas 0.4.x: use the private-but-stable _LLMContextPrecisionWithReference
        # and _LLMContextRecall (the public aliases are broken in 0.4.3).
        # Dataset column is "reference" not "ground_truth" for these metrics.
        try:
            from ragas.metrics import _LLMContextPrecisionWithReference, _LLMContextRecall
            _use_new_api = True
        except ImportError:
            try:
                from ragas.metrics.collections import ContextPrecision, ContextRecall
                _use_new_api = "collections"  # type: ignore[assignment]
            except ImportError:
                from ragas.metrics import context_precision, context_recall  # type: ignore[assignment]
                _use_new_api = False
    except ImportError:
        print("\n[ERROR] Ragas dependencies not installed.")
        print("        Run: pip install ragas datasets")
        return {}

    google_key = os.environ.get("GOOGLE_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    # deepseek_key is read below after this block

    llm = None
    embeddings = None

    deepseek_key = os.environ.get("DEEPSEEK_API_KEY", "")

    ragas_llm = None

    # Ragas 0.4+ requires llm_factory with the native openai.OpenAI client.
    # DeepSeek and OpenAI both use the same client; Gemini uses google-generativeai.
    # Priority: DeepSeek → OpenAI → Gemini
    if deepseek_key:
        try:
            from openai import OpenAI
            from ragas.llms import llm_factory
            _client = OpenAI(api_key=deepseek_key, base_url="https://api.deepseek.com/v1")
            ragas_llm = llm_factory("deepseek-chat", client=_client)
            print("[Ragas] Using DeepSeek-V3 as judge LLM.")
        except Exception as e:
            print(f"[WARN] Could not initialize DeepSeek for Ragas: {e}")

    if ragas_llm is None and openai_key:
        try:
            from openai import OpenAI
            from ragas.llms import llm_factory
            ragas_llm = llm_factory("gpt-4o-mini", client=OpenAI(api_key=openai_key))
            print("[Ragas] Using GPT-4o-mini as judge LLM.")
        except Exception as e:
            print(f"[WARN] Could not initialize OpenAI for Ragas: {e}")

    if ragas_llm is None and google_key:
        try:
            from ragas.llms import llm_factory
            ragas_llm = llm_factory("gemini-2.0-flash", api_key=google_key)
            print("[Ragas] Using Gemini 2.0 Flash as judge LLM.")
        except Exception as e:
            print(f"[WARN] Could not initialize Gemini for Ragas: {e}")

    if ragas_llm is None:
        print("[WARN] No LLM configured for Ragas. Set DEEPSEEK_API_KEY, GOOGLE_API_KEY, or OPENAI_API_KEY.")
        return {}

    # Build dataset rows
    rows: Dict[str, List] = {
        "question": [],
        "contexts": [],
        "ground_truth": [],  # used by older Ragas
        "reference": [],     # used by Ragas 0.4+ _LLMContextPrecisionWithReference
    }

    used_ids: List[str] = []
    for tc in test_cases:
        tc_id = tc["id"]
        results = all_results.get(tc_id, [])
        if not results:
            continue

        # Contexts = card title + content concatenated
        contexts = []
        for r in results:
            ctx_parts = [r.get("title", ""), r.get("content", "")]
            ctx = "\n".join(p for p in ctx_parts if p)
            if ctx.strip():
                contexts.append(ctx)

        if not contexts:
            continue

        rows["question"].append(tc["query"])
        rows["contexts"].append(contexts)
        rows["ground_truth"].append(tc["ground_truth"])
        rows["reference"].append(tc["ground_truth"])
        used_ids.append(tc_id)

    if not rows["question"]:
        print("[WARN] No Ragas rows to evaluate (all results were empty).")
        return {}

    dataset = Dataset.from_dict(rows)

    print(f"\n[Ragas] Evaluating {len(used_ids)} test cases…")
    try:
        if _use_new_api is True:
            # Ragas 0.4.x — metric classes require InstructorLLM from llm_factory
            metrics_list = [
                _LLMContextPrecisionWithReference(llm=ragas_llm),  # type: ignore[name-defined]
                _LLMContextRecall(llm=ragas_llm),                  # type: ignore[name-defined]
            ]
            score = evaluate(dataset, metrics=metrics_list, raise_exceptions=False)
        elif _use_new_api == "collections":
            metrics_list = [
                ContextPrecision(llm=ragas_llm),  # type: ignore[name-defined,call-arg]
                ContextRecall(llm=ragas_llm),     # type: ignore[name-defined,call-arg]
            ]
            score = evaluate(dataset, metrics=metrics_list, raise_exceptions=False)
        else:
            score = evaluate(
                dataset,
                metrics=[context_precision, context_recall],  # type: ignore[name-defined]
                llm=ragas_llm,
                raise_exceptions=False,
            )
    except Exception as e:
        print(f"[ERROR] Ragas evaluation failed: {e}")
        return {}

    df = score.to_pandas()
    def _safe(val: Any) -> Optional[float]:
        try:
            v = float(val)
            return round(v, 3) if v == v else None  # NaN check
        except (TypeError, ValueError):
            return None

    # Column names differ between Ragas versions
    cp_col = next(
        (c for c in df.columns if "precision" in c.lower()), "context_precision"
    )
    cr_col = next(
        (c for c in df.columns if "recall" in c.lower()), "context_recall"
    )

    per_case: Dict[str, Any] = {}
    for i, tc_id in enumerate(used_ids):
        row = df.iloc[i]
        per_case[tc_id] = {
            "context_precision": _safe(row.get(cp_col)),
            "context_recall": _safe(row.get(cr_col)),
        }

    cp_vals = [v for v in df[cp_col].tolist() if v == v]  # filter NaN
    cr_vals = [v for v in df[cr_col].tolist() if v == v]
    aggregate = {
        "mean_context_precision": round(sum(cp_vals) / len(cp_vals), 3) if cp_vals else None,
        "mean_context_recall": round(sum(cr_vals) / len(cr_vals), 3) if cr_vals else None,
        "evaluated": len(cp_vals),
        "timed_out": len(used_ids) - len(cp_vals),
    }

    return {"per_case": per_case, "aggregate": aggregate}


# ─── Reporting ─────────────────────────────────────────────────────────────────

def print_case(tc: dict, det: dict, ragas_scores: Optional[dict] = None) -> None:
    bar_fhr = "█" * int(det["file_hit_rate"] * 20)
    bar_flr = "█" * int(det["flow_hit_rate"] * 20)
    bar_p   = "█" * int(det["precision_at_k"] * 20)

    ticket = f"[{tc['ticket']}] " if tc.get("ticket") else ""
    print(f"\n  {ticket}{tc['id']}")
    print(f"  Query  : {tc['query'][:90]}")
    print(f"  Results: {det['result_count']} cards returned")
    print(f"  Flow Hit  {bar_flr:<20} {det['flow_hit_rate']:.0%}  (found: {', '.join(det['found_flows']) or '-'})")
    if det["missing_flows"]:
        print(f"            missing: {', '.join(det['missing_flows'])}")
    print(f"  File Hit  {bar_fhr:<20} {det['file_hit_rate']:.0%}")
    print(f"  Prec@{det['result_count']}  {bar_p:<20} {det['precision_at_k']:.0%}")

    if ragas_scores:
        cp = ragas_scores.get("context_precision")
        cr = ragas_scores.get("context_recall")
        if cp is not None:
            print(f"  Ctx Prec  {'█' * int(cp * 20):<20} {cp:.0%}  (Ragas)")
        else:
            print(f"  Ctx Prec  {'─' * 20} n/a (timeout/quota)")
        if cr is not None:
            print(f"  Ctx Rec   {'█' * int(cr * 20):<20} {cr:.0%}  (Ragas)")
        else:
            print(f"  Ctx Rec   {'─' * 20} n/a (timeout/quota)")


def print_summary(all_det: List[dict], ragas_agg: Optional[dict] = None) -> None:
    n = len(all_det)
    if n == 0:
        return
    mean_fhr = sum(d["flow_hit_rate"] for d in all_det) / n
    mean_fir = sum(d["file_hit_rate"] for d in all_det) / n
    mean_p   = sum(d["precision_at_k"] for d in all_det) / n

    print("\n" + "=" * 60)
    print("  SUMMARY")
    print("=" * 60)
    print(f"  Test cases evaluated : {n}")
    print(f"  Mean Flow Hit Rate   : {mean_fhr:.1%}")
    print(f"  Mean File Hit Rate   : {mean_fir:.1%}")
    print(f"  Mean Precision@K     : {mean_p:.1%}")

    if ragas_agg:
        cp_m = ragas_agg.get("mean_context_precision")
        cr_m = ragas_agg.get("mean_context_recall")
        ev = ragas_agg.get("evaluated", 0)
        to = ragas_agg.get("timed_out", 0)
        cp_str = f"{cp_m:.1%}" if cp_m is not None else "n/a"
        cr_str = f"{cr_m:.1%}" if cr_m is not None else "n/a"
        print(f"  Mean Ctx Precision   : {cp_str}  (Ragas, {ev} ok / {to} timeout)")
        print(f"  Mean Ctx Recall      : {cr_str}  (Ragas)")
    print("=" * 60)


# ─── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate codeprism search quality.")
    parser.add_argument("--server", default=CODEPRISM_DEFAULT, help="codeprism base URL")
    parser.add_argument("--ragas", action="store_true", help="Run Ragas LLM metrics (needs API key)")
    parser.add_argument("--id", dest="case_id", default=None, help="Run a single test case by id")
    parser.add_argument("--limit", type=int, default=SEARCH_LIMIT, help="Number of results to fetch per query")
    parser.add_argument("--verbose", action="store_true", help="Print raw search results")
    args = parser.parse_args()

    # Load dataset
    with open(DATASET_PATH) as f:
        dataset = json.load(f)
    test_cases = dataset["test_cases"]

    if args.case_id:
        test_cases = [tc for tc in test_cases if tc["id"] == args.case_id]
        if not test_cases:
            print(f"[ERROR] No test case with id '{args.case_id}'")
            sys.exit(1)

    # Health check
    health = check_health(args.server)
    if health:
        print(f"[codeprism] {health.get('cards', '?')} cards  |  {health.get('flows', '?')} flows  |  {args.server}")
    else:
        print(f"[codeprism] server at {args.server} (health check failed – proceeding anyway)")

    print(f"\nRunning {len(test_cases)} test case(s)…\n")
    print("=" * 60)

    all_det: List[dict] = []
    all_results: Dict[str, List[dict]] = {}

    for tc in test_cases:
        print(f"  → {tc['id']} : {tc['query'][:60]}…")
        results = search(args.server, tc["query"], args.limit)
        all_results[tc["id"]] = results

        if args.verbose:
            for r in results:
                print(f"      [{r['score']:.3f}] {r['flow']} / {r['title']} ({r['card_type']})")
                for sf in r.get("source_files", [])[:3]:
                    print(f"            {sf}")

        time.sleep(0.1)  # be polite

    # Deterministic metrics
    det_by_id: Dict[str, dict] = {}
    for tc in test_cases:
        det = compute_deterministic(tc, all_results.get(tc["id"], []))
        det_by_id[tc["id"]] = det
        all_det.append(det)

    # Ragas metrics
    ragas_by_id: Dict[str, Any] = {}
    ragas_agg: Optional[dict] = None
    if args.ragas:
        ragas_out = run_ragas(test_cases, all_results)
        if ragas_out:
            ragas_by_id = ragas_out.get("per_case", {})
            ragas_agg = ragas_out.get("aggregate")

    # Print per-case report
    for tc in test_cases:
        print_case(tc, det_by_id[tc["id"]], ragas_by_id.get(tc["id"]))

    # Print summary
    print_summary(all_det, ragas_agg)

    # Save results JSON
    output = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "server": args.server,
        "test_cases": [
            {
                "id": tc["id"],
                "ticket": tc.get("ticket"),
                "query": tc["query"],
                "deterministic": det_by_id[tc["id"]],
                "ragas": ragas_by_id.get(tc["id"]),
                "results": [
                    {
                        "title": r["title"],
                        "flow": r["flow"],
                        "card_type": r["card_type"],
                        "score": r["score"],
                        "source": r["source"],
                        "source_files": r.get("source_files", [])[:5],
                    }
                    for r in all_results.get(tc["id"], [])
                ],
            }
            for tc in test_cases
        ],
        "aggregate_deterministic": {
            "mean_flow_hit_rate": round(sum(d["flow_hit_rate"] for d in all_det) / len(all_det), 3) if all_det else 0,
            "mean_file_hit_rate": round(sum(d["file_hit_rate"] for d in all_det) / len(all_det), 3) if all_det else 0,
            "mean_precision_at_k": round(sum(d["precision_at_k"] for d in all_det) / len(all_det), 3) if all_det else 0,
        },
        "aggregate_ragas": ragas_agg,
    }

    with open(RESULTS_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n  Results saved → {RESULTS_PATH}\n")


if __name__ == "__main__":
    main()
