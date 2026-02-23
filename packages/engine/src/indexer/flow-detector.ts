import { UndirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import type { GraphEdge } from "./graph-builder.js";
import type { ParsedFile } from "./tree-sitter.js";
import type { SeedFlow } from "./route-extractor.js";

export interface Flow {
  name: string;
  files: string[];
  repos: string[];
  primaryModel?: string;
  edgeCount: number;
  isHub?: boolean;
}

type LouvainFn = (
  graph: InstanceType<typeof UndirectedGraph>,
  options?: { resolution?: number },
) => Record<string, number>;

// CJS default export interop — louvain has no proper ESM exports field
const runLouvain = louvain as unknown as LouvainFn;

const HUB_DEGREE_THRESHOLD = 6;
const MIN_COMMUNITY_SIZE = 3;

/** Path/directory segments that carry no domain meaning on their own. */
const GENERIC_SEGMENT_NAMES = new Set([
  "common", "api", "shared", "utils", "util",
  "helpers", "helper", "base", "main", "index",
  "v1", "v2", "v3", "v4",
]);

/** Standard Rails CRUD action names that are not interesting as qualifiers. */
const STANDARD_CRUD_ACTIONS = new Set([
  "index", "show", "create", "update", "destroy", "new", "edit", "initialize",
]);

const PATH_SEGMENT_PATTERNS = [
  /\/api\/([^/]+)/,
  /\/controllers\/([^/]+)/,
  /\/models\/([^/]+)/,
  /\/components\/([^/]+)/,
  /\/stores\/([^/]+)/,
  /\/slices\/([^/]+)/,
];

/**
 * Groups connected files into business-level "flows".
 *
 * Two-phase strategy:
 * 1. Seed flows from FE component directories (human-labelled business features)
 *    so that flows like "Pre Authorizations" and "Remote Checks" appear with
 *    their real names and include both FE components and BE models/controllers.
 * 2. Run Louvain community detection on the remaining files that weren't
 *    claimed by any seed, then merge with hub flows.
 *
 * @param seeds  Optional seed flows from extractSeedFlows().  Pass an empty
 *               array (or omit) to fall back to pure Louvain behaviour.
 */
export function detectFlows(
  edges: GraphEdge[],
  parsedFiles: ParsedFile[],
  seeds: SeedFlow[] = [],
): Flow[] {
  const fileIndex = indexByFilePath(parsedFiles);

  // --- Phase 1: Seed flows from FE component directories ---
  const seededFiles = new Set<string>();
  const seededFlows: Flow[] = [];

  for (const seed of seeds) {
    const validFiles = seed.files.filter((f) => fileIndex.has(f));
    if (validFiles.length === 0) continue;

    const componentFiles = new Set(validFiles);
    const edgeCount = countEdgesInComponent(edges, componentFiles);
    const primaryModel = findDominantModel(validFiles, fileIndex);
    const repos = collectRepos(validFiles, fileIndex);

    seededFlows.push({
      name: seed.name,
      files: validFiles.sort(),
      repos,
      primaryModel,
      edgeCount,
    });

    for (const f of validFiles) seededFiles.add(f);
  }

  // --- Phase 2: Absorb hub files into seeded flows ---
  // A hub file (e.g. pre_authorization.rb) should merge into its seeded parent
  // (e.g. "Pre Authorizations") instead of creating a separate hub flow.
  const hubs = detectHubs(edges);
  const absorbedHubs = new Set<string>();

  for (const hubFile of hubs) {
    // Try to find a seeded flow whose files are connected to this hub
    const hubPf = fileIndex.get(hubFile);
    if (!hubPf) continue;
    const hubSnake = hubPf.classes[0]?.name
      ? pascalToSnake(hubPf.classes[0].name)
      : hubFile.replace(/^.*\//, "").replace(/\.[^.]+$/, "").replace(/-/g, "_");

    for (const sf of seededFlows) {
      const seedSnake = sf.name
        .toLowerCase()
        .replace(/\s+/g, "_");

      // Match by name similarity or by file already being in the seed
      const nameMatch =
        seedSnake === hubSnake ||
        seedSnake === hubSnake + "s" ||
        seedSnake + "s" === hubSnake ||
        seedSnake.includes(hubSnake) ||
        hubSnake.includes(seedSnake);

      if (nameMatch && !sf.files.includes(hubFile)) {
        sf.files.push(hubFile);
        if (hubPf.repo && !sf.repos.includes(hubPf.repo)) sf.repos.push(hubPf.repo);
        sf.edgeCount = countEdgesInComponent(edges, new Set(sf.files));
        if (!sf.primaryModel && hubPf.classes[0]?.name) {
          sf.primaryModel = hubPf.classes[0].name;
        }
        absorbedHubs.add(hubFile);
        seededFiles.add(hubFile);
        break;
      }
    }
  }

  // --- Phase 3: Louvain on unseeded files only ---
  const excludedFromLouvain = new Set([...seededFiles, ...hubs]);
  const graph = buildLouvainGraph(edges, excludedFromLouvain);

  const communities =
    graph.order > 0
      ? groupByCommunity(graph)
      : new Map<number, string[]>();

  const communityFlows = buildCommunityFlows(communities, edges, fileIndex);

  // Only create hub flows for hubs that weren't absorbed into a seed
  const remainingHubs = new Set([...hubs].filter((h) => !absorbedHubs.has(h)));
  const hubFlows = buildHubFlows(remainingHubs, edges, fileIndex);

  const flows = [...seededFlows, ...communityFlows, ...hubFlows];
  flows.sort((a, b) => b.edgeCount - a.edgeCount);
  return flows;
}

// ---------------------------------------------------------------------------
// Step 1: Hub detection
// ---------------------------------------------------------------------------

function detectHubs(edges: GraphEdge[]): Set<string> {
  // Count weighted degree across ALL high-signal relation types
  // (not just model_association, so polymorphic models also become hubs)
  const HIGH_SIGNAL_RELATIONS = new Set([
    "model_association",
    "controller_model",
    "route_controller",
  ]);

  const degree = new Map<string, number>();
  for (const e of edges) {
    if (!HIGH_SIGNAL_RELATIONS.has(e.relation)) continue;
    // Weight by edge weight so downweighted (shared_utility) edges count less
    const w = e.weight ?? 1;
    degree.set(e.sourceFile, (degree.get(e.sourceFile) ?? 0) + w);
    degree.set(e.targetFile, (degree.get(e.targetFile) ?? 0) + w);
  }

  const hubs = new Set<string>();
  for (const [file, deg] of degree) {
    if (deg >= HUB_DEGREE_THRESHOLD) hubs.add(file);
  }
  return hubs;
}

// ---------------------------------------------------------------------------
// Step 2: Build undirected Graphology graph (excluding hubs)
// ---------------------------------------------------------------------------

function buildLouvainGraph(
  edges: GraphEdge[],
  excluded: Set<string>,
): InstanceType<typeof UndirectedGraph> {
  const graph = new UndirectedGraph();

  for (const edge of edges) {
    if (excluded.has(edge.sourceFile) || excluded.has(edge.targetFile)) continue;

    if (!graph.hasNode(edge.sourceFile)) graph.addNode(edge.sourceFile);
    if (!graph.hasNode(edge.targetFile)) graph.addNode(edge.targetFile);

    const edgeKey = `${edge.sourceFile}\0${edge.targetFile}`;
    const reverseKey = `${edge.targetFile}\0${edge.sourceFile}`;

    if (graph.hasEdge(edgeKey) || graph.hasEdge(reverseKey)) {
      const existing = graph.hasEdge(edgeKey) ? edgeKey : reverseKey;
      const current = graph.getEdgeAttribute(existing, "weight") as number;
      graph.setEdgeAttribute(existing, "weight", current + (edge.weight ?? 1));
    } else {
      graph.addEdgeWithKey(edgeKey, edge.sourceFile, edge.targetFile, {
        weight: edge.weight ?? 1,
      });
    }
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Step 3: Run Louvain, group by community
// ---------------------------------------------------------------------------

function groupByCommunity(
  graph: InstanceType<typeof UndirectedGraph>,
): Map<number, string[]> {
  const mapping = runLouvain(graph, { resolution: 1.0 });

  const communities = new Map<number, string[]>();
  for (const [node, community] of Object.entries(mapping)) {
    let members = communities.get(community);
    if (!members) {
      members = [];
      communities.set(community, members);
    }
    members.push(node);
  }

  for (const [id, members] of communities) {
    if (members.length < MIN_COMMUNITY_SIZE) communities.delete(id);
  }

  return communities;
}

// ---------------------------------------------------------------------------
// Step 4: Name communities, build community flows
// ---------------------------------------------------------------------------

function buildCommunityFlows(
  communities: Map<number, string[]>,
  edges: GraphEdge[],
  fileIndex: Map<string, ParsedFile>,
): Flow[] {
  const usedNames = new Set<string>();
  const flows: Flow[] = [];

  for (const [, members] of communities) {
    const componentFiles = new Set(members);
    const edgeCount = countEdgesInComponent(edges, componentFiles);
    const primaryModel = findDominantModel(members, fileIndex);
    const name = deduplicateName(
      deriveCommunityName(members, fileIndex),
      usedNames,
      members,
    );
    const repos = collectRepos(members, fileIndex);

    flows.push({
      name,
      files: members.sort(),
      repos,
      primaryModel,
      edgeCount,
    });
  }

  return flows;
}

function isGenericName(name: string): boolean {
  const lower = name.toLowerCase();
  if (GENERIC_SEGMENT_NAMES.has(lower)) return true;
  // Also catch deduplicated generics like "common_2", "v2_3"
  const suffixMatch = lower.match(/^(.+?)_\d+$/);
  if (suffixMatch && GENERIC_SEGMENT_NAMES.has(suffixMatch[1]!)) return true;
  return false;
}

/**
 * Finds the first non-standard (non-CRUD) public action name in the community.
 * These are domain-specific actions like "batch", "export", "import", "approve".
 */
function findNonStandardAction(
  members: string[],
  fileIndex: Map<string, ParsedFile>,
): string | undefined {
  for (const filePath of members) {
    const pf = fileIndex.get(filePath);
    if (!pf) continue;
    for (const fn of pf.functions) {
      if (fn.visibility === "public" && !STANDARD_CRUD_ACTIONS.has(fn.name)) {
        return fn.name;
      }
    }
  }
  return undefined;
}

function deriveCommunityName(
  members: string[],
  fileIndex: Map<string, ParsedFile>,
): string {
  const model = findDominantModel(members, fileIndex);
  if (model) return pascalToSnake(model);

  const segmentName = dominantPathSegment(members);
  if (segmentName && !isGenericName(segmentName)) return segmentName;

  // segmentName is generic or absent — qualify with domain-specific signal
  const nonStandardAction = findNonStandardAction(members, fileIndex);
  if (nonStandardAction) return nonStandardAction;

  // Try any Ruby class name even without minimum association count
  for (const filePath of members) {
    const pf = fileIndex.get(filePath);
    if (pf?.language === "ruby" && pf.classes[0]?.name) {
      return pascalToSnake(pf.classes[0].name);
    }
  }

  // Fall back to the generic segment name or file basename as last resort
  if (segmentName) return segmentName;
  const fallback = members[0] ?? "unknown";
  const baseName = fallback.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  return baseName.replace(/-/g, "_");
}

function dominantPathSegment(members: string[]): string | undefined {
  const counts = new Map<string, number>();

  for (const filePath of members) {
    for (const pattern of PATH_SEGMENT_PATTERNS) {
      const match = filePath.match(pattern);
      if (match?.[1]) {
        const segment = match[1]
          .replace(/\.[^.]+$/, "")
          .replace(/-/g, "_")
          .replace(/_controller$/, "");
        counts.set(segment, (counts.get(segment) ?? 0) + 1);
      }
    }
  }

  if (counts.size === 0) return undefined;

  let best = "";
  let bestCount = 0;
  for (const [segment, count] of counts) {
    if (count > bestCount) {
      best = segment;
      bestCount = count;
    }
  }
  return best || undefined;
}

// ---------------------------------------------------------------------------
// Step 5: Hub flows
// ---------------------------------------------------------------------------

function buildHubFlows(
  hubs: Set<string>,
  edges: GraphEdge[],
  fileIndex: Map<string, ParsedFile>,
): Flow[] {
  const usedNames = new Set<string>();
  const flows: Flow[] = [];

  for (const hubFile of hubs) {
    const pf = fileIndex.get(hubFile);
    const baseName = hubFile.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
    const modelName = pf?.classes[0]?.name;
    const rawName = modelName
      ? pascalToSnake(modelName)
      : baseName.replace(/-/g, "_");
    const name = deduplicateName(rawName, usedNames, [hubFile]);

    const hubEdgeCount = edges.filter(
      (e) => e.sourceFile === hubFile || e.targetFile === hubFile,
    ).length;

    const repos = pf ? [pf.repo] : [];

    flows.push({
      name,
      files: [hubFile],
      repos,
      primaryModel: modelName,
      edgeCount: hubEdgeCount,
      isHub: true,
    });
  }

  return flows;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function countEdgesInComponent(
  edges: GraphEdge[],
  componentFiles: Set<string>,
): number {
  let count = 0;
  for (const e of edges) {
    if (componentFiles.has(e.sourceFile) && componentFiles.has(e.targetFile)) {
      count++;
    }
  }
  return count;
}

function findDominantModel(
  component: string[],
  fileIndex: Map<string, ParsedFile>,
): string | undefined {
  let best: ParsedFile | undefined;
  let maxAssociations = 0;

  for (const filePath of component) {
    const pf = fileIndex.get(filePath);
    if (!pf || pf.language !== "ruby" || pf.classes.length === 0) continue;
    if (pf.associations.length > maxAssociations) {
      maxAssociations = pf.associations.length;
      best = pf;
    }
  }

  return best?.classes[0]?.name;
}

function collectRepos(
  component: string[],
  fileIndex: Map<string, ParsedFile>,
): string[] {
  const repos = new Set<string>();
  for (const filePath of component) {
    const pf = fileIndex.get(filePath);
    if (pf) repos.add(pf.repo);
  }
  return [...repos].sort();
}

function indexByFilePath(
  parsedFiles: ParsedFile[],
): Map<string, ParsedFile> {
  const index = new Map<string, ParsedFile>();
  for (const pf of parsedFiles) {
    index.set(pf.path, pf);
  }
  return index;
}

function pascalToSnake(pascal: string): string {
  return pascal.replace(/[A-Z]/g, (char, index: number) =>
    (index > 0 ? "_" : "") + char.toLowerCase(),
  );
}

/**
 * Resolves name collisions between communities. Instead of the opaque `_2`,
 * `_3` numeric suffix, we try a set of semantic qualifiers in order:
 *   1. The repo name (e.g. `patient_bp_monitor`)
 *   2. A path-segment qualifier from the members (e.g. `patient_remote`)
 *   3. Numeric fallback only as last resort
 */
function deduplicateName(
  name: string,
  usedNames: Set<string>,
  members?: string[],
): string {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }

  // Try a qualifier from the path segments that differ from the base name
  if (members && members.length > 0) {
    const qualifiers = members
      .flatMap((p) => p.split("/"))
      .filter((seg) => seg && seg !== name && !/^\d+$/.test(seg) && seg.length > 2)
      .map((seg) => seg.replace(/\.[^.]+$/, "").replace(/-/g, "_").toLowerCase());

    for (const q of qualifiers) {
      const candidate = `${name}_${q}`;
      if (!usedNames.has(candidate)) {
        usedNames.add(candidate);
        return candidate;
      }
    }
  }

  // Numeric fallback
  let i = 2;
  while (usedNames.has(`${name}_${i}`)) i++;
  const unique = `${name}_${i}`;
  usedNames.add(unique);
  return unique;
}
