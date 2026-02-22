/**
 * Tests for indexer/card-generator.ts — card generation with mock LLM.
 *
 * We test:
 *  - generateCards() returns correct card types
 *  - Falls back to structural markdown when LLM throws
 *  - computeTags() returns correct facet tags
 *  - isDomainRelevant() filters by file role correctly
 *  - Entry-point files excluded from card sourceFiles
 */

import { describe, it, expect } from "vitest";
import {
  generateCards,
  isDomainRelevant,
  computeTags,
} from "../../indexer/card-generator.js";
import { makeParsedFile, makeFlow, makeEdge, mockLlm, failingLlm } from "../helpers/fixtures.js";

// ---------------------------------------------------------------------------
// isDomainRelevant — pure, no deps
// ---------------------------------------------------------------------------

describe("isDomainRelevant", () => {
  it("returns true for domain files", () => {
    expect(isDomainRelevant("domain")).toBe(true);
  });

  it("returns true for shared_utility files", () => {
    expect(isDomainRelevant("shared_utility")).toBe(true);
  });

  it("returns false for test files", () => {
    expect(isDomainRelevant("test")).toBe(false);
  });

  it("returns false for config files", () => {
    expect(isDomainRelevant("config")).toBe(false);
  });

  it("returns false for entry_point files", () => {
    expect(isDomainRelevant("entry_point")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeTags — pure, no deps
// ---------------------------------------------------------------------------

describe("computeTags", () => {
  it("tags frontend repos as 'frontend'", () => {
    const files = [makeParsedFile({ language: "javascript" })];
    const tags = computeTags(files, ["biobridge-frontend"]);
    expect(tags).toContain("frontend");
  });

  it("tags backend repos as 'backend'", () => {
    const files = [makeParsedFile({ language: "ruby" })];
    const tags = computeTags(files, ["biobridge-backend"]);
    expect(tags).toContain("backend");
  });

  it("includes language tags", () => {
    const files = [makeParsedFile({ language: "ruby" })];
    const tags = computeTags(files, ["test-repo"]);
    expect(tags).toContain("ruby");
  });

  it("tags shared_utility files with 'shared_utility'", () => {
    const files = [makeParsedFile({ fileRole: "shared_utility", language: "ruby" })];
    const tags = computeTags(files, ["test-repo"]);
    expect(tags).toContain("shared_utility");
  });

  it("includes model category for ruby model files", () => {
    const files = [
      makeParsedFile({
        path: "/repo/app/models/patient.rb",
        language: "ruby",
        associations: [
          { type: "has_many", name: "devices", target_model: "Device", options: undefined },
        ],
      }),
    ];
    const tags = computeTags(files, ["test-repo"]);
    expect(tags).toContain("model");
  });

  it("includes component category for component files", () => {
    const files = [
      makeParsedFile({
        path: "/repo/src/components/PatientList.tsx",
        language: "javascript",
      }),
    ];
    const tags = computeTags(files, ["test-repo"]);
    expect(tags).toContain("component");
  });

  it("deduplicates tags across multiple files", () => {
    const files = [
      makeParsedFile({ language: "ruby" }),
      makeParsedFile({ language: "ruby" }),
    ];
    const tags = computeTags(files, ["test-repo"]);
    expect(tags.filter((t) => t === "ruby").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// generateCards — with mock LLM (runs full pipeline)
// ---------------------------------------------------------------------------

const patientModel = makeParsedFile({
  path: "/repo/app/models/patient.rb",
  repo: "biobridge-backend",
  language: "ruby",
  fileRole: "domain",
  classes: [{ name: "Patient", type: "model" }],
  associations: [
    { type: "has_many", name: "devices", target_model: "Device", options: undefined },
    { type: "has_many", name: "cycles", target_model: "Cycle", options: undefined },
    { type: "belongs_to", name: "practice", target_model: "Practice", options: undefined },
  ],
});

const deviceModel = makeParsedFile({
  path: "/repo/app/models/device.rb",
  repo: "biobridge-backend",
  language: "ruby",
  fileRole: "domain",
  classes: [{ name: "Device", type: "model" }],
  associations: [
    { type: "belongs_to", name: "patient", target_model: "Patient", options: undefined },
  ],
});

const entryFile = makeParsedFile({
  path: "/repo/app/root.rb",
  repo: "biobridge-backend",
  language: "ruby",
  fileRole: "entry_point",
  classes: [],
  associations: [],
});

// Card generator makes real async LLM calls (even with mock) and enforces
// a 4200ms inter-call delay. Set a generous timeout for this suite.
const CARD_GEN_TIMEOUT = 60_000;

describe("generateCards — card types", () => {
  it("generates flow cards for non-hub flows", async () => {
    const flow = makeFlow(
      [patientModel.path, deviceModel.path],
      { name: "patient-device", isHub: false, repos: ["biobridge-backend"] },
    );
    const edges = [
      makeEdge({ sourceFile: patientModel.path, targetFile: deviceModel.path }),
    ];

    const cards = await generateCards(
      [flow],
      [patientModel, deviceModel],
      edges,
      mockLlm,
    );

    const flowCards = cards.filter((c) => c.cardType === "flow");
    expect(flowCards.length).toBeGreaterThan(0);
  }, CARD_GEN_TIMEOUT);

  it("generates hub cards for hub flows", async () => {
    const hubFlow = makeFlow(
      [patientModel.path, deviceModel.path],
      { name: "common-hub", isHub: true, repos: ["biobridge-backend"] },
    );
    const edges = [makeEdge()];

    const cards = await generateCards(
      [hubFlow],
      [patientModel, deviceModel],
      edges,
      mockLlm,
    );

    const hubCards = cards.filter((c) => c.cardType === "hub");
    expect(hubCards.length).toBeGreaterThan(0);
  }, CARD_GEN_TIMEOUT);

  it("generates model cards for models with sufficient associations", async () => {
    const flow = makeFlow(
      [patientModel.path],
      { name: "patient-flow", isHub: false, repos: ["biobridge-backend"] },
    );
    const edges = [makeEdge()];

    const cards = await generateCards(
      [flow],
      [patientModel, deviceModel],
      edges,
      mockLlm,
    );

    // Patient has 3 associations (>= MIN_MODEL_ASSOCIATIONS) → should get a model card
    const modelCards = cards.filter((c) => c.cardType === "model");
    expect(modelCards.length).toBeGreaterThan(0);
    const patientCard = modelCards.find((c) => c.title.includes("Patient"));
    expect(patientCard).toBeDefined();
  }, CARD_GEN_TIMEOUT);

  it("excludes entry_point files from card sourceFiles", async () => {
    const flow = makeFlow(
      [patientModel.path, entryFile.path],
      { name: "patient-flow", isHub: false, repos: ["biobridge-backend"] },
    );
    const edges = [makeEdge()];

    const cards = await generateCards(
      [flow],
      [patientModel, deviceModel, entryFile],
      edges,
      mockLlm,
    );

    for (const card of cards) {
      expect(card.sourceFiles).not.toContain(entryFile.path);
    }
  }, CARD_GEN_TIMEOUT);

  it("falls back to structural markdown when LLM throws", async () => {
    const flow = makeFlow(
      [patientModel.path, deviceModel.path],
      { name: "patient-device", isHub: false, repos: ["biobridge-backend"] },
    );
    const edges = [makeEdge()];

    // Should not throw even though failingLlm always rejects
    const cards = await generateCards(
      [flow],
      [patientModel, deviceModel],
      edges,
      failingLlm,
    );

    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      // Structural cards still have title and non-empty content
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.content.length).toBeGreaterThan(0);
    }
  }, CARD_GEN_TIMEOUT);

  it("works without an LLM provider (structural-only mode)", async () => {
    const flow = makeFlow(
      [patientModel.path, deviceModel.path],
      { name: "patient-device", isHub: false, repos: ["biobridge-backend"] },
    );
    const edges = [makeEdge()];

    const cards = await generateCards(
      [flow],
      [patientModel, deviceModel],
      edges,
      null, // no LLM
    );

    expect(cards.length).toBeGreaterThan(0);
  });

  it("resolves association names via pascalFromAssoc when target_model is missing", async () => {
    // Associations without target_model trigger pascalFromAssoc + naiveSingularize
    const modelWithoutTargets = makeParsedFile({
      path: "/repo/app/models/prescription.rb",
      repo: "biobridge-backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "Prescription", type: "model" }],
      associations: [
        { type: "has_many", name: "items", target_model: undefined, options: undefined },
        { type: "has_many", name: "categories", target_model: undefined, options: undefined },
        { type: "belongs_to", name: "patient", target_model: undefined, options: undefined },
      ],
    });
    const flow = makeFlow(
      [modelWithoutTargets.path],
      { name: "prescription-flow", isHub: false, repos: ["biobridge-backend"] },
    );

    // Should not throw when resolving association names via naiveSingularize
    const cards = await generateCards([flow], [modelWithoutTargets], [], null);
    expect(cards.length).toBeGreaterThan(0);
  });

  it("includes correct sourceRepos on generated cards", async () => {
    const flow = makeFlow(
      [patientModel.path],
      { name: "patient-flow", isHub: false, repos: ["biobridge-backend"] },
    );

    const cards = await generateCards([flow], [patientModel], [], mockLlm);

    for (const card of cards) {
      expect(card.sourceRepos).toContain("biobridge-backend");
    }
  }, CARD_GEN_TIMEOUT);

  it("generates cross_service cards for api_endpoint edges", async () => {
    const feFile = makeParsedFile({
      path: "/fe/src/api/patients.ts",
      repo: "biobridge-frontend",
      language: "javascript",
      fileRole: "domain",
      apiCalls: [{ method: "GET", path: "/api/v1/patients" }],
    });
    const beFile = makeParsedFile({
      path: "/be/app/controllers/api/v1/patients_controller.rb",
      repo: "biobridge-backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "PatientsController", type: "controller" }],
      routes: [{ path: "/api/v1/patients", method: "GET", action: "index" }],
    });

    const apiEdge = makeEdge({
      sourceFile: feFile.path,
      targetFile: beFile.path,
      relation: "api_endpoint",
      repo: "biobridge-frontend",
      weight: 3,
    });

    const cards = await generateCards(
      [],
      [feFile, beFile],
      [apiEdge],
      mockLlm,
    );

    const crossCards = cards.filter((c) => c.cardType === "cross_service");
    expect(crossCards.length).toBeGreaterThan(0);
    expect(crossCards[0]?.sourceRepos).toContain("biobridge-frontend");
    expect(crossCards[0]?.sourceRepos).toContain("biobridge-backend");
  }, CARD_GEN_TIMEOUT);

  it("generates cross_service cards in structural-only mode (no LLM)", async () => {
    const feFile = makeParsedFile({
      path: "/fe/src/api/patients.ts",
      repo: "biobridge-frontend",
      language: "javascript",
      fileRole: "domain",
      apiCalls: [{ method: "POST", path: "/api/v1/patients" }],
    });
    const beFile = makeParsedFile({
      path: "/be/app/controllers/api/v1/patients_controller.rb",
      repo: "biobridge-backend",
      language: "ruby",
      fileRole: "domain",
      classes: [{ name: "PatientsController", type: "controller" }],
      routes: [{ path: "/api/v1/patients", method: "POST", action: "create" }],
    });

    const apiEdge = makeEdge({
      sourceFile: feFile.path,
      targetFile: beFile.path,
      relation: "api_endpoint",
      weight: 3,
    });

    // No LLM → structural markdown fallback (covers renderSourceFiles, renderRelationships etc.)
    const cards = await generateCards([], [feFile, beFile], [apiEdge], null);

    const crossCards = cards.filter((c) => c.cardType === "cross_service");
    expect(crossCards.length).toBeGreaterThan(0);
    expect(crossCards[0]?.content.length).toBeGreaterThan(0);
  });

  it("stamps commitSha on single-repo cards when commitShaByRepo is provided", async () => {
    const flow = makeFlow(
      [patientModel.path],
      { name: "sha-flow", isHub: false, repos: ["biobridge-backend"] },
    );

    const commitShaByRepo = new Map([["biobridge-backend", "deadbeef123"]]);

    const cards = await generateCards(
      [flow],
      [patientModel],
      [],
      mockLlm,
      undefined,
      commitShaByRepo,
    );

    const backendCards = cards.filter((c) => c.sourceRepos.includes("biobridge-backend"));
    expect(backendCards.every((c) => c.commitSha === "deadbeef123")).toBe(true);
  }, CARD_GEN_TIMEOUT);
});
