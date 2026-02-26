#!/usr/bin/env python3
"""
Generate a golden dataset from a running codeprism instance.

Connects to the codeprism API, discovers indexed flows and cards, and produces
a golden_dataset.json file tailored to your actual codebase.  This lets you
run the evaluation suite (evaluate.py) against any project — not just biobridge.

Usage:
    # Generate from a local codeprism with 10 test cases (default):
    python generate_dataset.py

    # Specify sample size and output path:
    python generate_dataset.py --sample 20 --output my_dataset.json

    # Point at a remote server:
    python generate_dataset.py --server http://my-codeprism:4000
"""

import argparse
import json
import random
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

CODEPRISM_DEFAULT = "http://localhost:4000"
DEFAULT_OUTPUT = Path(__file__).parent / "golden_dataset.json"
DEFAULT_SAMPLE = 10


# ─── API helpers ──────────────────────────────────────────────────────────────

def api_get(server: str, path: str, params: Optional[dict] = None) -> Any:
    url = f"{server}{path}"
    try:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.ConnectionError:
        print(f"\n[ERROR] Cannot reach codeprism at {server}.")
        print("        Make sure the server is running: cd codeprism && pnpm dev")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(f"\n[ERROR] HTTP {e.response.status_code} from {path}: {e.response.text}")
        sys.exit(1)


def fetch_flows(server: str) -> List[dict]:
    return api_get(server, "/api/flows")


def fetch_cards(server: str, flow: str) -> List[dict]:
    return api_get(server, "/api/cards", params={"flow": flow})


# ─── Query generators ────────────────────────────────────────────────────────
# Each generator produces (query, ground_truth) from flow metadata + cards.

def _file_fragments(cards: List[dict]) -> List[str]:
    """Extract unique filename stems from source_files across all cards."""
    seen = set()
    for card in cards:
        files = card.get("source_files", "")
        if isinstance(files, str):
            try:
                files = json.loads(files)
            except (json.JSONDecodeError, TypeError):
                files = []
        for f in files:
            stem = Path(f).stem.lower()
            if stem and stem not in seen and len(stem) > 2:
                seen.add(stem)
    return sorted(seen)[:6]


def _card_types(cards: List[dict]) -> List[str]:
    return sorted({c.get("card_type", "") for c in cards if c.get("card_type")})


def _repos(flow_meta: dict) -> List[str]:
    repos = flow_meta.get("repos", [])
    if isinstance(repos, str):
        repos = [r.strip() for r in repos.split(",") if r.strip()]
    return repos


def _slugify(name: str) -> str:
    """Turn CamelCase or snake_case into readable words."""
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", name)
    s = s.replace("_", " ").replace("-", " ")
    return s.lower().strip()


QUERY_TEMPLATES = [
    ("How does {readable} work in the codebase?",
     "{readable} is implemented across {file_count} files in {repo_text}. "
     "Key card types include {card_types}. Related source files include {file_list}."),

    ("What is the {readable} flow and which files are involved?",
     "The {readable} flow contains {card_count} cards covering {card_types}. "
     "Source files span {repo_text} and include {file_list}."),

    ("Explain the {readable} implementation — models, controllers, and frontend components",
     "{readable} touches {file_count} source files across {repo_text}. "
     "The flow includes card types: {card_types}. Key files: {file_list}."),

    ("Where is {readable} defined and how is it used across services?",
     "{readable} has {card_count} knowledge cards ({card_types}) in {repo_text}. "
     "Important files include {file_list}."),
]

CROSS_SERVICE_TEMPLATES = [
    ("How do {parts[0]} and {parts[1]} interact across the frontend and backend?",
     "The cross-service flow {flow_name} connects {parts[0]} and {parts[1]}. "
     "It spans {repo_text} with {card_count} cards covering {card_types}. "
     "Key files include {file_list}."),
]


def generate_test_case(flow_meta: dict, cards: List[dict], idx: int) -> dict:
    flow_name = flow_meta["flow"]
    card_count = flow_meta.get("cardCount", len(cards))
    file_count = flow_meta.get("fileCount", 0)
    repos = _repos(flow_meta)
    repo_text = ", ".join(repos) if repos else "the indexed repository"
    card_types = ", ".join(_card_types(cards)) or "general"
    file_frags = _file_fragments(cards)
    file_list = ", ".join(file_frags[:4]) or flow_name.lower()
    readable = _slugify(flow_name)

    is_cross_service = "↔" in flow_name
    parts = [_slugify(p.strip()) for p in flow_name.split("↔")] if is_cross_service else []

    fmt_vars = dict(
        readable=readable,
        flow_name=flow_name,
        card_count=card_count,
        file_count=file_count,
        repo_text=repo_text,
        card_types=card_types,
        file_list=file_list,
        parts=parts,
    )

    if is_cross_service and len(parts) >= 2:
        template = random.choice(CROSS_SERVICE_TEMPLATES)
    else:
        template = QUERY_TEMPLATES[idx % len(QUERY_TEMPLATES)]

    query = template[0].format(**fmt_vars)
    ground_truth = template[1].format(**fmt_vars)

    case_id = re.sub(r"[^a-z0-9]+", "-", flow_name.lower()).strip("-")

    expected_flows = [flow_name]
    if is_cross_service:
        expected_flows.extend(p.strip() for p in flow_name.split("↔") if p.strip())

    return {
        "id": case_id,
        "ticket": None,
        "query": query,
        "ground_truth": ground_truth,
        "expected_flows": expected_flows,
        "expected_file_fragments": file_frags[:5],
    }


# ─── Sampling strategy ───────────────────────────────────────────────────────

def select_flows(flows: List[dict], sample: int) -> List[dict]:
    """Pick a diverse sample: prefer flows with more cards/files, mix repos."""
    if len(flows) <= sample:
        return flows

    cross_service = [f for f in flows if "↔" in f["flow"]]
    regular = [f for f in flows if "↔" not in f["flow"]]

    regular.sort(key=lambda f: f.get("cardCount", 0), reverse=True)

    selected: List[dict] = []
    cs_budget = min(len(cross_service), max(1, sample // 4))
    selected.extend(random.sample(cross_service, cs_budget) if cross_service else [])

    remaining = sample - len(selected)
    top_half = regular[: len(regular) // 2]
    bottom_half = regular[len(regular) // 2:]

    top_pick = min(remaining * 2 // 3, len(top_half))
    bottom_pick = min(remaining - top_pick, len(bottom_half))

    selected.extend(random.sample(top_half, top_pick) if top_half else [])
    selected.extend(random.sample(bottom_half, bottom_pick) if bottom_half else [])

    return selected[:sample]


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a golden evaluation dataset from a running codeprism instance."
    )
    parser.add_argument("--server", default=CODEPRISM_DEFAULT, help="codeprism base URL (default: %(default)s)")
    parser.add_argument("--sample", type=int, default=DEFAULT_SAMPLE, help="Number of test cases to generate (default: %(default)s)")
    parser.add_argument("--output", type=str, default=None, help="Output file path (default: golden_dataset.json)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducible sampling")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    output_path = Path(args.output) if args.output else DEFAULT_OUTPUT

    # Discover flows
    print(f"[generate] Connecting to codeprism at {args.server}…")
    health = api_get(args.server, "/api/health")
    total_cards = health.get("cards", "?")
    total_flows = health.get("flows", "?")
    print(f"[generate] Found {total_cards} cards across {total_flows} flows")

    flows = fetch_flows(args.server)
    if not flows:
        print("[ERROR] No flows found. Is the database indexed?")
        sys.exit(1)

    selected = select_flows(flows, args.sample)
    print(f"[generate] Sampling {len(selected)} flows for test cases…")

    test_cases: List[dict] = []
    for idx, flow_meta in enumerate(selected):
        flow_name = flow_meta["flow"]
        print(f"  → {flow_name} ({flow_meta.get('cardCount', '?')} cards)")
        cards = fetch_cards(args.server, flow_name)
        tc = generate_test_case(flow_meta, cards, idx)
        test_cases.append(tc)

    dataset = {
        "version": "1.0",
        "description": (
            f"Auto-generated golden dataset from codeprism instance at {args.server}. "
            f"Contains {len(test_cases)} test cases derived from {total_flows} indexed flows."
        ),
        "test_cases": test_cases,
    }

    with open(output_path, "w") as f:
        json.dump(dataset, f, indent=2)

    print(f"\n[generate] Wrote {len(test_cases)} test cases → {output_path}")
    print(f"[generate] Run evaluation with:  python evaluate.py")


if __name__ == "__main__":
    main()
