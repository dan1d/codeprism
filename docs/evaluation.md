# Evaluation

srcmap includes an evaluation suite that measures search quality against a golden dataset.

## Two evaluation modes

| Mode | Needs LLM? | Speed | What it measures |
|------|-----------|-------|-----------------|
| **Deterministic** | No | ~1s | Flow Hit Rate, File Hit Rate, Precision@K |
| **Ragas** | Yes (Gemini) | ~1-2 min | Context Precision, Context Recall |

## Quick start

### Setup

```bash
cd eval
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Run deterministic evaluation (free)

```bash
python evaluate.py
```

### Run with Ragas metrics (needs API key)

```bash
GOOGLE_API_KEY=<your-key> python evaluate.py --ragas
```

## Evaluating your own codebase

The default `golden_dataset.json` is project-specific. Two ways to evaluate your own:

### Option A: Auto-generate (recommended)

```bash
python generate_dataset.py
```

This connects to your running srcmap instance, discovers indexed flows and cards, and generates a golden dataset. Options:

| Flag | Default | Description |
|------|---------|-------------|
| `--server URL` | `http://localhost:4000` | srcmap base URL |
| `--sample N` | `10` | Number of test cases to generate |
| `--output PATH` | `golden_dataset.json` | Output file |
| `--seed N` | (random) | Reproducible sampling |

### Option B: Start from template

Copy `example_golden_dataset.json` and edit to match your codebase. It contains 6 generic test cases with `_comment` fields explaining what to customize.

## CLI options

```
python evaluate.py [options]

  --server URL     srcmap base URL (default: http://localhost:4000)
  --ragas          Enable Ragas LLM metrics
  --id CASE_ID     Run a single test case
  --limit N        Search results to fetch per query (default: 10)
  --verbose        Print raw search results with scores
```

## Understanding the metrics

### Deterministic (always run)

- **Flow Hit Rate** -- fraction of expected flows that appear in returned cards. A flow hit means srcmap found the relevant area of the codebase.
- **File Hit Rate** -- fraction of expected file name fragments that appear in `source_files` across returned cards.
- **Precision@K** -- fraction of returned cards that belong to an expected flow (signal-to-noise ratio).

### Ragas (optional)

- **Context Precision** -- LLM judge rates whether each retrieved card is actually relevant to the question.
- **Context Recall** -- LLM judge rates whether retrieved cards collectively cover everything in the `ground_truth`.

## Golden dataset format

Each test case in `golden_dataset.json`:

```json
{
  "id": "unique-id",
  "ticket": "ENG-123",
  "query": "natural language question",
  "ground_truth": "What the ideal context should contain",
  "expected_flows": ["flow_name", "ModelName"],
  "expected_file_fragments": ["partial_filename", "another_partial"]
}
```

- `expected_flows` must match the `flow` column of cards (case-insensitive)
- `expected_file_fragments` are lowercase substrings checked against `source_files` paths

## Output

Results are printed to stdout and saved to `eval_results.json`. The JSON includes per-case scores, top 5 retrieved files, and aggregate means.

Track the aggregate means over time as you tune indexing or search parameters.
