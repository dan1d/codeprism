import { describe, it, expect } from "vitest";
import { resolveSkills, buildSkillContextPrefix, buildSkillCardHints } from "../../skills/registry.js";

describe("resolveSkills", () => {
  it("resolves rails skill for Rails profile", () => {
    const skills = resolveSkills(["rails"]);
    expect(skills.map((s) => s.id)).toContain("rails");
  });

  it("resolves fastapi + python skills for FastAPI profile", () => {
    const skills = resolveSkills(["fastapi", "python"]);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("fastapi");
    expect(ids).toContain("python");
    // fastapi should come before python (more specific first)
    expect(ids.indexOf("fastapi")).toBeLessThan(ids.indexOf("python"));
  });

  it("resolves lambda skill when lambda ID is present", () => {
    const skills = resolveSkills(["python", "lambda"]);
    expect(skills.map((s) => s.id)).toContain("lambda");
  });

  it("returns empty array for empty skillIds", () => {
    const skills = resolveSkills([]);
    expect(skills).toHaveLength(0);
  });

  it("returns empty array for unrecognised skill IDs", () => {
    const skills = resolveSkills(["cobol", "fortran"]);
    expect(skills).toHaveLength(0);
  });
});

describe("buildSkillContextPrefix", () => {
  it("returns empty string for empty skillIds", () => {
    expect(buildSkillContextPrefix([])).toBe("");
  });

  it("includes Rails prefix for Rails skillIds", () => {
    const prefix = buildSkillContextPrefix(["rails"]);
    expect(prefix).toContain("Rails");
    expect(prefix).toContain("ActiveRecord");
  });

  it("joins multiple skill prefixes with |", () => {
    const prefix = buildSkillContextPrefix(["fastapi", "python"]);
    expect(prefix).toContain("|");
    expect(prefix).toContain("FastAPI");
    expect(prefix).toContain("Python");
  });
});

describe("buildSkillCardHints", () => {
  it("returns Go-specific hints for Go skillIds", () => {
    const hints = buildSkillCardHints(["go"]);
    expect(hints).toContain("Go");
  });

  it("includes Lambda hints when Lambda skill is present", () => {
    const hints = buildSkillCardHints(["lambda"]);
    expect(hints).toContain("Lambda");
  });

  it("returns empty string for empty skillIds", () => {
    expect(buildSkillCardHints([])).toBe("");
  });
});

describe("buildSkillSearchTag", () => {
  it("returns empty string for empty skillIds", async () => {
    const { buildSkillSearchTag } = await import("../../skills/registry.js");
    expect(buildSkillSearchTag([])).toBe("");
  });

  it("returns a pipe-joined tag string for Rails skillIds", async () => {
    const { buildSkillSearchTag } = await import("../../skills/registry.js");
    const tag = buildSkillSearchTag(["rails"]);
    expect(typeof tag).toBe("string");
    expect(tag.length).toBeGreaterThan(0);
  });

  it("combines multiple skill search tags with | separator", async () => {
    const { buildSkillSearchTag } = await import("../../skills/registry.js");
    const tag = buildSkillSearchTag(["fastapi", "python"]);
    expect(tag).toContain("|");
  });
});
