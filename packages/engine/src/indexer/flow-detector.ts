import { UndirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import type { GraphEdge } from "./graph-builder.js";
import type { ParsedFile } from "./tree-sitter.js";

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

const PATH_SEGMENT_PATTERNS = [
  /\/api\/([^/]+)/,
  /\/controllers\/([^/]+)/,
  /\/models\/([^/]+)/,
  /\/components\/([^/]+)/,
  /\/stores\/([^/]+)/,
  /\/slices\/([^/]+)/,
];

/**
 * Groups connected files into business-level "flows" using Louvain
 * community detection with hub removal for better cluster separation.
 */
export function detectFlows(
  edges: GraphEdge[],
  parsedFiles: ParsedFile[],
): Flow[] {
  const fileIndex = indexByFilePath(parsedFiles);

  const hubs = detectHubs(edges);
  const graph = buildLouvainGraph(edges, hubs);

  const communities =
    graph.order > 0
      ? groupByCommunity(graph)
      : new Map<number, string[]>();

  const communityFlows = buildCommunityFlows(communities, edges, fileIndex);
  const hubFlows = buildHubFlows(hubs, edges, fileIndex);

  const flows = [...communityFlows, ...hubFlows];
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
  hubs: Set<string>,
): InstanceType<typeof UndirectedGraph> {
  const graph = new UndirectedGraph();

  for (const edge of edges) {
    if (hubs.has(edge.sourceFile) || hubs.has(edge.targetFile)) continue;

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

function deriveCommunityName(
  members: string[],
  fileIndex: Map<string, ParsedFile>,
): string {
  const model = findDominantModel(members, fileIndex);
  if (model) return pascalToSnake(model);

  const segmentName = dominantPathSegment(members);
  if (segmentName) return segmentName;

  const fallback = members[0] ?? "unknown";
  const basename = fallback.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  return basename.replace(/-/g, "_");
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
    const name = deduplicateName(rawName, usedNames);

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

function deduplicateName(name: string, usedNames: Set<string>): string {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }
  let i = 2;
  while (usedNames.has(`${name}_${i}`)) i++;
  const unique = `${name}_${i}`;
  usedNames.add(unique);
  return unique;
}
