#!/usr/bin/env python3
"""
srcmap Benchmark Generator
===========================
Runs the eval suite against a srcmap server and produces benchmark data.
Can generate a standalone benchmarks.json or append to an existing multi-project file.

Usage:
    python generate_benchmarks.py
    python generate_benchmarks.py --server http://my-srcmap:4000
    python generate_benchmarks.py --project mastodon --repo mastodon/mastodon --lang Ruby --framework Rails
    python generate_benchmarks.py --append  # merge into existing benchmarks.json

Output:
    benchmarks.json in the same directory.
"""

import argparse
import json
import statistics
import time
from pathlib import Path
from typing import List

import requests

SRCMAP_DEFAULT = "http://localhost:4000"
DATASET_PATH = Path(__file__).parent / "golden_dataset.json"
OUTPUT_PATH = Path(__file__).parent / "benchmarks.json"
SEARCH_LIMIT = 10


def search_with_timing(server: str, query: str, limit: int = SEARCH_LIMIT) -> dict:
    """Call GET /api/search, return results + timing info."""
    url = f"{server}/api/search"
    start = time.monotonic()
    try:
        resp = requests.get(url, params={"q": query, "limit": limit}, timeout=30)
        resp.raise_for_status()
        elapsed_ms = round((time.monotonic() - start) * 1000)
        data = resp.json()
        return {
            "results": data.get("results", []),
            "latency_ms": elapsed_ms,
            "cache_hit": data.get("cacheHit", False),
        }
    except Exception as e:
        elapsed_ms = round((time.monotonic() - start) * 1000)
        print(f"  [WARN] Query failed: {e}")
        return {"results": [], "latency_ms": elapsed_ms, "cache_hit": False}


def estimate_naive_tokens(results: List[dict]) -> int:
    """
    Estimate how many tokens an AI would read WITHOUT srcmap.
    Each unique source file averages ~500 tokens (conservative).
    """
    all_files = set()
    for r in results:
        for sf in r.get("source_files", []):
            all_files.add(sf)
    return len(all_files) * 500


def estimate_srcmap_tokens(results: List[dict]) -> int:
    """Estimate tokens in srcmap's response (card content)."""
    total = 0
    for r in results:
        content = r.get("content", "")
        total += len(content) // 4
    return max(total, 1)


def compute_accuracy(test_case: dict, results: List[dict]) -> dict:
    expected_flows = set(f.lower() for f in test_case.get("expected_flows", []))
    expected_files = [f.lower() for f in test_case.get("expected_file_fragments", [])]

    result_flows = set()
    all_source_files: List[str] = []
    for r in results:
        flow = (r.get("flow") or "").lower()
        result_flows.add(flow)
        for sf in r.get("source_files", []):
            all_source_files.append(sf.lower())

    found_flows = expected_flows & result_flows
    flow_hit_rate = len(found_flows) / len(expected_flows) if expected_flows else 1.0

    all_files_combined = " ".join(all_source_files)
    found_file_frags = [f for f in expected_files if f in all_files_combined]
    file_hit_rate = len(found_file_frags) / len(expected_files) if expected_files else 1.0

    k = len(results)
    relevant = sum(1 for r in results if (r.get("flow") or "").lower() in expected_flows)
    precision_at_k = relevant / k if k > 0 else 0.0

    return {
        "flow_hit_rate": round(flow_hit_rate, 3),
        "file_hit_rate": round(file_hit_rate, 3),
        "precision_at_k": round(precision_at_k, 3),
    }


def run_benchmarks(server: str, test_cases: list, limit: int) -> tuple:
    """Run benchmark queries and return (cases, latencies, cache_hits)."""
    cases: list = []
    latencies: list = []
    cache_hits = 0

    for tc in test_cases:
        print(f"  → {tc['id']}: {tc['query'][:60]}...")
        data = search_with_timing(server, tc["query"], limit)
        results = data["results"]
        latency = data["latency_ms"]

        srcmap_tokens = estimate_srcmap_tokens(results)
        naive_tokens = estimate_naive_tokens(results)
        accuracy = compute_accuracy(tc, results)

        if data["cache_hit"]:
            cache_hits += 1
        latencies.append(latency)

        cases.append({
            "query": tc["query"],
            "ticket": tc.get("ticket"),
            "srcmap_tokens": srcmap_tokens,
            "naive_tokens": naive_tokens,
            "latency_ms": latency,
            "cache_hit": data["cache_hit"],
            "flow_hit_rate": accuracy["flow_hit_rate"],
            "file_hit_rate": accuracy["file_hit_rate"],
            "precision_at_k": accuracy["precision_at_k"],
            "result_count": len(results),
        })

        time.sleep(0.05)

    return cases, latencies, cache_hits


def build_project_stats(cases: list, latencies: list, cache_hits: int) -> dict:
    """Compute aggregate stats from individual query results."""
    n = len(cases)
    if n == 0:
        return {}
    sorted_latencies = sorted(latencies)
    avg_srcmap = round(sum(c["srcmap_tokens"] for c in cases) / n)
    avg_naive = round(sum(c["naive_tokens"] for c in cases) / n)
    token_reduction = round((1 - avg_srcmap / avg_naive) * 100, 1) if avg_naive > 0 else 0

    return {
        "queries_tested": n,
        "avg_tokens_with_srcmap": avg_srcmap,
        "avg_tokens_without": avg_naive,
        "token_reduction_pct": token_reduction,
        "avg_latency_ms": round(statistics.mean(latencies)),
        "p50_latency_ms": sorted_latencies[n // 2],
        "p95_latency_ms": sorted_latencies[int(n * 0.95)],
        "p99_latency_ms": sorted_latencies[int(n * 0.99)],
        "cache_hit_rate": round(cache_hits / n, 3),
        "flow_hit_rate": round(sum(c["flow_hit_rate"] for c in cases) / n, 3),
        "file_hit_rate": round(sum(c["file_hit_rate"] for c in cases) / n, 3),
        "precision_at_5": round(sum(c["precision_at_k"] for c in cases) / n, 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate srcmap benchmarks.")
    parser.add_argument("--server", default=SRCMAP_DEFAULT)
    parser.add_argument("--project", default="biobridge", help="Project name")
    parser.add_argument("--repo", default=None, help="GitHub repo (e.g. mastodon/mastodon)")
    parser.add_argument("--lang", default=None, help="Primary language")
    parser.add_argument("--framework", default=None, help="Framework name")
    parser.add_argument("--limit", type=int, default=SEARCH_LIMIT)
    parser.add_argument("--append", action="store_true", help="Append to existing benchmarks.json")
    args = parser.parse_args()

    with open(DATASET_PATH) as f:
        dataset = json.load(f)
    test_cases = dataset["test_cases"]

    print(f"[bench] Running {len(test_cases)} queries against {args.server}...")

    cases, latencies, cache_hits = run_benchmarks(args.server, test_cases, args.limit)
    stats = build_project_stats(cases, latencies, cache_hits)

    project_entry = {
        "name": args.project,
        "repo": args.repo or args.project,
        "language": args.lang or "Unknown",
        "framework": args.framework or "Unknown",
        "stats": stats,
        "cases": cases,
    }

    if args.append and OUTPUT_PATH.exists():
        with open(OUTPUT_PATH) as f:
            existing = json.load(f)
        projects = existing.get("projects", [])
        projects = [p for p in projects if p["name"] != args.project]
        projects.append(project_entry)
    else:
        projects = [project_entry]

    all_stats = [p["stats"] for p in projects if p.get("stats")]
    total_queries = sum(s.get("queries_tested", 0) for s in all_stats)
    benchmarks = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "projects": projects,
        "aggregate": {
            "total_projects": len(projects),
            "total_queries": total_queries,
            "avg_token_reduction_pct": round(
                sum(s.get("token_reduction_pct", 0) for s in all_stats) / len(all_stats), 1
            ) if all_stats else 0,
            "avg_latency_ms": round(
                sum(s.get("avg_latency_ms", 0) for s in all_stats) / len(all_stats)
            ) if all_stats else 0,
            "avg_flow_hit_rate": round(
                sum(s.get("flow_hit_rate", 0) for s in all_stats) / len(all_stats), 3
            ) if all_stats else 0,
            "avg_cache_hit_rate": round(
                sum(s.get("cache_hit_rate", 0) for s in all_stats) / len(all_stats), 3
            ) if all_stats else 0,
        },
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(benchmarks, f, indent=2)

    n = len(cases)
    print(f"\n{'=' * 50}")
    print(f"  BENCHMARK RESULTS — {args.project}")
    print(f"{'=' * 50}")
    print(f"  Queries tested     : {n}")
    print(f"  Token reduction    : {stats.get('token_reduction_pct', 0)}%")
    print(f"  Avg srcmap tokens  : {stats.get('avg_tokens_with_srcmap', 0)}")
    print(f"  Avg naive tokens   : {stats.get('avg_tokens_without', 0)}")
    print(f"  Avg latency        : {stats.get('avg_latency_ms', 0)}ms")
    print(f"  P95 latency        : {stats.get('p95_latency_ms', 0)}ms")
    print(f"  Cache hit rate     : {stats.get('cache_hit_rate', 0):.0%}")
    print(f"  Flow hit rate      : {stats.get('flow_hit_rate', 0):.0%}")
    print(f"  File hit rate      : {stats.get('file_hit_rate', 0):.0%}")
    print(f"  Precision@K        : {stats.get('precision_at_5', 0):.0%}")
    print(f"{'=' * 50}")
    print(f"  Saved → {OUTPUT_PATH}\n")


if __name__ == "__main__":
    main()
