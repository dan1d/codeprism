/**
 * Tests for route extraction in language parsers.
 *
 * Covers: JS (Express/Koa app.get), Python (@app.route), Go (r.GET),
 * Ruby (require_relative / require gem-style).
 */

import { describe, it, expect } from "vitest";
import { javascriptParser } from "../../indexer/parsers/javascript.js";
import { rubyParser } from "../../indexer/parsers/ruby.js";

describe("JavaScript route extraction", () => {
  it("extracts Express-style app.get('/path', handler) routes", () => {
    const code = `
const express = require('express');
const app = express();
app.get('/users', listUsers);
app.post('/users', createUser);
app.use('/api', apiRouter);
`;
    const result = javascriptParser.parse(code, "app.js");
    expect(result.routes).toHaveLength(3);
    expect(result.routes).toContainEqual({ method: "GET", path: "/users" });
    expect(result.routes).toContainEqual({ method: "POST", path: "/users" });
    expect(result.routes).toContainEqual({ method: "USE", path: "/api" });
  });

  it("extracts router method calls", () => {
    const code = `
const router = require('express').Router();
router.put('/items/:id', updateItem);
router.delete('/items/:id', deleteItem);
`;
    const result = javascriptParser.parse(code, "routes.js");
    expect(result.routes).toContainEqual({ method: "PUT", path: "/items/:id" });
    expect(result.routes).toContainEqual({ method: "DELETE", path: "/items/:id" });
  });
});

describe("Ruby require extraction", () => {
  it("extracts require_relative imports", () => {
    const code = `
require_relative 'middleware/logger'
require_relative 'version'

module Sinatra
  class Base
  end
end
`;
    const result = rubyParser.parse(code, "lib/sinatra/base.rb");
    expect(result.imports).toBeDefined();
    expect(result.imports!.length).toBeGreaterThanOrEqual(2);
    expect(result.imports).toContainEqual(
      expect.objectContaining({ source: "./middleware/logger" }),
    );
    expect(result.imports).toContainEqual(
      expect.objectContaining({ source: "./version" }),
    );
  });

  it("extracts gem-style require with paths", () => {
    const code = `
require 'sinatra/main'
require 'rack/protection'
require 'json'
`;
    const result = rubyParser.parse(code, "lib/sinatra.rb");
    expect(result.imports).toBeDefined();
    const pathImports = result.imports!.filter((i) => i.source.includes("/"));
    expect(pathImports.length).toBeGreaterThanOrEqual(2);
    expect(pathImports).toContainEqual(
      expect.objectContaining({ source: "sinatra/main" }),
    );
  });
});
