import type { ParsedFile } from "./tree-sitter.js";

export interface GraphEdge {
  sourceFile: string;
  targetFile: string;
  relation:
    | "model_association"
    | "controller_model"
    | "api_endpoint"
    | "store_api"
    | "import"
    | "route_controller"
    | "job_model";
  metadata: Record<string, string>;
  repo: string;
  weight?: number;
}

const EDGE_WEIGHTS: Record<GraphEdge["relation"], number> = {
  model_association: 5,
  controller_model: 4,
  route_controller: 4,
  api_endpoint: 3,
  store_api: 3,
  job_model: 3,
  import: 1,
};

/**
 * Builds a dependency graph from parsed source files across one or more repos.
 * Returns a deduplicated list of edges representing relationships between files.
 *
 * Role-aware: test files contribute no edges; entry-point and shared_utility
 * files contribute reduced-weight edges so they don't distort Louvain communities.
 */
export function buildGraph(parsedFiles: ParsedFile[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const classIndex = buildClassIndex(parsedFiles);

  // Pre-compute role multipliers per file
  const roleWeightMultiplier = (role: ParsedFile["fileRole"]): number => {
    switch (role) {
      case "test":         return 0;   // no edges at all — test files have no domain meaning
      case "config":       return 0;   // config files don't define domain relationships
      case "entry_point":  return 0;   // entry points are structurally noisy, excluded from graph
      case "shared_utility": return 0.2; // present but strongly downweighted
      default:             return 1.0;
    }
  };

  function addEdge(edge: GraphEdge): void {
    if ((edge.weight ?? 1) <= 0) return; // skip zero-weight edges entirely
    const key = `${edge.sourceFile}|${edge.targetFile}|${edge.relation}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ ...edge, weight: edge.weight ?? EDGE_WEIGHTS[edge.relation] ?? 1 });
  }

  for (const pf of parsedFiles) {
    const mult = roleWeightMultiplier(pf.fileRole);
    if (mult <= 0) continue; // test / config files: skip all edge generation

    addModelAssociationEdgesWeighted(pf, classIndex, addEdge, mult);
    addRouteControllerEdges(pf, parsedFiles, addEdge);
    addControllerModelEdges(pf, classIndex, addEdge);
    // Entry points should NOT create cross-service or store edges (too noisy)
    if (pf.fileRole === "domain" || pf.fileRole === "shared_utility") {
      addCrossRepoApiEdges(pf, parsedFiles, addEdge);
      addStoreApiEdges(pf, parsedFiles, addEdge);
      addReactApiCallEdges(pf, parsedFiles, addEdge);
    }
    addImportEdges(pf, parsedFiles, addEdge, mult);
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Edge producers
// ---------------------------------------------------------------------------

function addModelAssociationEdgesWeighted(
  pf: ParsedFile,
  classIndex: Map<string, ParsedFile>,
  addEdge: (e: GraphEdge) => void,
  weightMultiplier = 1.0,
): void {
  if (pf.associations.length === 0) return;

  for (const assoc of pf.associations) {
    const targetClass =
      assoc.target_model ?? associationToClassName(assoc.name, assoc.type);
    const target = classIndex.get(targetClass);
    if (!target || target.path === pf.path) continue;

    // Downweight edges from shared_utility sources
    const baseWeight = EDGE_WEIGHTS["model_association"];
    const targetMult =
      target.fileRole === "shared_utility" ? 0.2 :
      target.fileRole === "test" ? 0 : 1.0;

    addEdge({
      sourceFile: pf.path,
      targetFile: target.path,
      relation: "model_association",
      metadata: {
        associationType: assoc.type,
        associationName: assoc.name,
        targetClass,
        fileRole: pf.fileRole,
      },
      repo: pf.repo,
      weight: baseWeight * weightMultiplier * targetMult,
    });
  }
}

function addRouteControllerEdges(
  pf: ParsedFile,
  parsedFiles: ParsedFile[],
  addEdge: (e: GraphEdge) => void,
): void {
  if (pf.routes.length === 0) return;

  for (const route of pf.routes) {
    const controller = parsedFiles.find(
      (f) =>
        f.repo === pf.repo &&
        f.path.endsWith(`${route.controller}_controller.rb`),
    );
    if (!controller) continue;

    addEdge({
      sourceFile: pf.path,
      targetFile: controller.path,
      relation: "route_controller",
      metadata: { path: route.path, action: route.action ?? "" },
      repo: pf.repo,
    });
  }
}

function addControllerModelEdges(
  pf: ParsedFile,
  classIndex: Map<string, ParsedFile>,
  addEdge: (e: GraphEdge) => void,
): void {
  if (pf.language !== "ruby") return;

  const match = pf.path.match(/(\w+)_controller\.rb$/);
  if (!match) return;

  const inferredClass = snakeToPascal(singularize(match[1]));
  const model = classIndex.get(inferredClass);
  if (!model || model.path === pf.path) return;

  addEdge({
    sourceFile: pf.path,
    targetFile: model.path,
    relation: "controller_model",
    metadata: { inferredModel: inferredClass },
    repo: pf.repo,
  });
}

/**
 * Matches FE API client files to BE controllers by converting
 * kebab-case filenames to snake_case controller names.
 */
function addCrossRepoApiEdges(
  pf: ParsedFile,
  parsedFiles: ParsedFile[],
  addEdge: (e: GraphEdge) => void,
): void {
  if (pf.language === "ruby" || pf.apiCalls.length === 0) return;

  const basename = fileBasename(pf.path);
  const snakeName = kebabToSnake(basename);

  for (const other of parsedFiles) {
    if (other.repo === pf.repo) continue;

    // Match against controller filenames
    if (
      other.language === "ruby" &&
      other.path.endsWith(`${snakeName}_controller.rb`)
    ) {
      addEdge({
        sourceFile: pf.path,
        targetFile: other.path,
        relation: "api_endpoint",
        metadata: { feResource: basename, beController: snakeName },
        repo: pf.repo,
      });
      continue;
    }

    // Fall back to route path matching
    const matchingRoute = other.routes.find(
      (r) => r.controller === snakeName || r.path.includes(`/${snakeName}`),
    );
    if (matchingRoute) {
      addEdge({
        sourceFile: pf.path,
        targetFile: other.path,
        relation: "api_endpoint",
        metadata: {
          feResource: basename,
          routePath: matchingRoute.path,
        },
        repo: pf.repo,
      });
    }
  }
}

function addStoreApiEdges(
  pf: ParsedFile,
  parsedFiles: ParsedFile[],
  addEdge: (e: GraphEdge) => void,
): void {
  if (pf.language === "ruby" || !/store/i.test(pf.path)) return;

  for (const imp of pf.imports) {
    if (!/api/i.test(imp.source)) continue;

    const target = resolveImport(pf, imp.source, parsedFiles);
    if (!target || target.path === pf.path) continue;

    addEdge({
      sourceFile: pf.path,
      targetFile: target.path,
      relation: "store_api",
      metadata: { importSource: imp.source },
      repo: pf.repo,
    });
  }
}

/**
 * Detects FE→BE API call edges for React/JS files by scanning raw source for
 * URL string patterns like "/api/pre_authorizations", "'/pre-authorizations'"
 * and mapping the resource slug to a matching BE controller file.
 */
function addReactApiCallEdges(
  pf: ParsedFile,
  parsedFiles: ParsedFile[],
  addEdge: (e: GraphEdge) => void,
): void {
  // Only run on FE files (non-ruby)
  if (pf.language === "ruby") return;

  // Extract API URL slugs from known patterns in imports/source hints
  const apiSlugs = new Set<string>();

  // Mine from import sources that look like API modules
  for (const imp of pf.imports) {
    const src = imp.source.toLowerCase();
    if (src.includes("api") || src.includes("service") || src.includes("client")) {
      // e.g. "../../api/preAuthorizations" → "pre_authorizations"
      const lastSegment = imp.source.replace(/.*\//, "").replace(/\.[^.]+$/, "");
      const slug = camelToSnake(lastSegment);
      if (slug && slug.length > 2) apiSlugs.add(slug);
    }
  }

  // Also check the file path itself — a file in components/PreAuthorizations/ is
  // implicitly about that resource
  const componentDirMatch = pf.path.match(/\/components\/([^/]+)\//);
  if (componentDirMatch?.[1]) {
    const slug = camelToSnake(componentDirMatch[1]);
    if (slug && slug.length > 2) apiSlugs.add(slug);
  }

  if (apiSlugs.size === 0) return;

  // Find BE files (ruby) in other repos that match these slugs
  const beFiles = parsedFiles.filter(
    (other) =>
      other.language === "ruby" &&
      other.repo !== pf.repo &&
      (other.path.includes("/models/") || other.path.includes("/controllers/")),
  );

  for (const slug of apiSlugs) {
    const singular = singularize(slug);
    for (const be of beFiles) {
      const bePath = be.path.toLowerCase();
      if (
        bePath.includes(`/${singular}.rb`) ||
        bePath.includes(`/${slug}_controller.rb`) ||
        bePath.includes(`/controllers/${slug}/`)
      ) {
        addEdge({
          sourceFile: pf.path,
          targetFile: be.path,
          relation: "api_endpoint",
          metadata: { slug },
          repo: pf.repo,
          weight: EDGE_WEIGHTS["api_endpoint"] ?? 1.5,
        });
      }
    }
  }
}

function camelToSnake(str: string): string {
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/-/g, "_");
}

function addImportEdges(
  pf: ParsedFile,
  parsedFiles: ParsedFile[],
  addEdge: (e: GraphEdge) => void,
  weightMultiplier = 1.0,
): void {
  for (const imp of pf.imports) {
    const target = resolveImport(pf, imp.source, parsedFiles);
    if (!target || target.path === pf.path) continue;
    if (target.repo !== pf.repo) continue;
    if (target.fileRole === "test" || target.fileRole === "config") continue;

    const targetMult =
      target.fileRole === "entry_point" ? 0.1 :
      target.fileRole === "shared_utility" ? 0.3 : 1.0;

    addEdge({
      sourceFile: pf.path,
      targetFile: target.path,
      relation: "import",
      metadata: { importSource: imp.source, fileRole: pf.fileRole },
      repo: pf.repo,
      weight: EDGE_WEIGHTS["import"] * weightMultiplier * targetMult,
    });
  }
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

/** Naive singularization covering common Rails model plurals. */
function singularize(word: string): string {
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("shes")) return word.slice(0, -2);
  if (word.endsWith("ches")) return word.slice(0, -2);
  if (word.endsWith("xes")) return word.slice(0, -2);
  if (word.endsWith("zes")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function snakeToPascal(snake: string): string {
  return snake
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function associationToClassName(name: string, type: string): string {
  const singular =
    type === "has_many" || type === "has_and_belongs_to_many"
      ? singularize(name)
      : name;
  return snakeToPascal(singular);
}

function kebabToSnake(kebab: string): string {
  return kebab.replace(/-/g, "_");
}

function fileBasename(filePath: string): string {
  return filePath.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
}

// ---------------------------------------------------------------------------
// Import resolution
// ---------------------------------------------------------------------------

function buildClassIndex(
  parsedFiles: ParsedFile[],
): Map<string, ParsedFile> {
  const index = new Map<string, ParsedFile>();
  for (const pf of parsedFiles) {
    for (const cls of pf.classes) {
      index.set(cls.name, pf);
    }
  }
  return index;
}

/** Resolves a relative import source (e.g. `../api/billing-orders`) to a ParsedFile. */
function resolveImport(
  from: ParsedFile,
  source: string,
  parsedFiles: ParsedFile[],
): ParsedFile | undefined {
  if (!source.startsWith(".")) return undefined;

  const dir = from.path.replace(/\/[^/]+$/, "");
  const combined = `${dir}/${source}`;

  const segments = combined.split("/");
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "..") {
      resolved.pop();
    } else if (seg !== ".") {
      resolved.push(seg);
    }
  }

  const normalizedBase = stripExtension(resolved.join("/"));

  return parsedFiles.find((pf) => {
    return stripExtension(pf.path) === normalizedBase;
  });
}

function stripExtension(filePath: string): string {
  return filePath.replace(/\.(js|ts|jsx|tsx|vue|rb)$/, "");
}
