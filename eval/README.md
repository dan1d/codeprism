# srcmap Evaluation Suite

Evaluates srcmap search quality against a golden dataset of real ticket queries.

## Evaluating your own codebase

The default `golden_dataset.json` is tuned for the biobridge project. To evaluate
srcmap against **your own** indexed codebase, you have two options:

### Option A: Auto-generate from your srcmap index (recommended)

```bash
# Start srcmap with your indexed database, then:
python generate_dataset.py                     # 10 test cases → golden_dataset.json
python generate_dataset.py --sample 20         # more test cases
python generate_dataset.py --output my_ds.json # custom output path
python generate_dataset.py --seed 42           # reproducible sampling
```

The generator connects to your running srcmap instance, discovers all indexed flows
and cards, and builds test cases with realistic queries, ground truth, and expected
flows/files derived from your actual data.

Then run the evaluation as normal:

```bash
python evaluate.py                             # uses golden_dataset.json
```

### Option B: Start from the example template

Copy `example_golden_dataset.json` → `golden_dataset.json` and edit:

1. Replace `expected_flows` with flow names from your srcmap dashboard
2. Replace `expected_file_fragments` with filename substrings from your repos
3. Adjust `query` and `ground_truth` to match your domain
4. Remove test cases that don't apply (e.g. `background-job` if you have none)

Each test case has a `_comment` field explaining what to customize.

### CLI options for generate_dataset.py

```
python generate_dataset.py [options]

  --server URL     srcmap base URL (default: http://localhost:4000)
  --sample N       Number of test cases to generate (default: 10)
  --output PATH    Output file path (default: golden_dataset.json)
  --seed N         Random seed for reproducible output
```

---

## Two evaluation modes

| Mode | Needs LLM? | Speed | What it measures |
|---|---|---|---|
| **Deterministic** | No | ~1s | Flow Hit Rate, File Hit Rate, Precision@K |
| **Ragas** | Yes (Gemini free) | ~1–2 min | Context Precision, Context Recall |

---

## Quick start

### 1 – Python environment

```bash
cd srcmap/eval
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2 – Start srcmap

```bash
# In a separate terminal, from the srcmap directory:
pnpm dev
# or via Docker:
docker run -p 4000:4000 srcmap
```

### 3 – Run deterministic evaluation (free, no API key)

```bash
python evaluate.py
```

### 4 – Run Ragas evaluation (uses Gemini 2.0 Flash as judge)

```bash
GOOGLE_API_KEY=<your-key> python evaluate.py --ragas
```

---

## CLI options

```
python evaluate.py [options]

  --server URL     srcmap base URL (default: http://localhost:4000)
  --ragas          Enable Ragas LLM metrics (needs GOOGLE_API_KEY or OPENAI_API_KEY)
  --id CASE_ID     Run a single test case (e.g. --id eng755-cpt-icd)
  --limit N        Number of search results to fetch per query (default: 10)
  --verbose        Print raw search results with scores
```

---

## Understanding the metrics

### Deterministic (always run)

- **Flow Hit Rate** – what fraction of the *expected flows* appear in the returned cards. A flow hit means srcmap found the relevant area of the codebase.
- **File Hit Rate** – what fraction of expected file name fragments appear in `source_files` across all returned cards.
- **Precision@K** – what fraction of the K returned cards belong to an expected flow (signal-to-noise ratio).

### Ragas (optional)

- **Context Precision** – an LLM judge rates whether each retrieved card is actually relevant to the question. High = low noise.
- **Context Recall** – an LLM judge rates whether the retrieved cards collectively cover everything stated in the `ground_truth`. High = complete coverage.

---

## Adding test cases

Edit `golden_dataset.json`. Each test case has:

```json
{
  "id": "unique-id",
  "ticket": "ENG-123",            // or null
  "query": "natural language question",
  "ground_truth": "What the ideal context should contain (for Ragas recall).",
  "expected_flows": ["flow_name", "ModelName"],
  "expected_file_fragments": ["partial_filename", "another_partial"]
}
```

The `expected_flows` must match the `flow` column of cards in the database (case-insensitive).  
The `expected_file_fragments` are lowercase substrings checked against all `source_files` paths.

---

## Output

Results are printed to stdout and saved to `eval_results.json` in this directory.
The JSON includes per-case scores, retrieved results (top 5 files), and aggregate means.

Use the aggregate means to track improvement over time as you tune indexing or search parameters.
