import { readFileSync } from "node:fs";
import type { Flow } from "../indexer/flow-detector.js";
import type { ParsedFile } from "../indexer/types.js";
import type { GraphEdge } from "../indexer/graph-builder.js";

const MAX_FILES_PER_FLOW = 30;
const MAX_EDGES_PER_CARD = 20;
const MAX_SOURCE_LINES_PER_FILE = 150;
// How many files to include full source for in a flow card (most important ones first)
const MAX_SOURCE_FILES_PER_FLOW = 8;

const COMMON_PATH_PREFIXES = [
  /^\/Users\/[^/]+\/[^/]+\//,
  /^\/home\/[^/]+\/[^/]+\//,
  /^\/var\/[^/]+\//,
  /^\/opt\/[^/]+\//,
];

export const SYSTEM_PROMPT = `You are codeprism, a code context engine. Generate concise, accurate knowledge cards about a codebase.

You are given both structural metadata AND real source code snippets. Use the source code to understand actual business logic, not just structure.

Rules:
- Write clear, technical markdown (max ~500 words)
- Focus on WHAT the flow does and WHY it exists — the business purpose
- Describe data flow between components (what gets created, validated, stored, returned)
- Highlight non-obvious constraints, business rules, and gotchas found in the source
- Mention cross-repo data contracts (what the frontend sends, what the backend expects)
- Do NOT just list file paths or class names — synthesize meaning
- If you see domain-specific logic (billing, authorization, patient data), explain it concisely`;

// ---------------------------------------------------------------------------
// Source code reading
// ---------------------------------------------------------------------------

/**
 * Reads up to `maxLines` lines from a file. Returns empty string on any error.
 * Trims blank lines from start/end to reduce token waste.
 */
function readSourceSnippet(filePath: string, maxLines = MAX_SOURCE_LINES_PER_FILE): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    if (lines.length <= maxLines) return content.trimEnd();
    // Take the first maxLines — usually the most important declarations
    return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
  } catch {
    return "";
  }
}

/**
 * Format a source snippet with a language-appropriate fence for the LLM.
 */
function sourceBlock(filePath: string, source: string): string {
  if (!source) return "";
  const ext = filePath.split(".").at(-1) ?? "text";
  const langMap: Record<string, string> = {
    rb: "ruby", js: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript", vue: "vue",
    py: "python", go: "go",
  };
  const lang = langMap[ext] ?? ext;
  const short = shortenPath(filePath);
  return `### \`${short}\`\n\`\`\`${lang}\n${source}\n\`\`\``;
}

/**
 * Pick the most informative files from a flow for source inclusion.
 * Priority: models > controllers > API clients > components.
 */
function selectSourceFiles(files: ParsedFile[], max: number): ParsedFile[] {
  const score = (f: ParsedFile): number => {
    if (f.classes.some((c) => c.type === "model")) return 4;
    if (f.classes.some((c) => c.type === "controller")) return 3;
    if (f.apiCalls.length > 0) return 2;
    if (f.associations.length > 0) return 2;
    return 1;
  };
  return [...files].sort((a, b) => score(b) - score(a)).slice(0, max);
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export function buildFlowCardPrompt(
  flow: Flow,
  files: ParsedFile[],
  edges: GraphEdge[],
  projectContext = "",
): string {
  const crossEdges = truncate(edges, MAX_EDGES_PER_CARD)
    .filter((e) => e.relation !== "import")
    .map(compactEdge);

  // Structural summary (kept for grounding)
  const structuralSummary = {
    flow: flow.name,
    repos: flow.repos,
    fileCount: flow.files.length,
    models: files
      .filter((f) => f.classes.some((c) => c.type === "model"))
      .map((f) => ({
        name: f.classes.find((c) => c.type === "model")!.name,
        associations: f.associations.map((a) => `${a.type} :${a.name}`),
        validations: f.validations.slice(0, 5),
        callbacks: f.callbacks.slice(0, 5),
      })),
    controllers: files
      .filter((f) => f.classes.some((c) => c.type === "controller"))
      .map((f) => ({
        name: f.classes.find((c) => c.type === "controller")!.name,
        routes: f.routes.map((r) => `${r.method} ${r.path} → ${r.action ?? "?"}`),
      })),
    apiCalls: files
      .filter((f) => f.apiCalls.length > 0)
      .slice(0, 5)
      .map((f) => ({
        file: shortenPath(f.path),
        calls: f.apiCalls.map((c) => `${c.method} ${c.path ?? ""}`),
      })),
    crossServiceEdges: crossEdges,
  };

  // Source code snippets for the most informative files
  const sourceFiles = selectSourceFiles(files, MAX_SOURCE_FILES_PER_FLOW);
  const sourceBlocks = sourceFiles
    .map((f) => sourceBlock(f.path, readSourceSnippet(f.path)))
    .filter(Boolean)
    .join("\n\n");

  return `${projectContext}You are generating a knowledge card for a code flow named **"${flow.name}"** spanning repos: ${flow.repos.join(", ")}.

## Structural Analysis

\`\`\`json
${JSON.stringify(structuralSummary, null, 2)}
\`\`\`

## Source Code

${sourceBlocks || "_No source available_"}

## Task

Generate a concise knowledge card (markdown, ~300-400 words) that explains:
1. **Business purpose** — what problem does this flow solve?
2. **Data model** — what data is managed (key fields, constraints)?
3. **Service interactions** — how do the repos/services collaborate?
4. **Entry points** — where does a developer start when working on this flow?
5. **Gotchas** — any non-obvious rules, validations, or side effects visible in the code?

Start the card with a ## heading naming the flow.`;
}

export function buildModelCardPrompt(
  model: ParsedFile,
  edges: GraphEdge[],
  relatedFiles: ParsedFile[],
  projectContext = "",
): string {
  const modelClass = model.classes.find((c) => c.type === "model") ?? model.classes[0];
  const modelName = modelClass?.name ?? shortenPath(model.path);

  const controllerSources = relatedFiles
    .filter((f) => f.classes.some((c) => c.type === "controller"))
    .slice(0, 2);

  const feFiles = relatedFiles
    .filter((f) => f.apiCalls.length > 0 && f.language !== "ruby")
    .slice(0, 2);

  const structuralSummary = {
    model: {
      name: modelName,
      parent: modelClass?.parent,
      associations: model.associations.map((a) => `${a.type} :${a.name}${a.target_model ? ` (class: ${a.target_model})` : ""}`),
      validations: model.validations,
      callbacks: model.callbacks,
    },
    controllers: controllerSources.map((f) => ({
      name: f.classes.find((c) => c.type === "controller")?.name,
      routes: f.routes.map((r) => `${r.method} ${r.path} → ${r.action ?? "?"}`),
    })),
    feComponents: feFiles.map((f) => ({
      path: shortenPath(f.path),
      calls: f.apiCalls.map((c) => `${c.method} ${c.path ?? ""}`),
    })),
    edges: truncate(edges, MAX_EDGES_PER_CARD).map(compactEdge),
  };

  // Model source is typically concise and very informative — include in full
  const modelSource = sourceBlock(model.path, readSourceSnippet(model.path, 200));

  // Controller source gives insight into business logic (CRUD actions, filters)
  const controllerSrc = controllerSources
    .map((f) => sourceBlock(f.path, readSourceSnippet(f.path, 100)))
    .filter(Boolean)
    .join("\n\n");

  // FE source shows the data contract from the frontend side
  const feSrc = feFiles
    .map((f) => sourceBlock(f.path, readSourceSnippet(f.path, 80)))
    .filter(Boolean)
    .join("\n\n");

  return `${projectContext}You are generating a knowledge card for the **${modelName}** data model.

## Structural Analysis

\`\`\`json
${JSON.stringify(structuralSummary, null, 2)}
\`\`\`

## Model Source

${modelSource || "_Not available_"}

${controllerSrc ? `## Controller Source\n\n${controllerSrc}` : ""}

${feSrc ? `## Frontend Source\n\n${feSrc}` : ""}

## Task

Generate a concise knowledge card (markdown, ~250-350 words) that explains:
1. **What this model represents** — the real-world entity and its role in the system
2. **Key relationships** — most important associations and why they exist
3. **Business rules** — validations, callbacks, and constraints that enforce domain logic
4. **API surface** — how controllers expose it and what the frontend sends/receives
5. **Common usage patterns** — typical queries or operations performed on this model

Start the card with a ## heading naming the model.`;
}

export function buildCrossServiceCardPrompt(
  feFile: ParsedFile,
  beFile: ParsedFile,
  edges: GraphEdge[],
  projectContext = "",
): string {
  const beClass = beFile.classes.find((c) => c.type === "controller" || c.type === "model");

  const structuralSummary = {
    frontend: {
      path: shortenPath(feFile.path),
      language: feFile.language,
      apiCalls: feFile.apiCalls.map((c) => `${c.method} ${c.path ?? ""}`),
      imports: feFile.imports.slice(0, 10).map((i) => `${i.name} from '${i.source}'`),
      exports: feFile.exports.slice(0, 5).map((e) => e.name),
    },
    backend: {
      path: shortenPath(beFile.path),
      className: beClass?.name,
      routes: beFile.routes.map((r) => `${r.method} ${r.path} → ${r.action ?? "?"}`),
      associations: beFile.associations.slice(0, 5).map((a) => `${a.type} :${a.name}`),
    },
    connectingEdges: truncate(edges, MAX_EDGES_PER_CARD).map(compactEdge),
  };

  // Both sides: FE reveals request shape, BE reveals server-side logic — crucial for cross-repo understanding
  const feSrc = sourceBlock(feFile.path, readSourceSnippet(feFile.path, 120));
  const beSrc = sourceBlock(beFile.path, readSourceSnippet(beFile.path, 120));

  return `${projectContext}You are generating a knowledge card for a **cross-service connection** between the frontend and backend.

## Structural Analysis

\`\`\`json
${JSON.stringify(structuralSummary, null, 2)}
\`\`\`

## Frontend Source

${feSrc || "_Not available_"}

## Backend Source

${beSrc || "_Not available_"}

## Task

Generate a concise knowledge card (markdown, ~250-350 words) that explains:
1. **Data contract** — exactly what the frontend sends and what the backend expects
2. **User-facing feature** — what does this connection enable for the end user?
3. **Request/response flow** — HTTP methods, payload shape, response format
4. **Authorization or filtering** — any access control or scoping visible in the code
5. **Cross-repo gotchas** — naming mismatches, implicit conventions, or tricky coupling

Start the card with a ## heading describing the connection (e.g., "Patient Pre-Authorization API").`;
}

export function buildHubCardPrompt(
  hubFile: ParsedFile,
  connectedFlows: Flow[],
  edges: GraphEdge[],
  projectContext = "",
): string {
  const hubClass = hubFile.classes.find((c) => c.type === "model") ?? hubFile.classes[0];
  const hubName = hubClass?.name ?? shortenPath(hubFile.path);

  const structuralSummary = {
    hub: {
      name: hubName,
      parent: hubClass?.parent,
      associations: hubFile.associations.map((a) => `${a.type} :${a.name}${a.options ? ` (${a.options})` : ""}`),
      validations: hubFile.validations,
      callbacks: hubFile.callbacks,
    },
    connectedFlows: connectedFlows.map((f) => ({
      name: f.name,
      repos: f.repos,
      fileCount: f.files.length,
    })),
    edges: truncate(edges, MAX_EDGES_PER_CARD).map(compactEdge),
  };

  // Hub source is essential — it shows exactly WHY it's a hub (all the associations)
  const hubSrc = sourceBlock(hubFile.path, readSourceSnippet(hubFile.path, 200));

  return `${projectContext}You are generating a knowledge card for **${hubName}**, a central hub entity connected to ${connectedFlows.length} flows across the codebase.

## Structural Analysis

\`\`\`json
${JSON.stringify(structuralSummary, null, 2)}
\`\`\`

## Hub Source

${hubSrc || "_Not available_"}

## Task

Generate a concise knowledge card (markdown, ~200-300 words) that explains:
1. **Why this is central** — what role does this entity play that makes it connect to so many flows?
2. **What it links** — the key domains or flows that depend on it
3. **Polymorphic or shared behavior** — if it's used generically across domains, explain the pattern
4. **Impact of changes** — what breaks or needs updating if this model changes?

Start the card with a ## heading naming the hub entity followed by "(hub)".`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortenPath(filePath: string): string {
  for (const prefix of COMMON_PATH_PREFIXES) {
    const shortened = filePath.replace(prefix, "");
    if (shortened !== filePath) return shortened;
  }
  return filePath;
}

function truncate<T>(items: T[], max: number): T[] {
  return items.length <= max ? items : items.slice(0, max);
}

function compactEdge(
  edge: GraphEdge,
): { source: string; target: string; relation: string; meta: Record<string, string> } {
  return {
    source: shortenPath(edge.sourceFile),
    target: shortenPath(edge.targetFile),
    relation: edge.relation,
    meta: edge.metadata,
  };
}
