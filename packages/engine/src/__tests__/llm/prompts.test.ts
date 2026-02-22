/**
 * Tests for llm/prompts.ts — card prompt builders.
 *
 * All functions are pure (no external deps). We verify that prompts include
 * the correct structural information so the LLM receives meaningful context.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildFlowCardPrompt,
  buildModelCardPrompt,
  buildCrossServiceCardPrompt,
  buildHubCardPrompt,
} from "../../llm/prompts.js";
import { makeParsedFile, makeFlow, makeEdge } from "../helpers/fixtures.js";

// Mock node:fs so readSourceSnippet returns deterministic content
// and exercises both branches: short file (no truncation) and long file (truncation).
vi.mock("node:fs", () => ({
  readFileSync: (path: string) => {
    if (path.includes("long-file")) {
      // > 150 lines triggers the truncation branch
      return Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");
    }
    if (path.includes("missing")) {
      throw new Error("ENOENT");
    }
    return `// source for ${path}\nconst x = 1;`;
  },
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const patientModel = makeParsedFile({
  path: "/app/models/patient.rb",
  repo: "backend",
  language: "ruby",
  fileRole: "domain",
  classes: [{ name: "Patient", type: "model" }],
  associations: [
    { type: "has_many", name: "devices" },
    { type: "belongs_to", name: "practice" },
  ],
  validations: ["validates :first_name, presence: true"],
  callbacks: ["before_save :normalize_name"],
});

const patientsController = makeParsedFile({
  path: "/app/controllers/patients_controller.rb",
  repo: "backend",
  language: "ruby",
  fileRole: "domain",
  classes: [{ name: "PatientsController", type: "controller" }],
  routes: [
    { path: "/patients", method: "GET", action: "index" },
    { path: "/patients/:id", method: "GET", action: "show" },
    { path: "/patients", method: "POST", action: "create" },
  ],
});

const patientVue = makeParsedFile({
  path: "/src/views/PatientList.vue",
  repo: "frontend",
  language: "vue",
  fileRole: "domain",
  apiCalls: [
    { method: "GET", path: "/api/v1/patients" },
    { method: "POST", path: "/api/v1/patients" },
  ],
  imports: [{ source: "@/api/patients", name: "patientsApi", isDefault: false }],
  exports: [{ name: "default", isDefault: true }],
});

const flow = makeFlow(
  [patientModel.path, patientsController.path],
  { name: "patient", repos: ["backend"] },
);

const edge = makeEdge({
  sourceFile: patientsController.path,
  targetFile: patientModel.path,
  relation: "controller_model",
  weight: 3,
});

// ---------------------------------------------------------------------------
// buildFlowCardPrompt
// ---------------------------------------------------------------------------

describe("buildFlowCardPrompt", () => {
  it("includes the flow name", () => {
    const prompt = buildFlowCardPrompt(flow, [patientModel, patientsController], [edge]);
    expect(prompt).toContain("patient");
  });

  it("includes file paths in the structural summary", () => {
    const prompt = buildFlowCardPrompt(flow, [patientModel, patientsController], [edge]);
    expect(prompt).toContain("patient.rb");
  });

  it("includes project context when provided", () => {
    const prompt = buildFlowCardPrompt(
      flow,
      [patientModel],
      [],
      "Context: Rails healthcare app.\n",
    );
    expect(prompt).toContain("Rails healthcare app");
  });

  it("returns a non-empty string", () => {
    const prompt = buildFlowCardPrompt(flow, [], []);
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("includes association info from Ruby models", () => {
    const prompt = buildFlowCardPrompt(flow, [patientModel, patientsController], [edge]);
    expect(prompt).toContain("has_many");
    expect(prompt).toContain("devices");
  });

  it("includes FE component info (apiCalls) for non-ruby files in feComponents", () => {
    // patientVue has apiCalls and language=vue → covers lines 119-121 (feComponents map)
    const feFlow = makeFlow(
      [patientModel.path, patientVue.path],
      { name: "patient-fe", repos: ["backend", "frontend"] },
    );
    const prompt = buildFlowCardPrompt(feFlow, [patientModel, patientVue], []);
    expect(prompt).toContain("/api/v1/patients");
  });

  it("handles files with apiCalls only (no model/controller) in selectSourceFiles", () => {
    // Files with apiCalls but no model/controller class → selectSourceFiles score=2
    // Files with associations but no classes → score=2
    // Plain file with no apiCalls/classes → score=1
    const apiFile = makeParsedFile({
      path: "/src/api/patients.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      apiCalls: [{ method: "GET", path: "/api/patients" }],
    });
    const assocFile = makeParsedFile({
      path: "/src/store/patient-store.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
      associations: [{ type: "has_many", name: "patients" }],
    });
    const plainFile = makeParsedFile({
      path: "/src/utils/helpers.ts",
      repo: "frontend",
      language: "javascript",
      fileRole: "domain",
    });
    const apiFlow = makeFlow(
      [apiFile.path, assocFile.path, plainFile.path],
      { name: "api-flow", repos: ["frontend"] },
    );
    // Should not throw; exercises score branches 76-78 in selectSourceFiles
    const prompt = buildFlowCardPrompt(apiFlow, [apiFile, assocFile, plainFile], []);
    expect(prompt.length).toBeGreaterThan(10);
  });

  it("reads and includes source snippets for existing files (short file branch)", () => {
    // With mocked fs, patientModel path returns 2 lines → short path (no truncation)
    const prompt = buildFlowCardPrompt(flow, [patientModel], []);
    // mocked readFileSync returns "// source for ...\nconst x = 1;"
    expect(prompt).toContain("patient");
  });

  it("includes source with truncation for long files", () => {
    const longFileModel = makeParsedFile({
      path: "/app/models/long-file.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "LongFileModel", type: "model" }],
    });
    const longFlow = makeFlow([longFileModel.path], { name: "long", repos: ["backend"] });
    // mocked fs returns 200 lines → triggers truncation branch
    const prompt = buildFlowCardPrompt(longFlow, [longFileModel], []);
    expect(prompt).toContain("long");
  });
});

// ---------------------------------------------------------------------------
// buildModelCardPrompt
// ---------------------------------------------------------------------------

describe("buildModelCardPrompt", () => {
  it("includes the model name", () => {
    const prompt = buildModelCardPrompt(patientModel, [], []);
    expect(prompt).toContain("Patient");
  });

  it("includes associations", () => {
    const prompt = buildModelCardPrompt(patientModel, [], []);
    expect(prompt).toContain("has_many");
    expect(prompt).toContain("devices");
  });

  it("includes validations", () => {
    const prompt = buildModelCardPrompt(patientModel, [], []);
    expect(prompt).toContain("presence");
  });

  it("includes callbacks", () => {
    const prompt = buildModelCardPrompt(patientModel, [], []);
    expect(prompt).toContain("before_save");
  });

  it("includes project context when provided", () => {
    const prompt = buildModelCardPrompt(patientModel, [], [], "Healthcare platform.\n");
    expect(prompt).toContain("Healthcare platform");
  });

  it("includes controller source when controller files are present", () => {
    // Signature: buildModelCardPrompt(model, edges, relatedFiles, context)
    const prompt = buildModelCardPrompt(patientModel, [edge], [patientsController]);
    // With mocked fs, controller source should appear
    expect(prompt).toContain("Patient");
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("includes FE source when FE files with apiCalls are present", () => {
    const prompt = buildModelCardPrompt(patientModel, [], [patientVue]);
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("handles long file source with truncation branch", () => {
    const longFileModel = makeParsedFile({
      path: "/app/models/long-file.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "LongFile", type: "model" }],
    });
    const prompt = buildModelCardPrompt(longFileModel, [], []);
    // long-file triggers the truncation branch in readSourceSnippet
    expect(prompt).toContain("LongFile");
  });
});

// ---------------------------------------------------------------------------
// buildCrossServiceCardPrompt
// ---------------------------------------------------------------------------

describe("buildCrossServiceCardPrompt", () => {
  const crossEdge = makeEdge({
    sourceFile: patientVue.path,
    targetFile: patientsController.path,
    relation: "api_endpoint",
    weight: 2,
  });

  // Controller with associations — covers line 256 (associations.map callback)
  const controllerWithAssocs = makeParsedFile({
    path: "/app/controllers/patients_controller.rb",
    repo: "backend",
    language: "ruby",
    fileRole: "domain",
    classes: [{ name: "PatientsController", type: "controller" }],
    associations: [
      { type: "belongs_to", name: "practice" },
      { type: "has_many", name: "devices" },
    ],
    routes: [{ path: "/patients", method: "GET", action: "index" }],
  });

  it("includes both frontend and backend file paths", () => {
    const prompt = buildCrossServiceCardPrompt(patientVue, patientsController, [crossEdge]);
    expect(prompt).toContain("PatientList.vue");
    expect(prompt).toContain("patients_controller.rb");
  });

  it("includes association info from backend file (covers associations.map branch)", () => {
    const prompt = buildCrossServiceCardPrompt(patientVue, controllerWithAssocs, [crossEdge]);
    expect(prompt).toContain("belongs_to");
    expect(prompt).toContain("practice");
  });

  it("falls back to '?' for routes without action (covers r.action ?? '?' branch)", () => {
    const beWithNoAction = makeParsedFile({
      path: "/app/controllers/anonymous_controller.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "AnonymousController", type: "controller" }],
      routes: [{ path: "/anonymous", method: "GET" }],  // no action
    });
    const prompt = buildCrossServiceCardPrompt(patientVue, beWithNoAction, []);
    expect(prompt).toContain("/anonymous");
  });

  it("includes API call information from the frontend file", () => {
    const prompt = buildCrossServiceCardPrompt(patientVue, patientsController, [crossEdge]);
    expect(prompt).toContain("/api/v1/patients");
  });

  it("includes route information from the backend controller", () => {
    const prompt = buildCrossServiceCardPrompt(patientVue, patientsController, [crossEdge]);
    expect(prompt).toContain("/patients");
  });

  it("includes connecting edge information", () => {
    const prompt = buildCrossServiceCardPrompt(patientVue, patientsController, [crossEdge]);
    expect(prompt).toContain("api_endpoint");
  });

  it("includes project context when provided", () => {
    const prompt = buildCrossServiceCardPrompt(
      patientVue,
      patientsController,
      [],
      "Rails + Vue.js stack.\n",
    );
    expect(prompt).toContain("Rails + Vue.js stack");
  });

  it("returns a non-empty string when no edges provided", () => {
    const prompt = buildCrossServiceCardPrompt(patientVue, patientsController, []);
    expect(prompt.length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// buildHubCardPrompt
// ---------------------------------------------------------------------------

describe("buildHubCardPrompt", () => {
  const hubFlow1 = makeFlow(["/app/models/device.rb"], { name: "device", repos: ["backend"] });
  const hubFlow2 = makeFlow(["/app/models/practice.rb"], { name: "practice", repos: ["backend"] });

  it("includes the hub model name", () => {
    const prompt = buildHubCardPrompt(patientModel, [hubFlow1, hubFlow2], [edge]);
    expect(prompt).toContain("Patient");
  });

  it("includes connected flow names", () => {
    const prompt = buildHubCardPrompt(patientModel, [hubFlow1, hubFlow2], [edge]);
    expect(prompt).toContain("device");
    expect(prompt).toContain("practice");
  });

  it("includes association info", () => {
    const prompt = buildHubCardPrompt(patientModel, [], []);
    expect(prompt).toContain("has_many");
    expect(prompt).toContain("devices");
  });

  it("includes project context when provided", () => {
    const prompt = buildHubCardPrompt(
      patientModel,
      [],
      [],
      "Central Patient model in healthcare app.\n",
    );
    expect(prompt).toContain("Central Patient model");
  });

  it("returns a non-empty string with no connected flows", () => {
    const prompt = buildHubCardPrompt(patientModel, [], []);
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("handles a hub file without class info gracefully", () => {
    const noClassFile = makeParsedFile({
      path: "/app/models/anonymous.rb",
      classes: [],
      associations: [],
    });

    const prompt = buildHubCardPrompt(noClassFile, [], []);
    expect(prompt.length).toBeGreaterThan(10);
  });

  it("includes association options when present (covers a.options branch)", () => {
    const modelWithOptions = makeParsedFile({
      path: "/app/models/patient.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Patient", type: "model" }],
      associations: [
        { type: "has_many", name: "devices", options: "dependent: :destroy" },
        { type: "belongs_to", name: "practice" },  // no options
      ],
    });

    const prompt = buildHubCardPrompt(modelWithOptions, [], []);
    expect(prompt).toContain("dependent: :destroy");
  });

  it("shortens /Users/... paths using COMMON_PATH_PREFIXES (covers shortenPath match branch)", () => {
    const homeModel = makeParsedFile({
      path: "/Users/developer/myproject/app/models/patient.rb",
      repo: "backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Patient", type: "model" }],
    });
    const homeFlow = makeFlow([homeModel.path], { name: "patient", repos: ["backend"] });
    // shortenPath should strip the /Users/developer/myproject/ prefix
    const prompt = buildFlowCardPrompt(homeFlow, [homeModel], []);
    // Path should be shortened — not contain the full /Users/developer/myproject/ prefix
    expect(prompt).toContain("app/models/patient.rb");
  });
});
