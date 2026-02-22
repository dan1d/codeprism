import { describe, it, expect } from "vitest";
import { resolveSkills, buildSkillContextPrefix, buildSkillCardHints } from "../../skills/registry.js";
import type { StackProfile } from "../../indexer/stack-profiler.js";

function makeProfile(overrides: Partial<StackProfile>): StackProfile {
  return {
    primaryLanguage: "unknown",
    frameworks: [],
    isLambda: false,
    packageManager: "",
    skillIds: [],
    ...overrides,
  };
}

describe("resolveSkills", () => {
  it("resolves rails skill for Rails profile", () => {
    const profile = makeProfile({ primaryLanguage: "ruby", frameworks: ["rails"], skillIds: ["rails"] });
    const skills = resolveSkills(profile);
    expect(skills.map((s) => s.id)).toContain("rails");
  });

  it("resolves fastapi + python skills for FastAPI profile", () => {
    const profile = makeProfile({ primaryLanguage: "python", frameworks: ["fastapi"], skillIds: ["fastapi", "python"] });
    const skills = resolveSkills(profile);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("fastapi");
    expect(ids).toContain("python");
    // fastapi should come before python (more specific first)
    expect(ids.indexOf("fastapi")).toBeLessThan(ids.indexOf("python"));
  });

  it("resolves lambda skill when isLambda is true", () => {
    const profile = makeProfile({ primaryLanguage: "python", skillIds: ["python", "lambda"] });
    const skills = resolveSkills(profile);
    expect(skills.map((s) => s.id)).toContain("lambda");
  });

  it("returns empty array for unknown profile", () => {
    const profile = makeProfile({ skillIds: [] });
    const skills = resolveSkills(profile);
    expect(skills).toHaveLength(0);
  });

  it("returns empty array for unrecognised skill IDs", () => {
    const profile = makeProfile({ skillIds: ["cobol", "fortran"] as any });
    const skills = resolveSkills(profile);
    expect(skills).toHaveLength(0);
  });
});

describe("buildSkillContextPrefix", () => {
  it("returns empty string for unknown profile", () => {
    const profile = makeProfile({});
    expect(buildSkillContextPrefix(profile)).toBe("");
  });

  it("includes Rails prefix for Rails profile", () => {
    const profile = makeProfile({ skillIds: ["rails"] });
    const prefix = buildSkillContextPrefix(profile);
    expect(prefix).toContain("Rails");
    expect(prefix).toContain("ActiveRecord");
  });

  it("joins multiple skill prefixes with |", () => {
    const profile = makeProfile({ skillIds: ["fastapi", "python"] });
    const prefix = buildSkillContextPrefix(profile);
    expect(prefix).toContain("|");
    expect(prefix).toContain("FastAPI");
    expect(prefix).toContain("Python");
  });
});

describe("buildSkillCardHints", () => {
  it("returns Go-specific hints for Go profile", () => {
    const profile = makeProfile({ primaryLanguage: "go", skillIds: ["go"] });
    const hints = buildSkillCardHints(profile);
    expect(hints).toContain("Go");
  });

  it("includes Lambda hints when Lambda skill is present", () => {
    const profile = makeProfile({ skillIds: ["lambda"] });
    const hints = buildSkillCardHints(profile);
    expect(hints).toContain("Lambda");
  });
});
