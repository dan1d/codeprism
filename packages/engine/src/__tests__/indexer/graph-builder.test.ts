/**
 * Tests for indexer/graph-builder.ts — edge detection and file role weighting.
 *
 * All pure: no DB, no native modules, no network.
 */

import { describe, it, expect } from "vitest";
import { buildGraph } from "../../indexer/graph-builder.js";
import { makeParsedFile } from "../helpers/fixtures.js";

// ---------------------------------------------------------------------------
// Import edges
// ---------------------------------------------------------------------------

describe("buildGraph — import edges", () => {
  it("creates an import edge between two files where one imports the other", () => {
    const fileA = makeParsedFile({
      path: "src/components/PatientList.tsx",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      imports: [{ name: "patientApi", source: "../api/patient-api", isDefault: true }],
    });
    const fileB = makeParsedFile({
      path: "src/api/patient-api.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      imports: [],
    });

    const edges = buildGraph([fileA, fileB]);
    const importEdge = edges.find(
      (e) => e.relation === "import" && e.sourceFile === fileA.path && e.targetFile === fileB.path,
    );
    expect(importEdge).toBeDefined();
  });

  it("does not create import edges for cross-repo relative imports", () => {
    const fileA = makeParsedFile({
      path: "src/components/List.tsx",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      imports: [{ name: "something", source: "./something", isDefault: true }],
    });
    const fileB = makeParsedFile({
      path: "src/something.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      imports: [],
    });

    const edges = buildGraph([fileA, fileB]);
    const crossRepoImport = edges.find(
      (e) => e.relation === "import" && e.targetFile === fileB.path,
    );
    expect(crossRepoImport).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// File role: test files produce zero-weight edges (excluded)
// ---------------------------------------------------------------------------

describe("buildGraph — test file exclusion", () => {
  it("test files produce no edges", () => {
    const testFile = makeParsedFile({
      path: "spec/models/patient_spec.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "test",
      imports: [{ name: "patient", source: "./patient", isDefault: true }],
    });
    const domainFile = makeParsedFile({
      path: "app/models/patient.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      imports: [],
    });

    const edges = buildGraph([testFile, domainFile]);
    const fromTest = edges.filter((e) => e.sourceFile === testFile.path);
    expect(fromTest).toHaveLength(0);
  });

  it("config files produce no edges", () => {
    const configFile = makeParsedFile({
      path: "config/initializers/sentry.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "config",
      imports: [{ name: "patient", source: "./patient", isDefault: true }],
    });
    const domainFile = makeParsedFile({
      path: "app/models/patient.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      imports: [],
    });

    const edges = buildGraph([configFile, domainFile]);
    const fromConfig = edges.filter((e) => e.sourceFile === configFile.path);
    expect(fromConfig).toHaveLength(0);
  });

  it("entry_point files produce no edges", () => {
    const entryFile = makeParsedFile({
      path: "src/index.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "entry_point",
      imports: [{ name: "patientList", source: "./patient-list", isDefault: true }],
    });
    const domainFile = makeParsedFile({
      path: "src/patient-list.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      imports: [],
    });

    const edges = buildGraph([entryFile, domainFile]);
    const fromEntry = edges.filter((e) => e.sourceFile === entryFile.path);
    expect(fromEntry).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Model association edges
// ---------------------------------------------------------------------------

describe("buildGraph — model association edges", () => {
  it("creates a model_association edge between associated models", () => {
    const patientFile = makeParsedFile({
      path: "app/models/patient.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Patient", type: "model" }],
      associations: [
        { type: "has_many", name: "devices", target_model: "Device", options: undefined },
      ],
    });
    const deviceFile = makeParsedFile({
      path: "app/models/device.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Device", type: "model" }],
      associations: [],
    });

    const edges = buildGraph([patientFile, deviceFile]);
    const assocEdge = edges.find(
      (e) =>
        e.relation === "model_association" &&
        e.sourceFile === patientFile.path &&
        e.targetFile === deviceFile.path,
    );
    expect(assocEdge).toBeDefined();
    expect(assocEdge?.weight).toBeGreaterThan(0);
  });

  it("shared_utility association edges have reduced weight", () => {
    const sharedFile = makeParsedFile({
      path: "app/concerns/commentable.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "shared_utility",
      classes: [{ name: "Commentable", type: "model" }],
      associations: [
        { type: "belongs_to", name: "patient", target_model: "Patient", options: undefined },
      ],
    });
    const patientFile = makeParsedFile({
      path: "app/models/patient.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Patient", type: "model" }],
      associations: [],
    });
    const regularPatient = makeParsedFile({
      path: "app/models/appointment.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Appointment", type: "model" }],
      associations: [
        { type: "belongs_to", name: "patient", target_model: "Patient", options: undefined },
      ],
    });

    const edges = buildGraph([sharedFile, patientFile, regularPatient]);

    const sharedEdge = edges.find(
      (e) => e.relation === "model_association" && e.sourceFile === sharedFile.path,
    );
    const domainEdge = edges.find(
      (e) => e.relation === "model_association" && e.sourceFile === regularPatient.path,
    );

    // Both exist, but shared_utility has lower weight
    expect(sharedEdge).toBeDefined();
    expect(domainEdge).toBeDefined();
    expect(sharedEdge!.weight!).toBeLessThan(domainEdge!.weight!);
  });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe("buildGraph — edge deduplication", () => {
  it("does not produce duplicate edges for the same relationship", () => {
    const fileA = makeParsedFile({
      path: "src/a.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      imports: [{ name: "b", source: "./b", isDefault: true }],
    });
    const fileB = makeParsedFile({
      path: "src/b.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      imports: [],
    });

    const edges = buildGraph([fileA, fileB]);
    const importEdges = edges.filter(
      (e) => e.sourceFile === fileA.path && e.targetFile === fileB.path && e.relation === "import",
    );
    expect(importEdges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Route → controller edges
// ---------------------------------------------------------------------------

describe("buildGraph — route_controller edges", () => {
  it("creates a route_controller edge when a route file references a controller", () => {
    const routesFile = makeParsedFile({
      path: "config/routes.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      routes: [{ method: "GET", path: "/patients", controller: "patients", action: "index" }],
    });
    const controllerFile = makeParsedFile({
      path: "app/controllers/patients_controller.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "PatientsController", type: "controller" }],
    });

    const edges = buildGraph([routesFile, controllerFile]);
    const routeEdge = edges.find((e) => e.relation === "route_controller");
    expect(routeEdge).toBeDefined();
    expect(routeEdge?.sourceFile).toBe(routesFile.path);
    expect(routeEdge?.targetFile).toBe(controllerFile.path);
  });
});
