import type { Flow } from "../indexer/flow-detector.js";
import type { ParsedFile } from "../indexer/types.js";
import type { GraphEdge } from "../indexer/graph-builder.js";

const MAX_FILES_PER_FLOW = 30;
const MAX_EDGES_PER_CARD = 20;

const COMMON_PATH_PREFIXES = [
  /^\/Users\/[^/]+\/[^/]+\//,
  /^\/home\/[^/]+\/[^/]+\//,
  /^\/var\/[^/]+\//,
  /^\/opt\/[^/]+\//,
];

export const SYSTEM_PROMPT = `You are srcmap, a code context engine. Generate concise, accurate knowledge cards about a codebase from structural analysis data.

Rules:
- Write clear, technical markdown
- Focus on relationships between components, not implementation details
- Keep cards under 500 words
- Use bullet points for lists
- Mention file paths only when they add context
- Describe the "what" and "why", not the "how"
- If you see patterns (naming conventions, architectural decisions), mention them`;

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export function buildFlowCardPrompt(
  flow: Flow,
  files: ParsedFile[],
  edges: GraphEdge[],
): string {
  const models = files
    .filter((f) => f.classes.some((c) => c.type === "model"))
    .map((f) => ({
      name: f.classes.find((c) => c.type === "model")!.name,
      associations: f.associations.map((a) => ({
        type: a.type,
        name: a.name,
        target: a.target_model,
      })),
    }));

  const controllers = files
    .filter((f) => f.classes.some((c) => c.type === "controller"))
    .map((f) => ({
      name: f.classes.find((c) => c.type === "controller")!.name,
      routes: f.routes.map((r) => ({
        method: r.method,
        path: r.path,
        action: r.action,
      })),
    }));

  const feFiles = files
    .filter((f) => f.apiCalls.length > 0)
    .map((f) => ({
      path: shortenPath(f.path),
      apiCalls: f.apiCalls.map((c) => ({
        method: c.method,
        path: c.path,
      })),
    }));

  const crossEdges = truncate(edges, MAX_EDGES_PER_CARD)
    .filter((e) => e.relation !== "import")
    .map(compactEdge);

  const summary = {
    flow: flow.name,
    repos: flow.repos,
    fileCount: flow.files.length,
    models,
    controllers,
    feFiles: truncate(feFiles, MAX_FILES_PER_FLOW),
    crossServiceEdges: crossEdges,
  };

  return `Here is the structural analysis of a code flow named "${flow.name}":

\`\`\`json
${JSON.stringify(summary, null, 2)}
\`\`\`

Generate a knowledge card for this flow. Cover:
1. What this flow does (infer from model/controller names and associations)
2. Which repos and services are involved and their roles
3. Key relationships and data flow between components
4. Entry points (controllers, API endpoints)

Use markdown with a heading that names the flow.`;
}

export function buildModelCardPrompt(
  model: ParsedFile,
  edges: GraphEdge[],
  relatedFiles: ParsedFile[],
): string {
  const modelClass = model.classes.find((c) => c.type === "model");

  const controllers = relatedFiles
    .filter((f) => f.classes.some((c) => c.type === "controller"))
    .map((f) => ({
      name: f.classes.find((c) => c.type === "controller")!.name,
      routes: f.routes.map((r) => ({
        method: r.method,
        path: r.path,
        action: r.action,
      })),
    }));

  const feComponents = relatedFiles
    .filter((f) => f.apiCalls.length > 0 && f.language !== "ruby")
    .map((f) => ({
      path: shortenPath(f.path),
      apiCalls: f.apiCalls.map((c) => ({ method: c.method, path: c.path })),
    }));

  const summary = {
    model: {
      name: modelClass?.name ?? model.classes[0]?.name ?? shortenPath(model.path),
      parent: modelClass?.parent ?? model.classes[0]?.parent,
      associations: model.associations.map((a) => ({
        type: a.type,
        name: a.name,
        target: a.target_model,
      })),
      validations: model.validations,
      callbacks: model.callbacks,
    },
    controllers,
    feComponents: truncate(feComponents, MAX_FILES_PER_FLOW),
    edges: truncate(edges, MAX_EDGES_PER_CARD).map(compactEdge),
  };

  return `Here is the structural analysis of a data model:

\`\`\`json
${JSON.stringify(summary, null, 2)}
\`\`\`

Generate a knowledge card for this model. Cover:
1. What this model represents (infer from its name and associations)
2. Key relationships to other models
3. Business rules (from validations and callbacks)
4. How the frontend interacts with it (via controllers and API calls)

Use markdown with a heading that names the model.`;
}

export function buildCrossServiceCardPrompt(
  feFile: ParsedFile,
  beFile: ParsedFile,
  edges: GraphEdge[],
): string {
  const beModel = beFile.classes.find((c) => c.type === "model");

  const summary = {
    frontend: {
      path: shortenPath(feFile.path),
      apiCalls: feFile.apiCalls.map((c) => ({
        method: c.method,
        path: c.path,
        variable: c.variable,
      })),
      imports: feFile.imports.slice(0, 15).map((i) => ({
        name: i.name,
        source: i.source,
      })),
    },
    backend: {
      path: shortenPath(beFile.path),
      routes: beFile.routes.map((r) => ({
        method: r.method,
        path: r.path,
        action: r.action,
      })),
      associatedModel: beModel?.name,
    },
    connectingEdges: truncate(edges, MAX_EDGES_PER_CARD).map(compactEdge),
  };

  return `Here is the structural analysis of a cross-service connection:

\`\`\`json
${JSON.stringify(summary, null, 2)}
\`\`\`

Generate a knowledge card for this frontend-backend connection. Cover:
1. What data flows between the frontend and backend
2. Which endpoints are called and their HTTP methods
3. What the user experience likely involves (infer from the component and endpoint names)

Use markdown with a heading that describes the connection.`;
}

export function buildHubCardPrompt(
  hubFile: ParsedFile,
  connectedFlows: Flow[],
  edges: GraphEdge[],
): string {
  const hubClass = hubFile.classes.find((c) => c.type === "model");

  const summary = {
    hub: {
      name: hubClass?.name ?? hubFile.classes[0]?.name ?? shortenPath(hubFile.path),
      parent: hubClass?.parent ?? hubFile.classes[0]?.parent,
      associations: hubFile.associations.map((a) => ({
        type: a.type,
        name: a.name,
        target: a.target_model,
      })),
      validations: hubFile.validations,
      callbacks: hubFile.callbacks,
    },
    flows: connectedFlows.map((f) => ({
      name: f.name,
      repos: f.repos,
      fileCount: f.files.length,
    })),
    edges: truncate(edges, MAX_EDGES_PER_CARD).map(compactEdge),
  };

  return `Here is the structural analysis of a hub entity in the codebase:

\`\`\`json
${JSON.stringify(summary, null, 2)}
\`\`\`

Generate a knowledge card for this hub entity. Cover:
1. Why this is a central entity (based on its associations and the number of flows it connects)
2. What it connects across the system
3. How changes to this entity would ripple through the codebase

Use markdown with a heading that names the hub entity.`;
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
