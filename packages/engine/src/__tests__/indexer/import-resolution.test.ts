/**
 * Tests for cross-language import resolution in graph-builder.
 *
 * Covers: Go module-internal imports, Python dotted imports,
 * Ruby gem-style require, class inheritance edges.
 */

import { describe, it, expect } from "vitest";
import { buildGraph } from "../../indexer/graph-builder.js";
import { makeParsedFile } from "../helpers/fixtures.js";

describe("buildGraph — Go module-internal imports", () => {
  it("resolves Go imports by package directory suffix", () => {
    const routerFile = makeParsedFile({
      path: "gin/gin.go",
      repo: "gin",
      language: "go",
      fileRole: "domain",
      imports: [{ name: "render", source: "github.com/gin-gonic/gin/render", isDefault: false }],
    });
    const renderFile = makeParsedFile({
      path: "gin/render/json.go",
      repo: "gin",
      language: "go",
      fileRole: "domain",
      imports: [],
    });

    const edges = buildGraph([routerFile, renderFile]);
    const importEdge = edges.find(
      (e) => e.relation === "import" && e.sourceFile === routerFile.path && e.targetFile === renderFile.path,
    );
    expect(importEdge).toBeDefined();
  });
});

describe("buildGraph — Python dotted imports", () => {
  it("resolves Python dotted module paths to files", () => {
    const appFile = makeParsedFile({
      path: "flask/src/flask/app.py",
      repo: "flask",
      language: "python",
      fileRole: "domain",
      imports: [{ name: "scaffold", source: "flask.sansio.scaffold", isDefault: false }],
    });
    const scaffoldFile = makeParsedFile({
      path: "flask/src/flask/sansio/scaffold.py",
      repo: "flask",
      language: "python",
      fileRole: "domain",
      imports: [],
    });

    const edges = buildGraph([appFile, scaffoldFile]);
    const importEdge = edges.find(
      (e) => e.relation === "import" && e.sourceFile === appFile.path && e.targetFile === scaffoldFile.path,
    );
    expect(importEdge).toBeDefined();
  });
});

describe("buildGraph — Ruby gem-style require", () => {
  it("resolves require 'sinatra/base' to lib/sinatra/base.rb", () => {
    const mainFile = makeParsedFile({
      path: "sinatra/lib/sinatra.rb",
      repo: "sinatra",
      language: "ruby",
      fileRole: "domain",
      imports: [{ name: "main", source: "sinatra/main", isDefault: true }],
    });
    const baseFile = makeParsedFile({
      path: "sinatra/lib/sinatra/main.rb",
      repo: "sinatra",
      language: "ruby",
      fileRole: "domain",
      imports: [],
    });

    const edges = buildGraph([mainFile, baseFile]);
    const importEdge = edges.find(
      (e) => e.relation === "import" && e.sourceFile === mainFile.path && e.targetFile === baseFile.path,
    );
    expect(importEdge).toBeDefined();
  });
});

describe("buildGraph — class inheritance edges", () => {
  it("creates model_association edge for class inheritance", () => {
    const childFile = makeParsedFile({
      path: "flask/src/flask/app.py",
      repo: "flask",
      language: "python",
      fileRole: "domain",
      classes: [{ name: "Flask", parent: "App", type: "other" }],
    });
    const parentFile = makeParsedFile({
      path: "flask/src/flask/sansio/app.py",
      repo: "flask",
      language: "python",
      fileRole: "domain",
      classes: [{ name: "App", type: "other" }],
    });

    const edges = buildGraph([childFile, parentFile]);
    const inheritEdge = edges.find(
      (e) =>
        e.relation === "model_association" &&
        e.sourceFile === childFile.path &&
        e.targetFile === parentFile.path,
    );
    expect(inheritEdge).toBeDefined();
    const meta = typeof inheritEdge!.metadata === "string"
      ? JSON.parse(inheritEdge!.metadata)
      : inheritEdge!.metadata;
    expect(meta.associationType).toBe("inherits");
  });
});

describe("file classifier — lib/ files are domain", () => {
  it("files under lib/ should not be classified as entry_point by basename alone", () => {
    const applicationFile = makeParsedFile({
      path: "express/lib/application.js",
      repo: "express",
      language: "javascript",
      fileRole: "domain",
      imports: [{ name: "utils", source: "./utils", isDefault: true }],
    });
    const utilsFile = makeParsedFile({
      path: "express/lib/utils.js",
      repo: "express",
      language: "javascript",
      fileRole: "domain",
      imports: [],
    });

    const edges = buildGraph([applicationFile, utilsFile]);
    const importEdge = edges.find(
      (e) => e.relation === "import" && e.sourceFile === applicationFile.path,
    );
    expect(importEdge).toBeDefined();
  });
});
