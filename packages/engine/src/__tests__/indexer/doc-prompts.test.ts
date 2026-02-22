/**
 * Tests for indexer/doc-prompts.ts — prompt building functions.
 *
 * All functions are pure (no external deps), so no mocking is needed.
 */

import { describe, it, expect } from "vitest";
import {
  buildReadmePrompt,
  buildAboutPrompt,
  buildArchitecturePrompt,
  buildCodeStylePrompt,
  buildRulesPrompt,
  buildStylesPrompt,
  buildApiContractsPrompt,
  buildSpecialistPrompt,
  buildChangelogPrompt,
  buildMemoryDocPrompt,
  buildRefreshDocPrompt,
  DOC_SYSTEM_PROMPT,
} from "../../indexer/doc-prompts.js";

const sampleFiles = [
  { path: "app/models/patient.rb", content: "class Patient < ApplicationRecord; end" },
  { path: "package.json", content: '{"name":"my-app","version":"1.0.0"}' },
];

describe("DOC_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof DOC_SYSTEM_PROMPT).toBe("string");
    expect(DOC_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});

describe("buildReadmePrompt", () => {
  it("includes the repo name", () => {
    const prompt = buildReadmePrompt("biobridge-backend", sampleFiles);
    expect(prompt).toContain("biobridge-backend");
  });

  it("includes source file paths", () => {
    const prompt = buildReadmePrompt("my-repo", sampleFiles);
    expect(prompt).toContain("app/models/patient.rb");
    expect(prompt).toContain("package.json");
  });

  it("includes source file content", () => {
    const prompt = buildReadmePrompt("my-repo", sampleFiles);
    expect(prompt).toContain("ApplicationRecord");
  });

  it("returns a non-empty string", () => {
    const prompt = buildReadmePrompt("repo", []);
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe("buildAboutPrompt", () => {
  it("includes the repo name", () => {
    const prompt = buildAboutPrompt("my-app", sampleFiles);
    expect(prompt).toContain("my-app");
  });

  it("mentions 'about' context", () => {
    const prompt = buildAboutPrompt("my-app", sampleFiles);
    expect(prompt.toLowerCase()).toMatch(/about|purpose|what.*does/);
  });
});

describe("buildArchitecturePrompt", () => {
  it("includes the repo name", () => {
    const prompt = buildArchitecturePrompt("backend", sampleFiles);
    expect(prompt).toContain("backend");
  });

  it("references architecture concepts", () => {
    const prompt = buildArchitecturePrompt("backend", sampleFiles);
    expect(prompt.toLowerCase()).toMatch(/architect|structure|module|layer|component/);
  });
});

describe("buildCodeStylePrompt", () => {
  it("includes the repo name", () => {
    const prompt = buildCodeStylePrompt("frontend", sampleFiles);
    expect(prompt).toContain("frontend");
  });

  it("references coding conventions", () => {
    const prompt = buildCodeStylePrompt("frontend", sampleFiles);
    expect(prompt.toLowerCase()).toMatch(/style|convention|pattern|guideline/);
  });
});

describe("buildRulesPrompt", () => {
  it("includes the repo name", () => {
    const prompt = buildRulesPrompt("api-service", sampleFiles);
    expect(prompt).toContain("api-service");
  });

  it("produces a non-empty prompt", () => {
    const prompt = buildRulesPrompt("api-service", []);
    expect(prompt.length).toBeGreaterThan(10);
  });
});

describe("buildStylesPrompt", () => {
  it("includes the repo name", () => {
    const prompt = buildStylesPrompt("web-app", sampleFiles);
    expect(prompt).toContain("web-app");
  });

  it("references UI/CSS context", () => {
    const prompt = buildStylesPrompt("web-app", sampleFiles);
    expect(prompt.toLowerCase()).toMatch(/style|css|design|ui|visual/);
  });
});

describe("buildApiContractsPrompt", () => {
  it("includes the repo name", () => {
    const prompt = buildApiContractsPrompt("rails-api", sampleFiles);
    expect(prompt).toContain("rails-api");
  });

  it("references API/endpoint concepts", () => {
    const prompt = buildApiContractsPrompt("rails-api", sampleFiles);
    expect(prompt.toLowerCase()).toMatch(/api|endpoint|contract|route|request|response/);
  });
});

describe("buildSpecialistPrompt", () => {
  it("includes the repo name", () => {
    const prompt = buildSpecialistPrompt(
      "biobridge-backend",
      "Rails",
      "A healthcare app for managing patients.",
      "Rails monolith with Vue.js frontend.",
      "Follow RESTful conventions.",
    );
    expect(prompt).toContain("biobridge-backend");
  });

  it("includes the stack name", () => {
    const prompt = buildSpecialistPrompt(
      "biobridge-backend",
      "Rails",
      "About content",
      "Arch content",
      "Rules content",
    );
    expect(prompt).toContain("Rails");
  });

  it("includes about, architecture and rules doc content", () => {
    const prompt = buildSpecialistPrompt(
      "backend",
      "Rails",
      "healthcare app for patients",
      "Rails monolith with Vue.js frontend",
      "RESTful conventions always",
    );
    expect(prompt).toContain("healthcare app");
    expect(prompt).toContain("Rails monolith");
    expect(prompt).toContain("RESTful conventions");
  });
});

describe("buildChangelogPrompt", () => {
  const commitMessages = [
    "feat: add batch authorization (abc123)",
    "fix: null pointer in patient model (def456)",
  ];

  it("includes the repo name", () => {
    const prompt = buildChangelogPrompt("backend", commitMessages);
    expect(prompt).toContain("backend");
  });

  it("includes commit messages", () => {
    const prompt = buildChangelogPrompt("backend", commitMessages);
    expect(prompt).toContain("batch authorization");
    expect(prompt).toContain("null pointer");
  });

  it("works with empty commits", () => {
    const prompt = buildChangelogPrompt("backend", []);
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe("buildMemoryDocPrompt", () => {
  it("produces a non-empty prompt", () => {
    const prompt = buildMemoryDocPrompt({
      topFlows: [{ flow: "billing", queryCount: 12 }],
      recentInsights: [
        { title: "Patient model insight", flow: "patient", content: "Users have_many Devices", created_at: "2025-01-01T00:00:00Z" },
      ],
    });
    expect(prompt.length).toBeGreaterThan(10);
  });

  it("includes top flow names", () => {
    const prompt = buildMemoryDocPrompt({
      topFlows: [
        { flow: "billing", queryCount: 20 },
        { flow: "patient", queryCount: 15 },
      ],
      recentInsights: [],
    });
    expect(prompt).toContain("billing");
    expect(prompt).toContain("patient");
  });

  it("includes insight titles", () => {
    const prompt = buildMemoryDocPrompt({
      topFlows: [],
      recentInsights: [
        {
          title: "Authorization Flow",
          flow: "auth",
          content: "Tokens expire after 24h",
          created_at: "2025-02-01T00:00:00Z",
        },
      ],
    });
    expect(prompt).toContain("Authorization Flow");
    expect(prompt).toContain("Tokens expire");
  });

  it("handles empty inputs gracefully", () => {
    const prompt = buildMemoryDocPrompt({ topFlows: [], recentInsights: [] });
    expect(prompt).toContain("none yet");
  });
});

describe("buildRefreshDocPrompt", () => {
  it("delegates to the correct builder for each docType", () => {
    const types = ["readme", "about", "architecture", "code_style", "rules", "styles"] as const;
    for (const type of types) {
      const prompt = buildRefreshDocPrompt(type, "my-repo", sampleFiles);
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain("my-repo");
    }
  });

  it("falls back to readme prompt for unknown docType", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompt = buildRefreshDocPrompt("unknown_type" as any, "my-repo", sampleFiles);
    expect(prompt.length).toBeGreaterThan(0);
  });
});
