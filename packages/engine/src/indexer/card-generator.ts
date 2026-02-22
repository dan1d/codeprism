import type { Flow } from "./flow-detector.js";
import type { ParsedFile, FileRole } from "./types.js";
import type { GraphEdge } from "./graph-builder.js";
import type { LLMProvider } from "../llm/provider.js";
import {
  SYSTEM_PROMPT,
  buildFlowCardPrompt,
  buildModelCardPrompt,
  buildCrossServiceCardPrompt,
  buildHubCardPrompt,
} from "../llm/prompts.js";
import { nanoid } from "nanoid";

// Minimum ms between LLM calls — keeps Gemini free tier (15 RPM) safe
const LLM_INTER_CALL_DELAY_MS = 4200; // ~14 RPM with headroom
let lastLlmCallAt = 0;

async function callLlm(
  llm: LLMProvider,
  prompt: string,
  label: string,
): Promise<string> {
  const now = Date.now();
  const wait = LLM_INTER_CALL_DELAY_MS - (now - lastLlmCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastLlmCallAt = Date.now();

  const content = await llm.generate(prompt, { systemPrompt: SYSTEM_PROMPT, maxTokens: 1024 });
  const tokens = llm.estimateTokens(content);
  console.log(`  [llm] ${label} — ~${tokens} output tokens`);
  return content;
}

export interface GeneratedCard {
  id: string;
  flow: string;
  title: string;
  content: string;
  cardType: "flow" | "model" | "cross_service" | "hub" | "auto_generated";
  sourceFiles: string[];
  sourceRepos: string[];
  tags: string[];
  validBranches: string[] | null;
  commitSha: string | null;
}

type FileCategory =
  | "model"
  | "controller"
  | "api_client"
  | "store"
  | "job"
  | "component"
  | "other";

const CATEGORY_ORDER: readonly FileCategory[] = [
  "model",
  "controller",
  "job",
  "api_client",
  "store",
  "component",
];

const RAILS_ACTION_METHODS: Readonly<Record<string, string>> = {
  index: "GET",
  show: "GET",
  create: "POST",
  update: "PUT",
  destroy: "DELETE",
  new: "GET",
  edit: "GET",
};

const RELATION_LABELS: Readonly<Record<string, string>> = {
  api_endpoint: "via API",
  controller_model: "controller → model",
  store_api: "store → api",
  route_controller: "route",
  import: "import",
  job_model: "job → model",
};

const MAX_MODEL_CARDS = 20;
const MAX_CROSS_SERVICE_CARDS = 15;

/**
 * Merges project context strings for all repos involved in a card.
 * Deduplicates content and caps the total to keep prompts from bloating.
 */
function mergeProjectContext(
  repos: string[],
  projectContextByRepo?: Map<string, string>,
): string {
  if (!projectContextByRepo || projectContextByRepo.size === 0) return "";
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const repo of repos) {
    const ctx = projectContextByRepo.get(repo);
    if (ctx && !seen.has(ctx)) {
      seen.add(ctx);
      parts.push(ctx);
    }
  }
  return parts.join("\n");
}
const MIN_MODEL_ASSOCIATIONS = 2;

/**
 * Generates knowledge cards from detected flows and graph data.
 *
 * Produces four card types:
 * - **flow** — one per non-hub flow
 * - **model** — one per important model (≥2 associations, top 20)
 * - **cross_service** — one per FE→BE connection (top 15)
 * - **hub** — one per hub flow
 *
 * When an `llm` provider is supplied, each card is enriched via LLM.
 * On LLM failure the generator falls back to structural markdown.
 * LLM calls are sequential to respect rate limits.
 */
export async function generateCards(
  flows: Flow[],
  parsedFiles: ParsedFile[],
  edges: GraphEdge[],
  llm?: LLMProvider | null,
  /** Project context strings keyed by repo name. Injected into every card prompt. */
  projectContextByRepo?: Map<string, string>,
  /** HEAD commit SHA per repo, used to stamp source_commit on generated cards. */
  commitShaByRepo?: Map<string, string>,
): Promise<GeneratedCard[]> {
  const fileIndex = new Map(parsedFiles.map((f) => [f.path, f]));

  const flowCards = await generateFlowCards(
    flows.filter((f) => !f.isHub),
    parsedFiles,
    edges,
    fileIndex,
    llm ?? null,
    projectContextByRepo,
  );

  const modelCards = await generateModelCards(
    parsedFiles,
    edges,
    fileIndex,
    llm ?? null,
    projectContextByRepo,
  );

  const crossServiceCards = await generateCrossServiceCards(
    edges,
    fileIndex,
    llm ?? null,
    projectContextByRepo,
  );

  const hubCards = await generateHubCards(
    flows.filter((f) => f.isHub),
    flows,
    edges,
    fileIndex,
    llm ?? null,
    projectContextByRepo,
  );

  const all = [...flowCards, ...modelCards, ...crossServiceCards, ...hubCards];

  // Stamp source_commit for single-repo cards when SHA is available
  if (commitShaByRepo && commitShaByRepo.size > 0) {
    for (const card of all) {
      if (card.sourceRepos.length === 1) {
        const sha = commitShaByRepo.get(card.sourceRepos[0]);
        if (sha) card.commitSha = sha;
      }
    }
  }

  return all;
}

/* ------------------------------------------------------------------ */
/*  Flow cards                                                         */
/* ------------------------------------------------------------------ */

async function generateFlowCards(
  nonHubFlows: Flow[],
  parsedFiles: ParsedFile[],
  edges: GraphEdge[],
  fileIndex: Map<string, ParsedFile>,
  llm: LLMProvider | null,
  projectContextByRepo?: Map<string, string>,
): Promise<GeneratedCard[]> {
  const cards: GeneratedCard[] = [];

  for (const flow of nonHubFlows) {
    const flowFiles = flow.files
      .map((p) => fileIndex.get(p))
      .filter((f): f is ParsedFile => f != null && isDomainRelevant(f.fileRole));

    if (flowFiles.length === 0) continue;

    const flowPaths = new Set(flow.files);
    const flowEdges = edges.filter(
      (e) => flowPaths.has(e.sourceFile) || flowPaths.has(e.targetFile),
    );

    // Merge project context from all repos involved in this flow
    const projectContext = mergeProjectContext(flow.repos, projectContextByRepo);

    let content: string;

    if (llm) {
      try {
        const prompt = buildFlowCardPrompt(flow, flowFiles, flowEdges, projectContext);
        content = await callLlm(llm, prompt, `flow "${flow.name}"`);
      } catch (err) {
        console.warn(
          `[card-gen] LLM failed for flow "${flow.name}", using structural fallback:`,
          err instanceof Error ? err.message : err,
        );
        const grouped = groupByCategory(flowFiles);
        content = buildMarkdown(flow, grouped, flowEdges, fileIndex);
      }
    } else {
      const grouped = groupByCategory(flowFiles);
      content = buildMarkdown(flow, grouped, flowEdges, fileIndex);
    }

    const domainFilePaths = flowFiles.map((f) => f.path);
    cards.push({
      id: nanoid(),
      flow: flow.name,
      title: `${flow.name} flow`,
      content,
      cardType: "flow",
      sourceFiles: domainFilePaths,
      sourceRepos: flow.repos,
      tags: computeTags(flowFiles, flow.repos),
      validBranches: null,
      commitSha: null,
    });
  }

  return cards;
}

/* ------------------------------------------------------------------ */
/*  Model cards                                                        */
/* ------------------------------------------------------------------ */

async function generateModelCards(
  parsedFiles: ParsedFile[],
  edges: GraphEdge[],
  fileIndex: Map<string, ParsedFile>,
  llm: LLMProvider | null,
  projectContextByRepo?: Map<string, string>,
): Promise<GeneratedCard[]> {
  const models = parsedFiles
    .filter(
      (f) =>
        // Any language can have model cards — Ruby models, Django models, etc.
        f.associations.length >= MIN_MODEL_ASSOCIATIONS &&
        // Skip test files, config, and entry points — they pollute cards
        isDomainRelevant(f.fileRole),
    )
    .sort((a, b) => b.associations.length - a.associations.length)
    .slice(0, MAX_MODEL_CARDS);

  const cards: GeneratedCard[] = [];

  for (const model of models) {
    const modelEdges = edges.filter(
      (e) => e.sourceFile === model.path || e.targetFile === model.path,
    );

    const relatedPaths = new Set<string>();
    for (const e of modelEdges) {
      relatedPaths.add(e.sourceFile);
      relatedPaths.add(e.targetFile);
    }
    relatedPaths.delete(model.path);

    const relatedFiles = [...relatedPaths]
      .map((p) => fileIndex.get(p))
      .filter((f): f is ParsedFile => f != null);

    const modelName =
      model.classes[0]?.name ?? basename(model.path).replace(/\.rb$/, "");

    let content: string;

    const projectContext = mergeProjectContext([model.repo], projectContextByRepo);

    if (llm) {
      try {
        const prompt = buildModelCardPrompt(model, modelEdges, relatedFiles, projectContext);
        content = await callLlm(llm, prompt, `model "${modelName}"`);
      } catch (err) {
        console.warn(
          `[card-gen] LLM failed for model "${modelName}", using structural fallback:`,
          err instanceof Error ? err.message : err,
        );
        content = buildModelMarkdown(model, modelEdges, fileIndex);
      }
    } else {
      content = buildModelMarkdown(model, modelEdges, fileIndex);
    }

    cards.push({
      id: nanoid(),
      flow: modelName,
      title: `${modelName} model`,
      content,
      cardType: "model",
      sourceFiles: [model.path, ...relatedPaths],
      sourceRepos: [model.repo],
      tags: computeTags([model, ...relatedFiles], [model.repo]),
      validBranches: null,
      commitSha: null,
    });
  }

  return cards;
}

function buildModelMarkdown(
  model: ParsedFile,
  modelEdges: GraphEdge[],
  fileIndex: Map<string, ParsedFile>,
): string {
  const modelName =
    model.classes[0]?.name ?? basename(model.path).replace(/\.rb$/, "");

  const lines: string[] = [`## ${modelName}`, "", `**File**: ${model.path}`];

  if (model.associations.length > 0) {
    lines.push("", "### Associations");
    const byType = rollupAssociations(model.associations);
    for (const [type, names] of byType) {
      lines.push(`- ${type}: ${names.join(", ")}`);
    }
  }

  if (model.validations.length > 0) {
    lines.push("", "### Validations");
    for (const v of model.validations) {
      lines.push(`- ${v}`);
    }
  }

  if (model.callbacks.length > 0) {
    lines.push("", "### Callbacks");
    for (const cb of model.callbacks) {
      lines.push(`- ${cb}`);
    }
  }

  const nonImportEdges = modelEdges.filter((e) => e.relation !== "import");
  if (nonImportEdges.length > 0) {
    lines.push("", "### Connections");
    for (const e of nonImportEdges) {
      const src = displayName(e.sourceFile, fileIndex);
      const tgt = displayName(e.targetFile, fileIndex);
      lines.push(`- ${src} → ${tgt} (${relationLabel(e)})`);
    }
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Cross-service cards                                                */
/* ------------------------------------------------------------------ */

interface CrossServicePair {
  feFile: string;
  beFile: string;
  edges: GraphEdge[];
}

async function generateCrossServiceCards(
  edges: GraphEdge[],
  fileIndex: Map<string, ParsedFile>,
  llm: LLMProvider | null,
  projectContextByRepo?: Map<string, string>,
): Promise<GeneratedCard[]> {
  const apiEdges = edges.filter((e) => e.relation === "api_endpoint");
  const pairMap = new Map<string, CrossServicePair>();

  for (const e of apiEdges) {
    const key = `${e.sourceFile}\0${e.targetFile}`;
    let pair = pairMap.get(key);
    if (!pair) {
      pair = { feFile: e.sourceFile, beFile: e.targetFile, edges: [] };
      pairMap.set(key, pair);
    }
    pair.edges.push(e);
  }

  const pairs = [...pairMap.values()]
    .sort((a, b) => b.edges.length - a.edges.length)
    .slice(0, MAX_CROSS_SERVICE_CARDS);

  const cards: GeneratedCard[] = [];

  for (const pair of pairs) {
    const feParsed = fileIndex.get(pair.feFile);
    const beParsed = fileIndex.get(pair.beFile);
    if (!feParsed || !beParsed) continue;
    // Skip cross-service pairs where either side is a test or entry-point file
    if (!isDomainRelevant(feParsed.fileRole) || !isDomainRelevant(beParsed.fileRole)) continue;

    const feBasename = basename(pair.feFile);
    const beBasename = basename(pair.beFile);
    const title = `${feBasename} → ${beBasename}`;

    let content: string;

    const repos = new Set<string>();
    if (feParsed.repo) repos.add(feParsed.repo);
    if (beParsed.repo) repos.add(beParsed.repo);
    const projectContext = mergeProjectContext([...repos], projectContextByRepo);

    if (llm) {
      try {
        const prompt = buildCrossServiceCardPrompt(feParsed, beParsed, pair.edges, projectContext);
        content = await callLlm(llm, prompt, `cross-service "${title}"`);
      } catch (err) {
        console.warn(
          `[card-gen] LLM failed for cross-service "${title}", using structural fallback:`,
          err instanceof Error ? err.message : err,
        );
        content = buildCrossServiceMarkdown(feParsed, beParsed, pair.edges);
      }
    } else {
      content = buildCrossServiceMarkdown(feParsed, beParsed, pair.edges);
    }

    cards.push({
      id: nanoid(),
      flow: title,
      title,
      content,
      cardType: "cross_service",
      sourceFiles: [pair.feFile, pair.beFile],
      sourceRepos: [...repos],
      tags: computeTags([feParsed, beParsed], [...repos]),
      validBranches: null,
      commitSha: null,
    });
  }

  return cards;
}

function buildCrossServiceMarkdown(
  feFile: ParsedFile,
  beFile: ParsedFile,
  pairEdges: GraphEdge[],
): string {
  const feLabel = basename(feFile.path);
  const beLabel =
    beFile.classes[0]?.name ?? basename(beFile.path);

  const lines: string[] = [
    `## ${feLabel} → ${beLabel}`,
    "",
    `**Frontend**: ${feFile.path}`,
    `**Backend**: ${beFile.path}`,
  ];

  if (feFile.apiCalls.length > 0) {
    lines.push("", "### API calls");
    for (const c of feFile.apiCalls) {
      lines.push(`- ${c.method} ${c.path ?? ""}`);
    }
  }

  if (beFile.routes.length > 0) {
    lines.push("", "### Routes");
    for (const r of beFile.routes) {
      lines.push(`- ${r.method} ${r.path} → ${r.action ?? "?"}`);
    }
  }

  if (pairEdges.length > 0) {
    lines.push("", "### Edges");
    for (const e of pairEdges) {
      const meta = Object.values(e.metadata).filter(Boolean).join(", ");
      lines.push(`- ${e.relation}${meta ? ` (${meta})` : ""}`);
    }
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Hub cards                                                          */
/* ------------------------------------------------------------------ */

async function generateHubCards(
  hubFlows: Flow[],
  allFlows: Flow[],
  edges: GraphEdge[],
  fileIndex: Map<string, ParsedFile>,
  llm: LLMProvider | null,
  projectContextByRepo?: Map<string, string>,
): Promise<GeneratedCard[]> {
  const cards: GeneratedCard[] = [];

  for (const flow of hubFlows) {
    const hubFilePath = flow.files[0];
    if (!hubFilePath) continue;

    const hubFile = fileIndex.get(hubFilePath);
    if (!hubFile) continue;

    const hubEdges = edges.filter(
      (e) => e.sourceFile === hubFilePath || e.targetFile === hubFilePath,
    );

    const hubName =
      hubFile.classes[0]?.name ?? basename(hubFilePath).replace(/\.rb$/, "");

    const connectedFlows = allFlows.filter(
      (f) => !f.isHub && f.files.some((fp) => hubEdges.some(
        (e) => e.sourceFile === fp || e.targetFile === fp,
      )),
    );

    const projectContext = mergeProjectContext(flow.repos, projectContextByRepo);

    let content: string;

    if (llm) {
      try {
        const prompt = buildHubCardPrompt(hubFile, connectedFlows, hubEdges, projectContext);
        content = await callLlm(llm, prompt, `hub "${hubName}"`);
      } catch (err) {
        console.warn(
          `[card-gen] LLM failed for hub "${hubName}", using structural fallback:`,
          err instanceof Error ? err.message : err,
        );
        content = buildHubMarkdown(hubFile, hubEdges, connectedFlows, fileIndex);
      }
    } else {
      content = buildHubMarkdown(hubFile, hubEdges, connectedFlows, fileIndex);
    }

    cards.push({
      id: nanoid(),
      flow: flow.name,
      title: `${hubName} hub`,
      content,
      cardType: "hub",
      sourceFiles: flow.files,
      sourceRepos: flow.repos,
      tags: computeTags([hubFile], flow.repos),
      validBranches: null,
      commitSha: null,
    });
  }

  return cards;
}

function buildHubMarkdown(
  hubFile: ParsedFile,
  hubEdges: GraphEdge[],
  connectedFlows: Flow[],
  fileIndex: Map<string, ParsedFile>,
): string {
  const hubName =
    hubFile.classes[0]?.name ?? basename(hubFile.path).replace(/\.rb$/, "");

  const lines: string[] = [
    `## ${hubName} (hub)`,
    "",
    `**File**: ${hubFile.path}`,
  ];

  if (hubFile.associations.length > 0) {
    lines.push("", "### Associations");
    const byType = rollupAssociations(hubFile.associations);
    for (const [type, names] of byType) {
      lines.push(`- ${type}: ${names.join(", ")}`);
    }
  }

  if (connectedFlows.length > 0) {
    lines.push("", "### Connected flows");
    for (const f of connectedFlows) {
      lines.push(`- ${f.name} (${f.files.length} files, ${f.repos.join(", ")})`);
    }
  }

  const nonImportEdges = hubEdges.filter((e) => e.relation !== "import");
  if (nonImportEdges.length > 0) {
    lines.push("", "### Connections");
    for (const e of nonImportEdges) {
      const src = displayName(e.sourceFile, fileIndex);
      const tgt = displayName(e.targetFile, fileIndex);
      lines.push(`- ${src} → ${tgt} (${relationLabel(e)})`);
    }
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  File categorisation                                                */
/* ------------------------------------------------------------------ */

function categorize(pf: ParsedFile): FileCategory {
  const lp = pf.path.toLowerCase();

  if (pf.language === "ruby") {
    if (lp.includes("/controllers/") || lp.endsWith("_controller.rb"))
      return "controller";
    if (lp.includes("/jobs/") || lp.endsWith("_job.rb")) return "job";
    if (lp.includes("/models/") || pf.associations.length > 0) return "model";
    return "other";
  }

  if (lp.includes("/api/") && pf.apiCalls.length > 0) return "api_client";
  if (/\/(stores?|slices?|redux)\//i.test(lp)) return "store";
  if (/\/(components?|views?)\//i.test(lp)) return "component";
  if (pf.apiCalls.length > 0) return "api_client";

  return "other";
}

/**
 * Returns true for file roles that should contribute to card content.
 * Tests, configs, and pure entry-points are indexed but excluded from
 * the card embedding text to keep semantic signals clean.
 */
export function isDomainRelevant(role: FileRole): boolean {
  return role === "domain" || role === "shared_utility";
}

export function computeTags(sourceFiles: ParsedFile[], sourceRepos: string[]): string[] {
  const tags = new Set<string>();

  for (const repo of sourceRepos) {
    const lower = repo.toLowerCase();
    if (lower.includes("frontend")) tags.add("frontend");
    else if (lower.includes("backend") || lower.includes("api")) tags.add("backend");
  }

  for (const f of sourceFiles) {
    const cat = categorize(f);
    if (cat !== "other") tags.add(cat);
    tags.add(f.language);
    // Tag shared utilities so search can deprioritize them
    if (f.fileRole === "shared_utility") tags.add("shared_utility");
  }

  return [...tags];
}

function groupByCategory(
  files: ParsedFile[],
): Map<FileCategory, ParsedFile[]> {
  const m = new Map<FileCategory, ParsedFile[]>();
  for (const f of files) {
    const cat = categorize(f);
    let bucket = m.get(cat);
    if (!bucket) {
      bucket = [];
      m.set(cat, bucket);
    }
    bucket.push(f);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/*  Structural markdown assembly (flow card fallback)                   */
/* ------------------------------------------------------------------ */

function buildMarkdown(
  flow: Flow,
  grouped: Map<FileCategory, ParsedFile[]>,
  edges: GraphEdge[],
  fileIndex: Map<string, ParsedFile>,
): string {
  const parts: string[] = [
    `## ${flow.name} flow`,
    "",
    `**Repos**: ${flow.repos.join(", ")}`,
  ];

  for (const cat of CATEGORY_ORDER) {
    const files = grouped.get(cat);
    if (!files?.length) continue;

    parts.push("");
    switch (cat) {
      case "model":
        parts.push(renderModels(files));
        break;
      case "controller":
        parts.push(renderControllers(files, edges));
        break;
      case "job":
        parts.push(renderJobs(files));
        break;
      case "api_client":
      case "store":
      case "component":
        parts.push(renderFrontend(grouped));
        grouped.delete("api_client");
        grouped.delete("store");
        grouped.delete("component");
        break;
    }
  }

  if (edges.length > 0) {
    parts.push("");
    parts.push(renderRelationships(edges, fileIndex));
  }

  return parts.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Section renderers                                                  */
/* ------------------------------------------------------------------ */

function renderModels(files: ParsedFile[]): string {
  const lines: string[] = ["### Models"];

  for (const f of files) {
    lines.push(`- **${f.classes[0]?.name ?? basename(f.path)}** (${f.path})`);

    if (f.associations.length > 0) {
      const byType = rollupAssociations(f.associations);
      for (const [type, names] of byType) {
        lines.push(`  - ${type}: ${names.join(", ")}`);
      }
    }
  }

  return lines.join("\n");
}

function renderControllers(
  files: ParsedFile[],
  edges: GraphEdge[],
): string {
  const lines: string[] = ["### Controllers"];

  for (const f of files) {
    lines.push(
      `- ${f.classes[0]?.name ?? basename(f.path)} (${f.path})`,
    );

    const routes = routesForController(f.path, edges);
    if (routes.length > 0) {
      lines.push(`  - Routes: ${routes.join(", ")}`);
    }
  }

  return lines.join("\n");
}

function renderJobs(files: ParsedFile[]): string {
  const lines: string[] = ["### Jobs"];

  for (const f of files) {
    lines.push(`- ${f.classes[0]?.name ?? basename(f.path)} (${f.path})`);
  }

  return lines.join("\n");
}

function renderFrontend(
  grouped: Map<FileCategory, ParsedFile[]>,
): string {
  const lines: string[] = ["### Frontend"];

  const feCategories: Array<[FileCategory, string]> = [
    ["api_client", "API client"],
    ["store", "Redux slice"],
    ["component", "Component"],
  ];

  for (const [cat, label] of feCategories) {
    const files = grouped.get(cat);
    if (!files?.length) continue;

    for (const f of files) {
      lines.push(`- ${label}: ${f.path}`);

      if (f.apiCalls.length > 0) {
        const calls = f.apiCalls.map((c) => `${c.method} ${c.path}`);
        lines.push(`  - Calls: ${calls.join(", ")}`);
      }

      if (f.imports.length > 0) {
        const apiImports = f.imports.filter((i) => /api/i.test(i.source));
        if (apiImports.length > 0) {
          const names = apiImports.map((i) => i.name);
          if (names.length > 0) {
            lines.push(`  - Imports: ${names.join(", ")}`);
          }
        }
      }
    }
  }

  return lines.join("\n");
}

function renderRelationships(
  edges: GraphEdge[],
  fileIndex: Map<string, ParsedFile>,
): string {
  const lines: string[] = ["### Cross-service relationships"];

  for (const e of edges) {
    const src = displayName(e.sourceFile, fileIndex);
    const tgt = displayName(e.targetFile, fileIndex);
    const rel = relationLabel(e);
    lines.push(`- ${src} → ${tgt} (${rel})`);
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function rollupAssociations(
  assocs: ParsedFile["associations"],
): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const a of assocs) {
    const target = a.target_model ?? pascalFromAssoc(a.name, a.type);
    let list = m.get(a.type);
    if (!list) {
      list = [];
      m.set(a.type, list);
    }
    list.push(target);
  }
  return m;
}

function pascalFromAssoc(name: string, type: string): string {
  const singular =
    type === "has_many" || type === "has_and_belongs_to_many"
      ? naiveSingularize(name)
      : name;
  return singular
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

function naiveSingularize(word: string): string {
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("shes") || word.endsWith("ches")) return word.slice(0, -2);
  if (word.endsWith("xes") || word.endsWith("zes")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function routesForController(
  controllerPath: string,
  edges: GraphEdge[],
): string[] {
  return edges
    .filter(
      (e) =>
        e.targetFile === controllerPath && e.relation === "route_controller",
    )
    .map((e) => {
      const method =
        RAILS_ACTION_METHODS[e.metadata.action ?? ""] ??
        (e.metadata.action ?? "").toUpperCase();
      return `${method} ${e.metadata.path ?? ""}`;
    });
}

function displayName(
  filePath: string,
  fileIndex: Map<string, ParsedFile>,
): string {
  const pf = fileIndex.get(filePath);
  const name = pf?.classes[0]?.name ?? basename(filePath);
  const lp = filePath.toLowerCase();

  if (lp.includes("frontend") || lp.includes("client")) return `FE ${name}`;
  if (lp.includes("backend") || lp.includes("server")) return `BE ${name}`;
  return name;
}

function relationLabel(edge: GraphEdge): string {
  if (edge.relation === "model_association") {
    return edge.metadata.associationType ?? "association";
  }
  return RELATION_LABELS[edge.relation] ?? edge.relation;
}

function basename(filePath: string): string {
  const last = filePath.split("/").at(-1);
  return last ?? filePath;
}
