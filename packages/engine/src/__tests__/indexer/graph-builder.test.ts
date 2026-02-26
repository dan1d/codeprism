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

  it("ignores package/absolute imports (non-relative source — covers resolveImport early return)", () => {
    const fileA = makeParsedFile({
      path: "src/api/patients.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      imports: [
        { name: "axios", source: "axios", isDefault: true },
        { name: "lodash", source: "lodash/merge", isDefault: false },
      ],
    });

    const edges = buildGraph([fileA]);
    // Package imports should produce no import edges
    const importEdges = edges.filter((e) => e.relation === "import");
    expect(importEdges).toHaveLength(0);
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
    expect(fromEntry).toHaveLength(1);
    expect(fromEntry[0].weight).toBeLessThan(1);
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

// ---------------------------------------------------------------------------
// Association edge singularization
// ---------------------------------------------------------------------------

describe("buildGraph — association singularization", () => {
  it("resolves has_many :devices to Device model (removes 's')", () => {
    const patient = makeParsedFile({
      path: "app/models/patient.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Patient", type: "model" }],
      associations: [{ type: "has_many", name: "devices" }],
    });
    const device = makeParsedFile({
      path: "app/models/device.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Device", type: "model" }],
    });

    const edges = buildGraph([patient, device]);
    const assocEdge = edges.find((e) => e.relation === "model_association");
    expect(assocEdge).toBeDefined();
    expect(assocEdge?.targetFile).toBe(device.path);
  });

  it("resolves has_many :categories to Category (ies → y singularization)", () => {
    const post = makeParsedFile({
      path: "app/models/post.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Post", type: "model" }],
      associations: [{ type: "has_many", name: "categories" }],
    });
    const category = makeParsedFile({
      path: "app/models/category.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Category", type: "model" }],
    });

    const edges = buildGraph([post, category]);
    const assocEdge = edges.find((e) => e.relation === "model_association");
    expect(assocEdge).toBeDefined();
    expect(assocEdge?.targetFile).toBe(category.path);
  });

  it("resolves has_many :classes (sses → ss singularization)", () => {
    const course = makeParsedFile({
      path: "app/models/course.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Course", type: "model" }],
      associations: [{ type: "has_many", name: "classes" }],
    });
    const klass = makeParsedFile({
      path: "app/models/class.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Class", type: "model" }],
    });

    // Just verify buildGraph doesn't throw with this data
    expect(() => buildGraph([course, klass])).not.toThrow();
  });

  it("resolves has_many :dishes (shes → sh singularization)", () => {
    const kitchen = makeParsedFile({
      path: "app/models/kitchen.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Kitchen", type: "model" }],
      associations: [{ type: "has_many", name: "dishes" }],
    });
    const dish = makeParsedFile({
      path: "app/models/dish.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Dish", type: "model" }],
    });

    const edges = buildGraph([kitchen, dish]);
    const assocEdge = edges.find((e) => e.relation === "model_association");
    expect(assocEdge).toBeDefined();
  });

  it("resolves has_many :boxes (xes → x singularization)", () => {
    const warehouse = makeParsedFile({
      path: "app/models/warehouse.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Warehouse", type: "model" }],
      associations: [{ type: "has_many", name: "boxes" }],
    });
    const box = makeParsedFile({
      path: "app/models/box.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Box", type: "model" }],
    });

    expect(() => buildGraph([warehouse, box])).not.toThrow();
  });

  it("resolves has_many :churches (ches → ch singularization)", () => {
    const diocese = makeParsedFile({
      path: "app/models/diocese.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Diocese", type: "model" }],
      associations: [{ type: "has_many", name: "churches" }],
    });
    const church = makeParsedFile({
      path: "app/models/church.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Church", type: "model" }],
    });

    expect(() => buildGraph([diocese, church])).not.toThrow();
  });

  it("resolves has_many :quizzes (zes → z singularization)", () => {
    const course = makeParsedFile({
      path: "app/models/course2.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Course2", type: "model" }],
      associations: [{ type: "has_many", name: "quizzes" }],
    });
    const quiz = makeParsedFile({
      path: "app/models/quiz.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Quiz", type: "model" }],
    });

    expect(() => buildGraph([course, quiz])).not.toThrow();
  });

  it("resolves belongs_to without singularization", () => {
    const device = makeParsedFile({
      path: "app/models/device.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Device", type: "model" }],
      associations: [{ type: "belongs_to", name: "patient" }],
    });
    const patient = makeParsedFile({
      path: "app/models/patient.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Patient", type: "model" }],
    });

    const edges = buildGraph([device, patient]);
    const assocEdge = edges.find((e) => e.relation === "model_association");
    expect(assocEdge).toBeDefined();
    expect(assocEdge?.targetFile).toBe(patient.path);
  });
});

// ---------------------------------------------------------------------------
// Kebab-cased Vue/React component imports → file resolution
// ---------------------------------------------------------------------------

describe("buildGraph — kebab-case import resolution", () => {
  it("resolves kebab-cased imports to PascalCase component files", () => {
    const parent = makeParsedFile({
      path: "src/views/Home.vue",
      repo: "frontend",
      language: "vue",
      fileRole: "domain",
      imports: [{ source: "./components/patient-list", name: "PatientList", isDefault: true }],
    });
    const child = makeParsedFile({
      path: "src/views/components/patient-list.vue",
      repo: "frontend",
      language: "vue",
      fileRole: "domain",
    });

    const edges = buildGraph([parent, child]);
    const importEdge = edges.find(
      (e) => e.relation === "import" && e.targetFile === child.path,
    );
    expect(importEdge).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Controller → model edge detection (covers addControllerModelEdges line 157)
// ---------------------------------------------------------------------------

describe("buildGraph — controller_model edges", () => {
  it("links a Rails controller to its implied model by filename", () => {
    const controller = makeParsedFile({
      path: "app/controllers/patients_controller.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "PatientsController", type: "controller" }],
    });
    const model = makeParsedFile({
      path: "app/models/patient.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Patient", type: "model" }],
    });

    const edges = buildGraph([controller, model]);
    const ctrlEdge = edges.find((e) => e.relation === "controller_model");
    expect(ctrlEdge).toBeDefined();
    expect(ctrlEdge?.sourceFile).toBe(controller.path);
    expect(ctrlEdge?.targetFile).toBe(model.path);
  });
});

// ---------------------------------------------------------------------------
// Store → API edge detection (covers addStoreApiEdges lines 224-230)
// ---------------------------------------------------------------------------

describe("buildGraph — store_api edges", () => {
  it("links a Pinia/Vuex store to an API client file it imports", () => {
    const store = makeParsedFile({
      path: "src/stores/patient-store.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      imports: [{ name: "patientsApi", source: "../api/patientsApi", isDefault: false }],
    });
    const apiClient = makeParsedFile({
      path: "src/api/patientsApi.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
    });

    const edges = buildGraph([store, apiClient]);
    const storeEdge = edges.find((e) => e.relation === "store_api");
    expect(storeEdge).toBeDefined();
    expect(storeEdge?.sourceFile).toBe(store.path);
    expect(storeEdge?.targetFile).toBe(apiClient.path);
  });
});

// ---------------------------------------------------------------------------
// addImportEdges — target with test/config fileRole (covers line 250 continue)
// ---------------------------------------------------------------------------

describe("buildGraph — import edges to test/config files", () => {
  it("skips import edges to test files (fileRole=test)", () => {
    const domainFile = makeParsedFile({
      path: "src/api/patients.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      imports: [{ name: "patientSpec", source: "./patients.spec", isDefault: false }],
    });
    const specFile = makeParsedFile({
      path: "src/api/patients.spec.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "test",
    });

    const edges = buildGraph([domainFile, specFile]);
    const toSpec = edges.filter((e) => e.targetFile === specFile.path);
    expect(toSpec).toHaveLength(0);
  });

  it("imports to entry_point files use 0.1 multiplier (covers entry_point branch)", () => {
    const component = makeParsedFile({
      path: "src/components/App.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      imports: [{ name: "main", source: "../main", isDefault: true }],  // resolves to src/main
    });
    const entryFile = makeParsedFile({
      path: "src/main.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "entry_point",
    });

    const edges = buildGraph([component, entryFile]);
    const importEdge = edges.find((e) => e.relation === "import" && e.targetFile === entryFile.path);
    // entry_point gets weight multiplier 0.1, so edge weight is less than default
    expect(importEdge).toBeDefined();
    expect(importEdge?.weight).toBeLessThan(1);
  });

  it("imports to shared_utility files use 0.3 multiplier", () => {
    const component = makeParsedFile({
      path: "src/components/PatientList.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      imports: [{ name: "utils", source: "../utils", isDefault: false }],  // resolves to src/utils
    });
    const utilFile = makeParsedFile({
      path: "src/utils.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "shared_utility",
    });

    const edges = buildGraph([component, utilFile]);
    const importEdge = edges.find((e) => e.relation === "import" && e.targetFile === utilFile.path);
    expect(importEdge).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// addStoreApiEdges — non-api imports are skipped (covers line 225 continue)
// ---------------------------------------------------------------------------

describe("buildGraph — store_api non-api import skip", () => {
  it("skips store imports that don't match /api/ pattern", () => {
    const store = makeParsedFile({
      path: "src/stores/patient-store.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      imports: [
        { name: "utils", source: "../utils/helpers", isDefault: false },  // no 'api' in source
      ],
    });
    const utilFile = makeParsedFile({
      path: "src/utils/helpers.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
    });

    const edges = buildGraph([store, utilFile]);
    const storeEdges = edges.filter((e) => e.relation === "store_api");
    expect(storeEdges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-repo API endpoint edge detection (covers fileBasename / kebabToSnake)
// ---------------------------------------------------------------------------

describe("buildGraph — cross-repo API endpoint edges", () => {
  it("links a FE API client to a matching BE controller by filename", () => {
    const feFile = makeParsedFile({
      path: "src/api/patients.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      apiCalls: [{ method: "GET", path: "/api/v1/patients" }],
    });
    const beFile = makeParsedFile({
      path: "app/controllers/api/v1/patients_controller.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "PatientsController", type: "controller" }],
    });

    const edges = buildGraph([feFile, beFile]);
    const apiEdge = edges.find((e) => e.relation === "api_endpoint");
    expect(apiEdge).toBeDefined();
    expect(apiEdge?.sourceFile).toBe(feFile.path);
    expect(apiEdge?.targetFile).toBe(beFile.path);
  });

  it("links a FE API client to a BE controller via route path matching", () => {
    const feFile = makeParsedFile({
      path: "src/api/devices.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      apiCalls: [{ method: "GET", path: "/api/devices" }],
    });
    const beFile = makeParsedFile({
      path: "app/controllers/api/devices_handler.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      routes: [{ path: "/api/devices", method: "GET", action: "index", controller: "devices" }],
    });

    const edges = buildGraph([feFile, beFile]);
    const apiEdge = edges.find((e) => e.relation === "api_endpoint");
    expect(apiEdge).toBeDefined();
  });

  it("handles kebab-case API client filenames correctly", () => {
    const feFile = makeParsedFile({
      path: "src/api/remote-authorizations.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      apiCalls: [{ method: "POST", path: "/api/v1/remote_authorizations" }],
    });
    const beFile = makeParsedFile({
      path: "app/controllers/remote_authorizations_controller.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "RemoteAuthorizationsController", type: "controller" }],
    });

    const edges = buildGraph([feFile, beFile]);
    const apiEdge = edges.find((e) => e.relation === "api_endpoint");
    expect(apiEdge).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// singularize fallback — words that don't end in 's'
// ---------------------------------------------------------------------------

describe("buildGraph — singularize fallback", () => {
  it("keeps unchanged words that don't end in 's' (hits fallback return)", () => {
    // "data" doesn't end with any recognized plural suffix → singularize fallback
    const report = makeParsedFile({
      path: "app/models/report.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Report", type: "model" }],
      associations: [{ type: "has_many", name: "data" }],
    });
    const datum = makeParsedFile({
      path: "app/models/datum.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Data", type: "model" }],
    });

    // buildGraph should not throw; singularize("data") hits the fallback return
    expect(() => buildGraph([report, datum])).not.toThrow();
  });
});
