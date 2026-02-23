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
  buildFrameworkBaseline,
  buildFrameworkArchitectureOnly,
  DOC_SYSTEM_PROMPT,
  type FrameworkBestPractices,
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

  it("throws for doc types that require special generation (specialist, changelog, memory, api_contracts)", () => {
    const nonRefreshable = ["specialist", "changelog", "memory", "api_contracts"] as const;
    for (const type of nonRefreshable) {
      expect(() => buildRefreshDocPrompt(type, "my-repo", sampleFiles)).toThrow(
        `Doc type "${type}" cannot be refreshed via buildRefreshDocPrompt`,
      );
    }
  });
});

const railsPractices: FrameworkBestPractices = {
  architecture: ["Use service objects for business logic > 3 steps", "Keep controllers thin"],
  codeStyle: ["Avoid 1-line method bodies", "Use snake_case for methods"],
  testing: ["Use RSpec with FactoryBot"],
  performance: ["Use includes/joins to prevent N+1"],
  security: ["Use strong_parameters"],
  antiPatterns: ["Fat controllers with embedded business logic"],
};

const reactPractices: FrameworkBestPractices = {
  architecture: ["Separate presentational from container components"],
  codeStyle: ["Use function components with hooks"],
  testing: ["Use React Testing Library"],
  performance: ["Use React.memo only after measuring"],
  security: ["Never use dangerouslySetInnerHTML with unsanitized content"],
  antiPatterns: ["Storing server state in Redux"],
};

describe("buildFrameworkBaseline", () => {
  it("returns an empty string for an empty array", () => {
    expect(buildFrameworkBaseline([])).toBe("");
  });

  it("includes architecture bullets for a single skill", () => {
    const result = buildFrameworkBaseline([railsPractices]);
    expect(result).toContain("Architecture");
    expect(result).toContain("service objects");
  });

  it("includes code style bullets for a single skill", () => {
    const result = buildFrameworkBaseline([railsPractices]);
    expect(result).toContain("Code Style");
    expect(result).toContain("snake_case");
  });

  it("includes anti-patterns section", () => {
    const result = buildFrameworkBaseline([railsPractices]);
    expect(result).toContain("Anti-Patterns");
    expect(result).toContain("Fat controllers");
  });

  it("merges two skills without duplicating shared items", () => {
    const shared: FrameworkBestPractices = {
      ...railsPractices,
      architecture: ["Shared rule", ...railsPractices.architecture],
    };
    const skillB: FrameworkBestPractices = {
      ...reactPractices,
      architecture: ["Shared rule", ...reactPractices.architecture],
    };
    const result = buildFrameworkBaseline([shared, skillB]);
    const occurrences = result.split("Shared rule").length - 1;
    expect(occurrences).toBe(1);
  });

  it("merges content from both skills", () => {
    const result = buildFrameworkBaseline([railsPractices, reactPractices]);
    expect(result).toContain("service objects");
    expect(result).toContain("function components");
  });

  it("injects baseline into buildCodeStylePrompt when provided", () => {
    const baseline = buildFrameworkBaseline([railsPractices]);
    const prompt = buildCodeStylePrompt("my-repo", sampleFiles, baseline);
    expect(prompt).toContain("Framework Baseline");
    expect(prompt).toContain("service objects");
  });

  it("buildCodeStylePrompt without baseline has no Framework Baseline section", () => {
    const prompt = buildCodeStylePrompt("my-repo", sampleFiles);
    expect(prompt).not.toContain("Framework Baseline");
  });

  it("injects baseline into buildRulesPrompt when provided", () => {
    const baseline = buildFrameworkBaseline([railsPractices]);
    const prompt = buildRulesPrompt("my-repo", sampleFiles, baseline);
    expect(prompt).toContain("Framework Baseline");
    expect(prompt).toContain("strong_parameters");
  });

  it("buildRulesPrompt without baseline has no Framework Baseline section", () => {
    const prompt = buildRulesPrompt("my-repo", sampleFiles);
    expect(prompt).not.toContain("Framework Baseline");
  });

  it("injects framework expertise into buildSpecialistPrompt when provided", () => {
    const baseline = buildFrameworkBaseline([railsPractices]);
    const prompt = buildSpecialistPrompt("my-repo", "Ruby on Rails", "About...", "Arch...", "Rules...", baseline);
    expect(prompt).toContain("Framework Expertise");
    expect(prompt).toContain("Ruby on Rails");
  });

  it("buildSpecialistPrompt without bestPractices has no Framework Expertise section", () => {
    const prompt = buildSpecialistPrompt("my-repo", "Ruby on Rails", "About...", "Arch...", "Rules...");
    expect(prompt).not.toContain("Framework Expertise");
  });

  it("includes testing bullets when { includeTesting: true }", () => {
    const result = buildFrameworkBaseline([railsPractices], { includeTesting: true });
    expect(result).toContain("Testing");
    expect(result).toContain("RSpec with FactoryBot");
  });

  it("excludes testing bullets by default (no options)", () => {
    const result = buildFrameworkBaseline([railsPractices]);
    expect(result).not.toContain("Testing");
  });

  it("includes performance bullets when { includePerformance: true }", () => {
    const result = buildFrameworkBaseline([railsPractices], { includePerformance: true });
    expect(result).toContain("Performance");
    expect(result).toContain("includes/joins");
  });

  it("caps each section at 8 bullets even with many skills", () => {
    const wideSkill: FrameworkBestPractices = {
      ...railsPractices,
      architecture: Array.from({ length: 15 }, (_, i) => `Arch rule ${i}`),
      codeStyle: Array.from({ length: 15 }, (_, i) => `Style rule ${i}`),
    };
    const result = buildFrameworkBaseline([wideSkill]);
    // Each section is capped at 8 bullets; count "- " lines per section
    const archBullets = (result.match(/^- Arch rule/gm) ?? []).length;
    const styleBullets = (result.match(/^- Style rule/gm) ?? []).length;
    expect(archBullets).toBeLessThanOrEqual(8);
    expect(styleBullets).toBeLessThanOrEqual(8);
  });

  it("buildRefreshDocPrompt propagates frameworkBaseline to code_style", () => {
    const baseline = "**Architecture**\n- Use service objects";
    const prompt = buildRefreshDocPrompt("code_style", "my-repo", sampleFiles, baseline);
    expect(prompt).toContain("Framework Baseline");
    expect(prompt).toContain("Use service objects");
  });

  it("buildRefreshDocPrompt propagates frameworkBaseline to rules", () => {
    const baseline = "**Security**\n- Use strong_parameters";
    const prompt = buildRefreshDocPrompt("rules", "my-repo", sampleFiles, baseline);
    expect(prompt).toContain("Framework Baseline");
  });

  it("buildFrameworkArchitectureOnly returns only Architecture section", () => {
    const result = buildFrameworkArchitectureOnly([railsPractices]);
    expect(result).toContain("Architecture");
    expect(result).toContain("service objects");
    expect(result).not.toContain("Code Style");
    expect(result).not.toContain("Security");
  });

  it("buildFrameworkArchitectureOnly returns empty string for empty input", () => {
    expect(buildFrameworkArchitectureOnly([])).toBe("");
  });

  it("buildFrameworkArchitectureOnly merges two skills and caps at 10", () => {
    const result = buildFrameworkArchitectureOnly([railsPractices, reactPractices]);
    expect(result).toContain("service objects");
    expect(result).toContain("presentational");
  });
});
