# Roadmap (Quarterly)

This roadmap focuses on making codeprism a practical, trustworthy shared memory layer for teams shipping production code.

## Principles (non-negotiables)

- **Code is the source of truth**: generated docs, Swagger/OpenAPI, and tests are *signals* and *evidence*, not authority. When something conflicts, codeprism should surface the disagreement (with links) and prefer the code-derived view.
- **AI docs are useful only when verifiable**: every contract/rule should link back to concrete source files (routes/controllers/serializers/specs) and include staleness/confidence hints when needed.
- **Index “how it’s used”, not only “how it’s defined”**: request specs and integration tests often encode the real contract, including edge cases.
- **Follow existing patterns**: if a repo uses service objects, serializers, policies, etc., codeprism should detect and describe the pattern already present—never prescribe a new architecture by default.
- **Rules are explicit “do not do” guardrails**: rules should be actionable, diff-checkable, and written to minimize false positives/negatives. Prefer tight wording over broad aspirations.

## Q1 2026 — API Contracts 2.0 (Swagger/OpenAPI that actually helps)

**Goal**: Make `api_contracts` docs more structured and more trustworthy by combining specs (Swagger/OpenAPI) with code-derived endpoints.

- **Structured OpenAPI/Swagger ingestion**
  - Parse OpenAPI/Swagger into a normalized endpoint catalog (method, path, params, request body, response shapes).
  - Keep the original spec location(s) as evidence links (e.g., `openapi.yaml`, `swagger.json`).
- **Contract confidence + disagreement reporting**
  - When a spec conflicts with observed code (routes/controllers/handlers), emit a “disagreement” section instead of silently picking one.
  - Add a lightweight confidence indicator per endpoint: *code-backed*, *spec-only*, *test-backed*, *conflicting*.
- **Better code-derived endpoint mapping**
  - Improve linking between code endpoints and docs by using routes (Rails `config/routes.rb`, JS/TS route definitions, framework router metadata where available).
  - Expand “representative controllers/route files” selection to avoid missing versioned APIs (e.g., `/api/v1`, `/api/v2`) and namespaced routing.

**Acceptance criteria**
- For a backend repo with `config/routes.rb` + `openapi.yaml`, `API_CONTRACTS.md` clearly lists endpoints and flags spec/code disagreements.
- Each endpoint entry includes evidence links to at least one of: route definition, controller/handler, spec file.

## Q2 2026 — Index request specs + serializer-aware schema inference

**Goal**: Extract request/response shapes from the places teams *actually maintain them*: request specs and serializers/schema types.

- **Request specs as evidence**
  - Index Rails request specs (`spec/requests/**`, `spec/integration/**`) and equivalent integration-test patterns in other stacks.
  - Extract example request payloads, query params, and asserted response shapes/status codes.
  - Treat these as evidence—use them to enrich contracts, not to override code.
- **Serializer-aware response shape inference**
  - Detect serializer files and common patterns:
    - Rails: ActiveModelSerializers, Blueprinter, JSON:API serializers
    - Django REST: `Serializer`/`ModelSerializer`
    - FastAPI: Pydantic models for response types
    - Node: Zod schemas / DTO patterns where used
  - Use serializer/schema definitions to generate a “response fields” section per endpoint (with links to the serializer/schema file).
- **Join the dots: endpoint ↔ serializer ↔ spec**
  - Where possible, attach “likely serializer/schema” and “supporting request spec(s)” to each endpoint in `API_CONTRACTS.md`.

**Acceptance criteria**
- For a Rails repo with serializers + request specs, contracts show response field lists that match serializers and include spec-based examples/edge cases.
- Code remains the “final” reference, but the doc clearly shows supporting evidence sources.

## Q3 2026 — Rules & anti-pattern enforcement (wording + edge cases)

**Goal**: Help teams encode “not to do” rules that are precise, enforceable, and aligned with their existing architecture.

- **Rules starter packs (anti-pattern driven)**
  - Provide curated starter packs per stack (Rails, React, Django, etc.) emphasizing “do not do X” patterns.
  - Examples: “No business logic in serializers”, “No raw SQL in controllers”, “No TODO/FIXME in new code”, “Strong params required”.
- **Wording quality improvements**
  - Improve guidance and (where supported) AI-assisted refinement so rules become specific and testable (“what the checker should look for”).
  - Expand edge-case handling (generated files, vendored code, migrations, one-off scripts, intentionally duplicated code).
- **Reduce false positives**
  - Encourage scope targeting (`scope: rails/react/...`) and file-pattern constraints for rules that need it.
  - Provide a standardized structure for rule descriptions: intent, detection heuristic, exceptions.

**Acceptance criteria**
- Teams can import a rules JSON and run checks with fewer ambiguous failures; violations include clear explanations and snippets.
- Starter packs feel aligned with common real-world repos (controllers vs services, serializer boundaries, etc.).

## Q4 2026 — Service object detection + flow hygiene

**Goal**: Make codeprism better at reflecting how teams structure business logic today, without nudging them into a new pattern.

- **Service-object pattern detection**
  - Detect service-object directories and naming conventions (`app/services/**`, `services/**`, `*_service`, `UseCase`, etc.) per framework skill.
  - When present, bias flow cards and docs to reflect service boundaries (controllers thin, services thick).
- **Flow hygiene improvements**
  - Better handling for monorepos with multiple services and mixed stacks.
  - Better flow naming for versioned APIs and shared “hub” modules that appear everywhere.
  - Better linking for cross-service calls (frontend routes ↔ backend endpoints ↔ serializers/contracts).

**Acceptance criteria**
- In repos that already use service objects, generated docs/cards describe that pattern consistently and point to the actual service files.
- Flow clustering produces fewer “generic” flows and fewer missing edges across FE/BE boundaries.

## Ongoing (always)

- **Trust & verification**
  - Encourage verification loops (`codeprism_verify_card`) and surface stale/conflicting sources prominently.
- **“Source-of-truth” discipline**
  - Prefer structural, code-derived facts over prose when uncertain; show evidence links and uncertainty explicitly.

