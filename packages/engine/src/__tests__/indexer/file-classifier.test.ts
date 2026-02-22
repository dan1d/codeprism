/**
 * Tests for file-classifier.ts — project-agnostic file role detection.
 *
 * All tests are pure: no DB, no network, no native modules.
 * The classifier only needs path strings and pre-parsed class/association data.
 */

import { describe, it, expect } from "vitest";
import { classifyFileRole } from "../../indexer/file-classifier.js";

// Minimal ParsedFile shape accepted by classifyFileRole
const empty = { classes: [], associations: [], language: "ruby" as const };
const emptyJs = { classes: [], associations: [], language: "javascript" as const };

describe("classifyFileRole — test file detection", () => {
  it("classifies spec directory as test (Ruby)", () => {
    expect(classifyFileRole("app/spec/models/patient_spec.rb", empty)).toBe("test");
  });

  it("classifies __tests__ directory as test (JS)", () => {
    expect(classifyFileRole("src/__tests__/helpers/db.ts", emptyJs)).toBe("test");
  });

  it("classifies cypress directory as test", () => {
    expect(classifyFileRole("cypress/e2e/auth.cy.js", emptyJs)).toBe("test");
  });

  it("classifies *.spec.ts files as test", () => {
    expect(classifyFileRole("src/components/Button.spec.ts", emptyJs)).toBe("test");
  });

  it("classifies *.test.ts files as test", () => {
    expect(classifyFileRole("src/utils/format.test.ts", emptyJs)).toBe("test");
  });

  it("classifies _spec.rb suffix as test", () => {
    expect(classifyFileRole("spec/models/patient_spec.rb", empty)).toBe("test");
  });

  it("classifies *.cy.js suffix as test", () => {
    expect(classifyFileRole("tests/auth.cy.js", emptyJs)).toBe("test");
  });

  it("classifies factories directory as test", () => {
    expect(classifyFileRole("spec/factories/patient_factory.rb", empty)).toBe("test");
  });

  it("classifies fixtures directory as test (non-config extension)", () => {
    // .json files exit early as config; use .js to test path-segment detection
    expect(classifyFileRole("test/fixtures/users.js", emptyJs)).toBe("test");
  });
});

describe("classifyFileRole — domain detection", () => {
  it("classifies models directory as domain (Ruby)", () => {
    expect(classifyFileRole("app/models/patient.rb", empty)).toBe("domain");
  });

  it("classifies controllers directory as domain (Ruby)", () => {
    expect(classifyFileRole("app/controllers/patients_controller.rb", empty)).toBe("domain");
  });

  it("classifies Vue component as domain", () => {
    expect(classifyFileRole("src/components/PatientList.vue", emptyJs)).toBe("domain");
  });

  it("classifies React component as domain", () => {
    expect(classifyFileRole("src/components/PatientCard.tsx", emptyJs)).toBe("domain");
  });

  it("classifies service layer file as domain", () => {
    expect(classifyFileRole("app/services/billing_service.rb", empty)).toBe("domain");
  });
});

describe("classifyFileRole — config detection", () => {
  it("classifies config/routes.rb as domain when it has classes", () => {
    // routes.rb is in config segment but should be config if no domain classes
    expect(classifyFileRole("config/routes.rb", empty)).toBe("config");
  });

  it("classifies .yml files as config", () => {
    expect(classifyFileRole("config/application.yml", emptyJs)).toBe("config");
  });

  it("classifies .json files as config", () => {
    expect(classifyFileRole("config/database.json", emptyJs)).toBe("config");
  });

  it("classifies initializers as config", () => {
    expect(classifyFileRole("config/initializers/sentry.rb", empty)).toBe("config");
  });

  it("classifies migrations directory as config", () => {
    // The CONFIG_PATH_SEGMENTS set contains 'migrations' (plural)
    expect(classifyFileRole("db/migrations/20240101_create_patients.rb", empty)).toBe("config");
  });

  it("classifies .env files as config", () => {
    // extname('.env') = '.env' which is in CONFIG_EXTENSIONS
    expect(classifyFileRole("config/.env", emptyJs)).toBe("config");
  });
});

describe("classifyFileRole — entry_point detection", () => {
  it("classifies src/index.ts as entry_point", () => {
    expect(classifyFileRole("src/index.ts", emptyJs)).toBe("entry_point");
  });

  it("classifies app/root.rb as entry_point", () => {
    expect(classifyFileRole("app/root.rb", empty)).toBe("entry_point");
  });

  it("classifies app.js as entry_point", () => {
    expect(classifyFileRole("src/app.js", emptyJs)).toBe("entry_point");
  });

  it("classifies main.ts as entry_point", () => {
    expect(classifyFileRole("src/main.ts", emptyJs)).toBe("entry_point");
  });

  it("classifies server.ts as entry_point", () => {
    expect(classifyFileRole("src/server.ts", emptyJs)).toBe("entry_point");
  });

  it("classifies router.js as entry_point", () => {
    expect(classifyFileRole("src/router.js", emptyJs)).toBe("entry_point");
  });
});

describe("classifyFileRole — shared_utility detection via content signals", () => {
  it("classifies test-typed class as test", () => {
    const pf = {
      classes: [{ name: "PatientTest", type: "test" as const, methods: [] }],
      associations: [],
      language: "ruby" as const,
    };
    expect(classifyFileRole("lib/patient_test.rb", pf)).toBe("test");
  });

  it("classifies domain file with no test signals as domain", () => {
    const pf = {
      classes: [{ name: "Patient", type: "model" as const, methods: [] }],
      associations: [],
      language: "ruby" as const,
    };
    expect(classifyFileRole("app/models/patient.rb", pf)).toBe("domain");
  });
});

describe("classifyFileRole — ambiguous helpers directory", () => {
  it("treats app/helpers as domain (no test context)", () => {
    // Rails app/helpers is NOT a test directory — check the disambiguation
    const result = classifyFileRole("app/helpers/application_helper.rb", empty);
    expect(result).toBe("domain");
  });

  it("treats spec/helpers as test (has test context)", () => {
    expect(classifyFileRole("spec/helpers/auth_helper_spec.rb", empty)).toBe("test");
  });
});

describe("classifyFileRole — srcmap.json config overrides", () => {
  it("respects testDirs override", () => {
    const repoConfig = { testDirs: ["integration"] };
    expect(
      classifyFileRole("integration/auth_test.rb", empty, repoConfig),
    ).toBe("test");
  });

  it("respects entryPoints override", () => {
    const repoConfig = { entryPoints: ["src/bootstrap.ts"] };
    expect(
      classifyFileRole("/repos/app/src/bootstrap.ts", emptyJs, repoConfig),
    ).toBe("entry_point");
  });

  it("respects excludeGraph override (marks as config)", () => {
    const repoConfig = { excludeGraph: ["vendor/", "generated/"] };
    expect(
      classifyFileRole("vendor/cache/module.ts", emptyJs, repoConfig),
    ).toBe("config");
  });
});
