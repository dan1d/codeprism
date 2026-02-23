/**
 * Prompt builders for project-level documentation generation.
 * Each builder produces a prompt for a specific doc type; the LLM output
 * is stored in the `project_docs` table and injected into card prompts.
 */

export type DocType =
  | "readme"
  | "about"
  | "architecture"
  | "code_style"
  | "rules"
  | "styles"
  | "api_contracts"
  | "specialist"
  | "changelog"
  | "memory"
  | "pages"
  | "be_overview";

const DOC_SYSTEM_PROMPT = `You are a senior software architect documenting a codebase for an AI coding assistant.
Write clear, concise markdown. Focus on what developers need to know to work confidently in this codebase.
Do NOT fabricate details not visible in the provided source. If something is unclear, say so briefly.
Maximum 600 words per document.`;

export { DOC_SYSTEM_PROMPT };

interface SourceFile {
  path: string;
  content: string;
}

function fenceBlock(file: SourceFile): string {
  const ext = file.path.split(".").at(-1) ?? "text";
  const langMap: Record<string, string> = {
    rb: "ruby", js: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript", vue: "vue",
    json: "json", yml: "yaml", yaml: "yaml", css: "css", scss: "scss",
    md: "markdown", gemfile: "ruby",
  };
  const lang = langMap[ext.toLowerCase()] ?? ext;
  const short = file.path.split("/").slice(-3).join("/");
  return `### \`${short}\`\n\`\`\`${lang}\n${file.content}\n\`\`\``;
}

function sourceSection(files: SourceFile[]): string {
  return files
    .filter((f) => f.content.trim())
    .map(fenceBlock)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------

export function buildReadmePrompt(repoName: string, files: SourceFile[]): string {
  return `Generate a **README.md** for the \`${repoName}\` repository.

## Source Files

${sourceSection(files)}

## Task

Write a concise README covering:
1. **What this project is** — one-paragraph description
2. **Tech stack** — language, framework, key libraries (infer from package manager files)
3. **Project structure** — top-level directories and their purpose
4. **Setup** — how to install dependencies and run locally (infer from scripts/Makefile)
5. **Key entry points** — where execution starts

Start with a # heading with the project name. Be factual; do not invent steps not visible in the code.`;
}

// ---------------------------------------------------------------------------
// ABOUT
// ---------------------------------------------------------------------------

export function buildAboutPrompt(repoName: string, files: SourceFile[]): string {
  return `Generate an **About.md** for the \`${repoName}\` repository — a business-focused description for AI coding assistants.

## Source Files

${sourceSection(files)}

## Task

Write a concise About document covering:
1. **Business domain** — what real-world problem does this application solve?
2. **Users and actors** — who uses this system and in what roles?
3. **Core entities** — the 3-5 most important domain concepts (e.g. Patient, Cycle, PreAuthorization)
4. **Key workflows** — the 2-3 most critical user journeys or business processes
5. **Boundaries** — what this service is responsible for vs. what other services handle

This document will be injected into AI prompts to give context about the business domain.`;
}

// ---------------------------------------------------------------------------
// ARCHITECTURE
// ---------------------------------------------------------------------------

export function buildArchitecturePrompt(repoName: string, files: SourceFile[]): string {
  return `Generate an **Architecture.md** for the \`${repoName}\` repository.

## Source Files

${sourceSection(files)}

## Task

Write a concise architecture document covering:
1. **Architectural pattern** — MVC, REST API, SPA, microservice, monolith, etc.
2. **Layer breakdown** — how the codebase is organized (controllers, models, services, jobs, etc.)
3. **Data flow** — how a typical request travels through the system
4. **Key design decisions** — notable patterns, abstractions, or conventions used
5. **External integrations** — third-party APIs, background job systems, databases visible in the code
6. **Cross-service contracts** — if this is an API, what are the main endpoints or data formats?

Be specific about what is visible in the provided code. Do not speculate.`;
}

// ---------------------------------------------------------------------------
// CODE STYLE
// ---------------------------------------------------------------------------

export function buildCodeStylePrompt(repoName: string, files: SourceFile[]): string {
  return `Generate a **CodeStyle.md** for the \`${repoName}\` repository — coding conventions for AI assistants.

## Source Files

${sourceSection(files)}

## Task

Document the coding conventions visible in the source:
1. **Naming conventions** — files, classes, methods, variables (snake_case, camelCase, etc.)
2. **Code organization** — how code is split into files and modules
3. **Common patterns** — dependency injection, service objects, hooks, stores, concerns, etc.
4. **Error handling** — how errors are caught and surfaced
5. **Testing patterns** — test file naming, factory/fixture usage (if visible)
6. **Do's and Don'ts** — anything the codebase clearly enforces or avoids

This will guide AI code generation to match the existing style.`;
}

// ---------------------------------------------------------------------------
// RULES
// ---------------------------------------------------------------------------

export function buildRulesPrompt(repoName: string, files: SourceFile[]): string {
  return `Generate a **Rules.md** for the \`${repoName}\` repository — business rules and domain constraints.

## Source Files

${sourceSection(files)}

## Task

Document the business rules and domain constraints visible in the code:
1. **Validation rules** — data constraints enforced at the model or API level
2. **Authorization rules** — who can do what (policies, scopes, guards)
3. **Business logic constraints** — state machines, conditional flows, invariants
4. **Domain-specific rules** — any healthcare, billing, compliance, or domain rules visible
5. **Gotchas** — non-obvious rules that would surprise a new developer

Be specific and reference the actual field names and models you see in the code.`;
}

// ---------------------------------------------------------------------------
// STYLES (frontend only)
// ---------------------------------------------------------------------------

export function buildStylesPrompt(repoName: string, files: SourceFile[]): string {
  return `Generate a **Styles.md** for the \`${repoName}\` frontend repository — UI and styling conventions.

## Source Files

${sourceSection(files)}

## Task

Document the UI and styling conventions:
1. **CSS approach** — CSS modules, styled-components, Tailwind, SCSS, global styles, etc.
2. **Design tokens** — colors, typography, spacing variables if defined
3. **Component conventions** — how UI components are structured
4. **Naming conventions** — BEM, utility classes, component-scoped styles
5. **Theme** — any dark/light mode or theming system

If no CSS files are provided, note that styling information was not available.`;
}

// ---------------------------------------------------------------------------
// PAGES (frontend only) — LLM-discovered page/view inventory
// ---------------------------------------------------------------------------

export function buildPagesPrompt(repoName: string, files: SourceFile[]): string {
  return `Analyze the navigation and page components of the \`${repoName}\` frontend repository.

## Source Files

${sourceSection(files)}

## Task

Produce a **Pages.md** document that catalogues every distinct user-facing page or view in this application.

Rules:
- A **page** is a route-level view a user navigates to (e.g. "Remote Authorizations", "Patient Profile").
- A **section header** is a nav group that contains child pages (e.g. "Admin", "Settings" when they have sub-items) — do NOT list these as pages.
- Infer page names from nav \`title\` attributes, component directory names, and route definitions.
- For each page write exactly one sentence describing what the user does there.

Output format — use this exact markdown structure so it can be machine-parsed:

## Pages

- **<Page Name>** — <one sentence describing what the user does on this page>
- **<Page Name>** — <one sentence>
...

List every leaf page you can identify. Do not include section headers, utility components, or modal-only views.`;
}

// ---------------------------------------------------------------------------
// BE_OVERVIEW — LLM-generated backend API summary
// ---------------------------------------------------------------------------

export function buildBeOverviewPrompt(repoName: string, files: SourceFile[]): string {
  return `Analyze the backend routes and controllers of the \`${repoName}\` repository.

## Source Files

${sourceSection(files)}

## Task

Produce a **BackendOverview.md** that gives a developer an instant understanding of what this API does.

Cover:
1. **Purpose** — one paragraph: what real-world problem does this API solve?
2. **Main Resources** — bullet list of the 5-10 core domain resources (e.g. Patient, Authorization, Device) with one-line descriptions
3. **Key Endpoint Groups** — for each resource, list 2-4 of the most important routes (method + path + purpose)
4. **Authentication** — how clients authenticate (token, session, API key, etc.)
5. **Notable Patterns** — any cross-cutting concerns visible in the routes (versioning, namespacing, nested resources)

Be specific to what is visible in the provided files. Maximum 600 words.`;
}

// ---------------------------------------------------------------------------
// Refresh prompt (used by POST /api/refresh for incremental updates)
// ---------------------------------------------------------------------------

export function buildRefreshDocPrompt(
  docType: DocType,
  repoName: string,
  files: SourceFile[],
): string {
  switch (docType) {
    case "readme":       return buildReadmePrompt(repoName, files);
    case "about":        return buildAboutPrompt(repoName, files);
    case "architecture": return buildArchitecturePrompt(repoName, files);
    case "code_style":   return buildCodeStylePrompt(repoName, files);
    case "rules":        return buildRulesPrompt(repoName, files);
    case "styles":       return buildStylesPrompt(repoName, files);
    case "pages":        return buildPagesPrompt(repoName, files);
    case "be_overview":  return buildBeOverviewPrompt(repoName, files);
    default:             return buildReadmePrompt(repoName, files);
  }
}

// ---------------------------------------------------------------------------
// Specialist prompt — repo-specific AI persona, generated last (after all docs)
// ---------------------------------------------------------------------------

export function buildSpecialistPrompt(
  repoName: string,
  stackLabel: string,
  aboutDoc: string,
  archDoc: string,
  rulesDoc: string,
): string {
  return `You are creating a Specialist Identity Card for an AI coding assistant.
This card will be prepended to EVERY prompt that operates on the "${repoName}" repository.
It must be accurate, specific, and immediately useful. Maximum 400 words.

Stack: ${stackLabel}

## Project About
${aboutDoc.slice(0, 1200)}

## Architecture
${archDoc.slice(0, 800)}

## Business Rules (excerpt)
${rulesDoc.slice(0, 600)}

Generate a specialist card with these exact sections:
1. **Domain** — 2 sentences: what the system does and who uses it
2. **Core Entities** — bullet list of the 5–8 most important models/services/components with one-line descriptions
3. **Key Patterns** — bullet list of 3–5 architectural patterns and conventions specific to this codebase
4. **Gotchas** — bullet list of 2–4 non-obvious constraints, edge cases, or traps
5. **Agent Directives** — 3–5 "When answering questions about this codebase, always..." directives`;
}

// ---------------------------------------------------------------------------
// API Contracts prompt — documents the public API surface of a backend repo
// ---------------------------------------------------------------------------

export function buildApiContractsPrompt(repoName: string, files: SourceFile[]): string {
  const fileBlocks = files.map((f) => fenceBlock(f)).join("\n\n");
  return `Repository: ${repoName}

${fileBlocks}

---

Document the public API surface of this repository. Maximum 500 words. Cover:
1. **Base URL / namespace** — the route prefix
2. **Key endpoints** — list each route with method, path, brief purpose, and authentication requirement
3. **Request/response conventions** — format (JSON/XML), common headers, pagination
4. **Authentication** — how clients authenticate (Bearer token, session cookie, API key)
5. **Notable constraints** — rate limits, required params, error formats`;
}

// ---------------------------------------------------------------------------
// Changelog prompt — recent notable changes, updated on each merge event
// ---------------------------------------------------------------------------

export function buildChangelogPrompt(
  repoName: string,
  commitMessages: string[],
): string {
  const commits = commitMessages.slice(0, 30).join("\n");
  return `Repository: ${repoName}

Recent commit messages (newest first):
${commits}

---

Write a concise changelog summary (max 300 words) of the most significant recent changes to this codebase.
Group by theme (e.g. "New Features", "Bug Fixes", "Schema Changes", "API Changes").
Only include changes that are meaningful to a developer reading code — skip chores, dependency bumps, and typo fixes.`;
}

// ---------------------------------------------------------------------------
// Memory prompt — rolling log of team insights and usage patterns (OpenClaw MEMORY.md)
// ---------------------------------------------------------------------------

export interface MemoryInput {
  recentInsights: Array<{ title: string; flow: string; content: string; created_at: string }>;
  topFlows: Array<{ flow: string; queryCount: number }>;
}

export function buildMemoryDocPrompt(input: MemoryInput): string {
  const insightLines = input.recentInsights
    .slice(0, 10)
    .map((i) => `- [${i.created_at.slice(0, 10)}] **${i.title}** (flow: ${i.flow})\n  ${i.content.slice(0, 200)}`)
    .join("\n");

  const flowLines = input.topFlows
    .slice(0, 10)
    .map((f) => `- ${f.flow}: ${f.queryCount} queries`)
    .join("\n");

  return `You are summarising a team's recent development knowledge for an AI coding assistant.
Write a MEMORY document (max 500 words) that captures:

1. **Recent Insights** — key architectural decisions and gotchas discovered recently
2. **Active Areas** — flows being queried most (indicating where the team is currently working)
3. **Patterns Emerging** — any recurring themes across the insights
4. **Watch Out For** — any gotchas or warnings to keep top of mind

## Recent Dev Insights
${insightLines || "(none yet)"}

## Most-Queried Flows (last 30 days)
${flowLines || "(no query data yet)"}`;
}
