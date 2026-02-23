/**
 * Tests for the path relativization logic used in index-repos.ts and doc-generator.ts.
 *
 * Verifies that absolute machine paths are stripped to workspace-relative paths
 * before being stored in the database.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Helper: same logic as the relativizePath() in index-repos.ts
// ---------------------------------------------------------------------------
function relativizePath(absPath: string, root: string): string {
  if (!root) return absPath;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : absPath;
}

// Helper: same logic as the content sanitizer in index-repos.ts
function sanitizeContent(content: string, workspaceRoot: string): string {
  const prefix = workspaceRoot.endsWith("/") ? workspaceRoot : `${workspaceRoot}/`;
  return content.replaceAll(prefix, "");
}

// ---------------------------------------------------------------------------
// relativizePath
// ---------------------------------------------------------------------------

describe("relativizePath", () => {
  const root = "/Users/r1/biobridge";

  it("strips workspace root prefix from absolute path", () => {
    expect(relativizePath("/Users/r1/biobridge/biobridge-backend/app/models/patient.rb", root))
      .toBe("biobridge-backend/app/models/patient.rb");
  });

  it("strips workspace root prefix when root has trailing slash", () => {
    expect(relativizePath("/Users/r1/biobridge/biobridge-frontend/src/App.tsx", "/Users/r1/biobridge/"))
      .toBe("biobridge-frontend/src/App.tsx");
  });

  it("returns the path unchanged when it does not start with the root", () => {
    expect(relativizePath("/tmp/some-other/file.ts", root))
      .toBe("/tmp/some-other/file.ts");
  });

  it("returns the path unchanged when root is empty string", () => {
    expect(relativizePath("/Users/r1/biobridge/file.ts", ""))
      .toBe("/Users/r1/biobridge/file.ts");
  });

  it("handles paths at exactly the root boundary without stripping too much", () => {
    // Should NOT strip partial directory names
    expect(relativizePath("/Users/r1/biobridge-extra/file.ts", root))
      .toBe("/Users/r1/biobridge-extra/file.ts");
  });

  it("strips nested paths correctly", () => {
    expect(
      relativizePath(
        "/Users/r1/biobridge/bp-monitor-api/app/controllers/devices_controller.rb",
        root,
      ),
    ).toBe("bp-monitor-api/app/controllers/devices_controller.rb");
  });
});

// ---------------------------------------------------------------------------
// sanitizeContent — strips workspace root from card content text
// ---------------------------------------------------------------------------

describe("sanitizeContent", () => {
  const root = "/Users/r1/biobridge";

  it("removes workspace root prefix from embedded file references", () => {
    const content = `## Patient model\n\n**File**: /Users/r1/biobridge/biobridge-backend/app/models/patient.rb`;
    expect(sanitizeContent(content, root))
      .toBe("## Patient model\n\n**File**: biobridge-backend/app/models/patient.rb");
  });

  it("removes all occurrences of the workspace root", () => {
    const content = [
      "### Models",
      "- **Patient** (/Users/r1/biobridge/biobridge-backend/app/models/patient.rb)",
      "- **Device** (/Users/r1/biobridge/biobridge-backend/app/models/device.rb)",
    ].join("\n");

    const result = sanitizeContent(content, root);
    expect(result).not.toContain("/Users/r1/biobridge/");
    expect(result).toContain("biobridge-backend/app/models/patient.rb");
    expect(result).toContain("biobridge-backend/app/models/device.rb");
  });

  it("leaves content unchanged when no absolute paths are present", () => {
    const content = "## patients flow\n\nCovers the patients feature across frontend and backend.";
    expect(sanitizeContent(content, root)).toBe(content);
  });

  it("works when workspace root already has trailing slash", () => {
    const content = "**File**: /Users/r1/biobridge/biobridge-backend/app/models/user.rb";
    expect(sanitizeContent(content, "/Users/r1/biobridge/"))
      .toBe("**File**: biobridge-backend/app/models/user.rb");
  });

  it("handles LLM-generated content with mixed absolute paths", () => {
    const content = `
The \`PreAuthorization\` model lives in /Users/r1/biobridge/biobridge-backend/app/models/pre_authorization.rb.
The FE component is at /Users/r1/biobridge/biobridge-frontend/src/pages/PreAuthorizations/index.tsx.
    `.trim();

    const result = sanitizeContent(content, root);
    expect(result).not.toContain("/Users/r1/biobridge/");
    expect(result).toContain("biobridge-backend/app/models/pre_authorization.rb");
    expect(result).toContain("biobridge-frontend/src/pages/PreAuthorizations/index.tsx");
  });
});
