# Conversation Intelligence

srcmap can extract team knowledge from your AI coding assistant conversations. This turns ephemeral chat corrections and decisions into persistent, searchable knowledge cards.

## How it works

```
Transcript files       srcmap pipeline           Knowledge base
───────────────        ────────────────           ──────────────

.cursor/agent-        ┌──────────┐
  transcripts/*.jsonl │  Parser  │  normalize
──────────────────────>│          │───────┐
                      └──────────┘       │
claude code logs                         v
──────────────────────>          ┌──────────────┐
                                │  Gate check  │  "Does this contain
markdown transcripts            │  (LLM pass 1)│   corrections?"
──────────────────────>         └──────┬───────┘
                                       │ YES
                                       v
                                ┌──────────────┐
                                │  Extractor   │  structured
                                │  (LLM pass 2)│  JSON insights
                                └──────┬───────┘
                                       │
                                       v
                                ┌──────────────┐
                                │  Verifier    │  hallucination
                                │              │  protection
                                └──────┬───────┘
                                       │
                                       v
                                ┌──────────────┐
                                │  Dedup       │  merge with
                                │              │  existing
                                └──────┬───────┘
                                       │
                                       v
                                 conv_insight
                                 cards in DB
```

## Usage

```bash
pnpm srcmap import-transcripts
```

| Flag | Description |
|------|-------------|
| `--dry-run` | Parse and extract but don't write to DB |
| `--force` | Re-extract from already-imported transcripts |

## The pipeline

### 1. Parsing

Supports three transcript formats:
- **Cursor** (`.jsonl`) -- agent transcript files from `.cursor/agent-transcripts/`
- **Claude Code** -- conversation exports
- **Markdown** -- manual transcript dumps

The parser normalizes all formats into a unified `Transcript` structure with role-tagged messages.

### 2. Gate check (LLM pass 1)

A cheap LLM call determines if the conversation contains actionable knowledge:
- Explicit corrections ("don't do X", "use Y instead of Z")
- Stated team preferences or coding standards
- Architecture decisions
- Domain knowledge (business rules, workflows)
- Warnings about gotchas or known issues

If the gate returns NO, the transcript is skipped entirely (saves expensive extraction costs).

### 3. Structured extraction (LLM pass 2)

For gate-passed transcripts, a second LLM call extracts 1-5 insights, each with:

| Field | Description |
|-------|-------------|
| `category` | `coding_rule`, `anti_pattern`, `architecture_decision`, `domain_knowledge`, `team_preference`, or `gotcha` |
| `statement` | Concise rule statement (max 120 chars) |
| `evidence_quote` | Verbatim quote from the transcript proving this rule |
| `confidence` | 0.0-1.0 confidence score |
| `scope` | `repo`, `workspace`, or `global` |

### 4. Hallucination protection

The `evidence_quote` must appear as a substring in the raw transcript. If it doesn't, the insight is discarded. This prevents the LLM from inventing rules that weren't actually discussed.

### 5. Deduplication

New insights are compared against existing ones to avoid duplicates. The dedup engine uses semantic similarity to merge or skip redundant extractions.

## Insight trust levels

Insights start with a trust score based on extraction confidence:

| Trust range | Meaning | Action |
|-------------|---------|--------|
| > 0.8 | High confidence, clear evidence | Auto-promoted to cards |
| 0.4-0.8 | Medium confidence | Stored as `conv_insight` cards, eligible for human-gated promotion |
| < 0.4 | Low confidence | Stored but not surfaced in search |

## Promoting insights

Medium-confidence insights can be promoted to project documentation after human review:

```
srcmap_promote_insight({
  insight_id: "abc123",
  approve: true,
  target_doc: "code_style"
})
```

This:
1. Sets trust score to 0.95 (human confirmed)
2. Integrates the insight into the `code_style` or `rules` doc
3. The doc is regenerated on next `pnpm srcmap index --force-docs`

Rejected insights are marked as "aspirational" (trust 0.2) and won't be surfaced.

## Insight categories

| Category | Examples |
|----------|---------|
| `coding_rule` | "Always use `frozen_string_literal: true`", "Use `let` over `const` for..." |
| `anti_pattern` | "Don't use callbacks for side effects", "Avoid N+1 queries in..." |
| `architecture_decision` | "Billing goes through Cuba service, not directly to Stripe" |
| `domain_knowledge` | "CPT codes must be validated against the CMS fee schedule" |
| `team_preference` | "We prefer service objects over concerns for multi-step logic" |
| `gotcha` | "The MQTT broker must be running for device sync to work" |

## Data model

Insights are stored in the `extracted_insights` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Unique ID |
| `transcript_id` | TEXT | FK to transcript_imports |
| `card_id` | TEXT | FK to associated card (nullable) |
| `category` | TEXT | Insight category |
| `statement` | TEXT | The rule/insight text |
| `evidence_quote` | TEXT | Verbatim quote from transcript |
| `confidence` | REAL | Extraction confidence |
| `scope` | TEXT | repo, workspace, or global |
| `trust_score` | REAL | Current trust level |
| `code_consistency_score` | REAL | How well the codebase follows this rule (nullable) |
| `verification_basis` | TEXT | How trust was established (nullable) |
| `aspirational` | INTEGER | 1 if rejected during promotion |
