# Contributing Framework Skills

codeprism uses framework-specific "skills" to improve card generation, search relevance, file classification, and documentation baselines. Each skill teaches codeprism the conventions and patterns of a specific technology.

## What a skill provides

A skill implements the `Skill` interface (`packages/engine/src/skills/types.ts`):

| Field | Purpose |
|-------|---------|
| `id` | Unique identifier, matches `StackProfile.skillIds` (e.g. `"rails"`, `"react"`) |
| `label` | Human-readable name (e.g. `"Ruby on Rails"`) |
| `searchTag` | Short embedding prefix for vector search (max 6 words, e.g. `"Rails ActiveRecord model"`) |
| `searchContextPrefix` | Prepended to semantic queries to bias search toward this stack |
| `cardPromptHints` | Injected into LLM card generation prompts for framework awareness |
| `docTypeWeights` | Relative importance multipliers per doc type |
| `classifierOverrides` | Path-pattern rules that override default file role classification |
| `bestPractices` | Curated conventions for architecture, code style, testing, performance, security, anti-patterns |
| `verificationHints` | Calibration for the code-consistency verifier (confirm threshold, known exceptions) |

## Adding a new skill

### Step 1: Create the knowledge file

Create `packages/engine/src/skills/knowledge/<framework>.md`:

```markdown
# <Framework> Best Practices

> Curated conventions used by codeprism to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture
- Convention 1
- Convention 2

## Code Style
- Convention 1
- Convention 2

## Testing
- Convention 1

## Performance
- Convention 1

## Security
- Convention 1
```

Follow the format of existing files (e.g., `rails.md`, `react.md`). Focus on widely-accepted conventions, not opinions. Each bullet should be a concrete, actionable rule.

### Step 2: Create the skill definition

Create `packages/engine/src/skills/<framework>.ts`:

```typescript
import type { Skill } from "./types.js";

export const myFrameworkSkill: Skill = {
  id: "myframework",
  label: "My Framework",
  searchTag: "MyFramework component",
  searchContextPrefix: "MyFramework web application: ",
  cardPromptHints:
    "This codebase uses MyFramework. Key patterns: ...",
  docTypeWeights: {
    architecture: 1.0,
    code_style: 0.8,
    rules: 0.6,
  },
  classifierOverrides: [
    { pattern: /src\/components\//, role: "domain" },
    { pattern: /tests?\//, role: "test" },
    { pattern: /config\//, role: "config" },
  ],
  bestPractices: {
    architecture: [
      "Use component-based architecture",
    ],
    codeStyle: [
      "Follow the official style guide",
    ],
    testing: [
      "Write unit tests for all business logic",
    ],
    performance: [
      "Lazy-load heavy modules",
    ],
    security: [
      "Sanitize user input",
    ],
    antiPatterns: [
      "Avoid global mutable state",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.80,
  },
};
```

### Step 3: Register in the registry

Edit `packages/engine/src/skills/registry.ts`:

```typescript
import { myFrameworkSkill } from "./myframework.js";

const ALL_SKILLS: Skill[] = [
  // ... existing skills ...
  myFrameworkSkill,
];
```

### Step 4: Add stack detection

Edit `packages/engine/src/indexer/stack-profiler.ts` to detect your framework. The profiler checks for framework markers (config files, package dependencies, directory structure) and adds skill IDs to the `StackProfile`.

Look for the existing detection patterns and follow the same approach. Common markers:
- Presence of a framework-specific config file (e.g., `angular.json`, `nuxt.config.ts`)
- Dependencies in `package.json`, `Gemfile`, `requirements.txt`, etc.
- Characteristic directory structure

### Step 5: Add an extractor (optional)

If your framework has unique patterns worth extracting (routes, models, middleware, etc.), create `packages/engine/src/indexer/extractors/<framework>.ts`. Extractors produce additional edges for the dependency graph.

Look at existing extractors (`rails.ts`, `react.ts`, `express.ts`) for the pattern.

## Currently supported skills

| Skill ID | Framework | Language |
|----------|-----------|----------|
| `rails` | Ruby on Rails | Ruby |
| `react` | React | JS/TS |
| `vue` | Vue.js | JS/TS |
| `nextjs` | Next.js | JS/TS |
| `django` | Django | Python |
| `django_rest` | Django REST Framework | Python |
| `fastapi` | FastAPI | Python |
| `python` | Python (generic) | Python |
| `go` | Go (generic) | Go |
| `gin` | Gin | Go |
| `laravel` | Laravel | PHP |
| `nestjs` | NestJS | TS |
| `angular` | Angular | TS |
| `svelte` | Svelte/SvelteKit | JS/TS |
| `spring` | Spring Boot | Java |
| `lambda` | AWS Lambda | Any |

## Regenerating knowledge files

Skill knowledge files can be regenerated using an LLM:

```bash
pnpm codeprism generate-skills              # all skills
pnpm codeprism generate-skills --skill vue   # specific skill
pnpm codeprism generate-skills --force       # overwrite existing
```

Output requires human review before committing -- LLMs sometimes produce overly opinionated or framework-version-specific rules.
