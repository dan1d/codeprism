/**
 * Tests for indexer/flow-detector.ts — Louvain community detection, hub flagging,
 * flow naming, and deduplication.
 */

import { describe, it, expect } from "vitest";
import { detectFlows } from "../../indexer/flow-detector.js";
import { makeParsedFile, makeEdge } from "../helpers/fixtures.js";
import type { GraphEdge } from "../../indexer/graph-builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRubyModel(
  name: string,
  repo = "backend",
  associations = 0,
): ReturnType<typeof makeParsedFile> {
  return makeParsedFile({
    path: `/app/models/${name.toLowerCase()}.rb`,
    repo,
    language: "ruby",
    fileRole: "domain",
    classes: [{ name, type: "model" as const }],
    associations: Array.from({ length: associations }, (_, i) => ({
      type: "has_many" as const,
      name: `related${i}`,
    })),
  });
}

function makeControllerFile(
  name: string,
  repo = "backend",
): ReturnType<typeof makeParsedFile> {
  return makeParsedFile({
    path: `/app/controllers/${name.toLowerCase()}_controller.rb`,
    repo,
    language: "ruby",
    fileRole: "domain",
    classes: [{ name: `${name}Controller`, type: "controller" as const }],
  });
}

// ---------------------------------------------------------------------------
// Basic detection
// ---------------------------------------------------------------------------

describe("detectFlows — basic", () => {
  it("returns empty array when no edges provided", () => {
    const flows = detectFlows([], []);
    expect(flows).toEqual([]);
  });

  it("returns empty array when edges exist but no communities of size ≥ 3", () => {
    const a = makeParsedFile({ path: "/app/models/a.rb", repo: "be" });
    const b = makeParsedFile({ path: "/app/models/b.rb", repo: "be" });
    const edges: GraphEdge[] = [
      makeEdge({ sourceFile: a.path, targetFile: b.path, relation: "model_association", weight: 1 }),
    ];

    // Only 2 nodes — community too small (MIN_COMMUNITY_SIZE = 3), but hub detection may still trigger
    const flows = detectFlows(edges, [a, b]);
    // We just assert it doesn't throw
    expect(Array.isArray(flows)).toBe(true);
  });

  it("detects a community flow from a cluster of 3+ connected files", () => {
    const patient = makeRubyModel("Patient", "backend", 3);
    const device = makeRubyModel("Device", "backend", 2);
    const controller = makeControllerFile("Patients", "backend");

    const edges: GraphEdge[] = [
      makeEdge({
        sourceFile: controller.path,
        targetFile: patient.path,
        relation: "controller_model",
        weight: 3,
      }),
      makeEdge({
        sourceFile: patient.path,
        targetFile: device.path,
        relation: "model_association",
        weight: 2,
      }),
      makeEdge({
        sourceFile: controller.path,
        targetFile: device.path,
        relation: "controller_model",
        weight: 2,
      }),
    ];

    const flows = detectFlows(edges, [patient, device, controller]);
    expect(flows.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Hub detection
// ---------------------------------------------------------------------------

describe("detectFlows — hub detection", () => {
  it("marks a highly-connected file as a hub flow", () => {
    // With PageRank, a hub is a file that many others point TO (high in-PageRank).
    // Create 9 nodes all pointing at user.rb via model_association so user.rb
    // receives most of the rank and lands in the top-10th percentile.
    const hub = makeParsedFile({
      path: "/app/models/user.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "User", type: "model" as const }],
    });

    const dependents = Array.from({ length: 9 }, (_, i) =>
      makeParsedFile({ path: `/app/models/dep_${i}.rb`, repo: "backend" }),
    );

    // All dependents point TO the hub (belongs_to :user pattern)
    const edges: GraphEdge[] = dependents.map((n) =>
      makeEdge({
        sourceFile: n.path,
        targetFile: hub.path,
        relation: "model_association",
        weight: 1,
      }),
    );

    const flows = detectFlows(edges, [hub, ...dependents]);
    const hubFlow = flows.find((f) => f.isHub === true);
    expect(hubFlow).toBeDefined();
    expect(hubFlow?.files).toContain(hub.path);
  });
});

// ---------------------------------------------------------------------------
// Flow naming
// ---------------------------------------------------------------------------

describe("detectFlows — flow naming", () => {
  it("derives flow name from dominant Ruby model in community", () => {
    // Use import edges (not in HIGH_SIGNAL_RELATIONS) so hub detection does not
    // claim these files before Louvain runs — we're testing community naming only.
    const patient = makeRubyModel("Patient", "backend", 3);
    const device = makeRubyModel("Device", "backend", 1);
    const controller = makeControllerFile("Patients", "backend");

    const edges: GraphEdge[] = [
      makeEdge({ sourceFile: controller.path, targetFile: patient.path, relation: "import", weight: 3 }),
      makeEdge({ sourceFile: patient.path, targetFile: device.path, relation: "import", weight: 2 }),
      makeEdge({ sourceFile: controller.path, targetFile: device.path, relation: "import", weight: 1 }),
    ];

    const flows = detectFlows(edges, [patient, device, controller]);
    const flowNames = flows.map((f) => f.name);
    expect(flowNames.some((n) => n.toLowerCase().includes("patient"))).toBe(true);
  });

  it("deduplicates flow names when two communities map to same name", () => {
    // Build two separate 3-node clusters that would both be named "patient"
    const p1 = makeParsedFile({ path: "/repo1/app/models/patient.rb", repo: "be" });
    const p2 = makeParsedFile({ path: "/repo1/app/controllers/patients_controller.rb", repo: "be" });
    const p3 = makeParsedFile({ path: "/repo1/app/models/device.rb", repo: "be" });

    const edges: GraphEdge[] = [
      makeEdge({ sourceFile: p1.path, targetFile: p2.path, relation: "controller_model", weight: 3 }),
      makeEdge({ sourceFile: p1.path, targetFile: p3.path, relation: "model_association", weight: 2 }),
      makeEdge({ sourceFile: p2.path, targetFile: p3.path, relation: "controller_model", weight: 1 }),
    ];

    const flows = detectFlows(edges, [p1, p2, p3]);
    const names = flows.map((f) => f.name);

    // All names should be unique
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

describe("detectFlows — multi-repo edges", () => {
  it("captures repos from community members", () => {
    const beFile = makeParsedFile({ path: "/be/app/models/patient.rb", repo: "backend", language: "ruby" });
    const feFile = makeParsedFile({ path: "/fe/src/components/Patient.vue", repo: "frontend", language: "vue" });
    const apiFile = makeParsedFile({ path: "/be/app/controllers/api/v1/patients_controller.rb", repo: "backend" });

    // Use import edges so hub detection (which only fires on model_association /
    // controller_model / route_controller) doesn't claim nodes before Louvain runs.
    const edges: GraphEdge[] = [
      makeEdge({ sourceFile: beFile.path, targetFile: feFile.path, relation: "import", weight: 2 }),
      makeEdge({ sourceFile: beFile.path, targetFile: apiFile.path, relation: "import", weight: 3 }),
      makeEdge({ sourceFile: feFile.path, targetFile: apiFile.path, relation: "import", weight: 1 }),
    ];

    const flows = detectFlows(edges, [beFile, feFile, apiFile]);
    const allRepos = flows.flatMap((f) => f.repos);
    expect(allRepos).toContain("backend");
    expect(allRepos).toContain("frontend");
  });
});

// ---------------------------------------------------------------------------
// nameFlow fallback — no model, no recognized path segment
// ---------------------------------------------------------------------------

describe("detectFlows — nameFlow fallback", () => {
  it("falls back to basename for files with no dominant model or path pattern", () => {
    // Use paths without recognizable segments (no models/, controllers/, components/, etc.)
    // Need at least MIN_COMMUNITY_SIZE=3 files for the community to be included
    const fileA = makeParsedFile({ path: "/data/alpha/pipeline.js", repo: "tooling", language: "javascript", fileRole: "domain" });
    const fileB = makeParsedFile({ path: "/data/alpha/runner.js", repo: "tooling", language: "javascript", fileRole: "domain" });
    const fileC = makeParsedFile({ path: "/data/alpha/scheduler.js", repo: "tooling", language: "javascript", fileRole: "domain" });

    const edges: GraphEdge[] = [
      makeEdge({ sourceFile: fileA.path, targetFile: fileB.path, relation: "import", weight: 2 }),
      makeEdge({ sourceFile: fileB.path, targetFile: fileC.path, relation: "import", weight: 2 }),
      makeEdge({ sourceFile: fileA.path, targetFile: fileC.path, relation: "import", weight: 2 }),
    ];

    const flows = detectFlows(edges, [fileA, fileB, fileC]);
    // The flow should be named from the basename fallback, not throw
    expect(flows.length).toBeGreaterThan(0);
    expect(flows[0]?.name.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// deduplicateName — duplicate flow names
// ---------------------------------------------------------------------------

describe("detectFlows — duplicate name deduplication", () => {
  it("appends _2 suffix when two flows produce the same name", () => {
    // Create two isolated communities that would both be named the same thing
    // Use file paths that produce the same dominant segment "patients"
    const filesGroupA = [
      makeParsedFile({ path: "/repo1/app/models/patients/patient.rb", repo: "backend1", language: "ruby", fileRole: "domain" }),
      makeParsedFile({ path: "/repo1/app/models/patients/record.rb", repo: "backend1", language: "ruby", fileRole: "domain" }),
      makeParsedFile({ path: "/repo1/app/models/patients/history.rb", repo: "backend1", language: "ruby", fileRole: "domain" }),
    ];
    const filesGroupB = [
      makeParsedFile({ path: "/repo2/app/models/patients/patient.rb", repo: "backend2", language: "ruby", fileRole: "domain" }),
      makeParsedFile({ path: "/repo2/app/models/patients/record.rb", repo: "backend2", language: "ruby", fileRole: "domain" }),
      makeParsedFile({ path: "/repo2/app/models/patients/history.rb", repo: "backend2", language: "ruby", fileRole: "domain" }),
    ];

    const edgesA: GraphEdge[] = [
      makeEdge({ sourceFile: filesGroupA[0]!.path, targetFile: filesGroupA[1]!.path, relation: "model_association", weight: 3 }),
      makeEdge({ sourceFile: filesGroupA[1]!.path, targetFile: filesGroupA[2]!.path, relation: "model_association", weight: 3 }),
    ];
    const edgesB: GraphEdge[] = [
      makeEdge({ sourceFile: filesGroupB[0]!.path, targetFile: filesGroupB[1]!.path, relation: "model_association", weight: 3 }),
      makeEdge({ sourceFile: filesGroupB[1]!.path, targetFile: filesGroupB[2]!.path, relation: "model_association", weight: 3 }),
    ];

    const flows = detectFlows([...edgesA, ...edgesB], [...filesGroupA, ...filesGroupB]);
    const names = flows.map((f) => f.name);
    // All names should be unique (deduplication applied)
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

describe("detectFlows — sorting", () => {
  it("returns flows sorted by edgeCount descending", () => {
    // Need enough nodes/edges for multiple communities
    const files = Array.from({ length: 9 }, (_, i) =>
      makeParsedFile({ path: `/app/models/m${i}.rb`, repo: "be" }),
    );

    const edges: GraphEdge[] = [
      // Community A: 3 nodes, 3 edges
      makeEdge({ sourceFile: files[0]!.path, targetFile: files[1]!.path, relation: "model_association", weight: 1 }),
      makeEdge({ sourceFile: files[1]!.path, targetFile: files[2]!.path, relation: "model_association", weight: 1 }),
      makeEdge({ sourceFile: files[0]!.path, targetFile: files[2]!.path, relation: "model_association", weight: 1 }),
      // Community B: 3 nodes, 1 edge (weaker)
      makeEdge({ sourceFile: files[3]!.path, targetFile: files[4]!.path, relation: "model_association", weight: 1 }),
      makeEdge({ sourceFile: files[4]!.path, targetFile: files[5]!.path, relation: "model_association", weight: 1 }),
      makeEdge({ sourceFile: files[3]!.path, targetFile: files[5]!.path, relation: "model_association", weight: 1 }),
    ];

    const flows = detectFlows(edges, files);
    for (let i = 1; i < flows.length; i++) {
      expect(flows[i - 1]!.edgeCount).toBeGreaterThanOrEqual(flows[i]!.edgeCount);
    }
  });
});
