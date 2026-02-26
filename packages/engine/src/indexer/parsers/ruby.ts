import { createRequire } from "node:module";
import type {
  Association,
  ClassInfo,
  FunctionInfo,
  ImportInfo,
  LanguageParser,
  ParsedFile,
  RouteInfo,
} from "../types.js";

const require = createRequire(import.meta.url);
const Parser = require("tree-sitter") as typeof import("tree-sitter");
const Ruby = require("tree-sitter-ruby");

/* ------------------------------------------------------------------ */
/*  Singleton parser                                                    */
/* ------------------------------------------------------------------ */

const parser = new Parser();
parser.setLanguage(Ruby);

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const RAILS_CALLBACKS = new Set([
  "before_save",
  "after_save",
  "around_save",
  "before_create",
  "after_create",
  "around_create",
  "before_update",
  "after_update",
  "around_update",
  "before_destroy",
  "after_destroy",
  "around_destroy",
  "before_validation",
  "after_validation",
  "after_commit",
  "after_rollback",
  "after_create_commit",
  "after_update_commit",
  "after_destroy_commit",
  "after_save_commit",
  "before_action",
  "after_action",
  "around_action",
  "skip_before_action",
  "skip_after_action",
  "skip_around_action",
  "before_filter",
  "after_filter",
  "around_filter",
  "prepend_before_action",
  "append_after_action",
]);

const RAILS_ASSOCIATIONS = new Set<Association["type"]>([
  "has_many",
  "belongs_to",
  "has_one",
  "has_and_belongs_to_many",
]);

const CLASS_TYPE_PATH_MAP: [RegExp, ClassInfo["type"]][] = [
  [/\/models\//, "model"],
  [/\/controllers\//, "controller"],
  [/\/jobs\//, "job"],
  [/\/services\//, "service"],
  [/\/concerns\//, "concern"],
  [/\/helpers\//, "helper"],
  [/\/serializers\//, "serializer"],
  [/\/middleware\//, "middleware"],
];

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                     */
/* ------------------------------------------------------------------ */

function stripQuotes(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, "");
}

function snakeToPascal(s: string): string {
  return s
    .split("_")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : ""))
    .join("");
}

function singularize(word: string): string {
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes"))
    return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/* ------------------------------------------------------------------ */
/*  Classification                                                      */
/* ------------------------------------------------------------------ */

function classifyRubyType(
  filePath: string,
  parent?: string,
): ClassInfo["type"] {
  if (parent === "ApplicationRecord") return "model";
  if (parent?.includes("Controller")) return "controller";
  if (parent === "ApplicationJob" || parent === "ActiveJob::Base") return "job";

  for (const [pattern, type] of CLASS_TYPE_PATH_MAP) {
    if (pattern.test(filePath)) return type;
  }

  return "other";
}

/* ------------------------------------------------------------------ */
/*  Association helpers                                                 */
/* ------------------------------------------------------------------ */

function extractClassNameOption(
  args: import("tree-sitter").SyntaxNode,
): string | undefined {
  for (const pair of args.descendantsOfType("pair")) {
    const key = pair.childForFieldName("key");
    if (!key) continue;
    const kText = key.text.replace(/^:/, "");
    if (kText === "class_name") {
      const value = pair.childForFieldName("value");
      return value ? stripQuotes(value.text) : undefined;
    }
  }
  return undefined;
}

function inferTargetModel(
  assocName: string,
  assocType: string,
  args: import("tree-sitter").SyntaxNode | null,
): string | undefined {
  if (args) {
    const explicit = extractClassNameOption(args);
    if (explicit) return explicit;
  }
  const base = assocType === "has_many" || assocType === "has_and_belongs_to_many"
    ? singularize(assocName)
    : assocName;
  return snakeToPascal(base);
}

/* ------------------------------------------------------------------ */
/*  Class body extraction                                               */
/* ------------------------------------------------------------------ */

function extractRubyClassBody(
  body: import("tree-sitter").SyntaxNode,
  functions: FunctionInfo[],
  associations: Association[],
  callbacks: string[],
  validations: string[],
): void {
  let visibility: FunctionInfo["visibility"] = "public";

  for (const child of body.namedChildren) {
    if (
      child.type === "identifier" &&
      (child.text === "private" ||
        child.text === "protected" ||
        child.text === "public")
    ) {
      visibility = child.text as FunctionInfo["visibility"];
      continue;
    }

    if (child.type === "method") {
      const nameNode = child.childForFieldName("name");
      functions.push({
        name: nameNode?.text ?? "",
        visibility,
        isAsync: false,
      });
      continue;
    }

    if (child.type === "singleton_method") {
      const nameNode = child.childForFieldName("name");
      functions.push({
        name: `self.${nameNode?.text ?? ""}`,
        visibility,
        isAsync: false,
      });
      continue;
    }

    if (child.type !== "call") continue;

    const methodNode = child.childForFieldName("method");
    if (!methodNode) continue;
    const methodName = methodNode.text;

    if (
      methodName === "private" ||
      methodName === "protected" ||
      methodName === "public"
    ) {
      const args = child.childForFieldName("arguments");
      if (!args || args.namedChildren.length === 0) {
        visibility = methodName as FunctionInfo["visibility"];
      }
      continue;
    }

    if (RAILS_ASSOCIATIONS.has(methodName as Association["type"])) {
      const args = child.childForFieldName("arguments");
      const firstArg = args?.namedChildren[0];
      const assocName = firstArg?.text.replace(/^:/, "") ?? "";

      associations.push({
        type: methodName as Association["type"],
        name: assocName,
        target_model: inferTargetModel(assocName, methodName, args ?? null),
        options:
          args && args.namedChildren.length > 1
            ? args.namedChildren
                .slice(1)
                .map((c) => c.text)
                .join(", ")
            : undefined,
      });
      continue;
    }

    if (
      methodName === "validates" ||
      methodName === "validate" ||
      methodName.startsWith("validates_")
    ) {
      const args = child.childForFieldName("arguments");
      const fields =
        args?.namedChildren
          .filter((c) => c.type === "simple_symbol")
          .map((c) => c.text.replace(/^:/, "")) ?? [];
      validations.push(
        fields.length > 0 ? `${methodName} ${fields.join(", ")}` : methodName,
      );
      continue;
    }

    if (RAILS_CALLBACKS.has(methodName)) {
      callbacks.push(methodName);
      continue;
    }

    if (methodName === "scope") {
      const args = child.childForFieldName("arguments");
      const scopeNameNode = args?.namedChildren[0];
      if (scopeNameNode) {
        functions.push({
          name: `scope:${scopeNameNode.text.replace(/^:/, "")}`,
          visibility: "public",
          isAsync: false,
        });
      }
      continue;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Source parsing (tree-sitter AST)                                    */
/* ------------------------------------------------------------------ */

function parseRubySource(
  source: string,
  filePath: string,
): Partial<ParsedFile> {
  const tree = parser.parse(source);
  const root = tree.rootNode;

  const classes: ClassInfo[] = [];
  const associations: Association[] = [];
  const functions: FunctionInfo[] = [];
  const callbacks: string[] = [];
  const validations: string[] = [];

  for (const classNode of root.descendantsOfType("class")) {
    const nameNode = classNode.childForFieldName("name");
    const superNode = classNode.childForFieldName("superclass");

    const name = nameNode?.text ?? "";
    const parent = superNode?.text;

    classes.push({
      name,
      parent,
      type: classifyRubyType(filePath, parent),
    });

    const body = classNode.namedChildren.find(
      (c) => c.type === "body_statement",
    );
    if (body) {
      extractRubyClassBody(body, functions, associations, callbacks, validations);
    }
  }

  for (const method of root.children.filter((c) => c.type === "method")) {
    const nameNode = method.childForFieldName("name");
    functions.push({
      name: nameNode?.text ?? "",
      visibility: "public",
      isAsync: false,
    });
  }

  // Extract require_relative and require imports
  const imports: ImportInfo[] = [];
  const REQUIRE_RELATIVE_RE = /require_relative\s+['"]([^'"]+)['"]/g;
  let reqMatch: RegExpExecArray | null;
  while ((reqMatch = REQUIRE_RELATIVE_RE.exec(source)) !== null) {
    imports.push({
      name: reqMatch[1].split("/").pop() ?? reqMatch[1],
      source: `./${reqMatch[1]}`,
      isDefault: true,
    });
  }

  // Plain require with paths matching a gem's internal structure (e.g. require 'sinatra/base')
  const REQUIRE_RE = /(?:^|\n)\s*require\s+['"]([a-z][a-z0-9_/]+)['"]/g;
  while ((reqMatch = REQUIRE_RE.exec(source)) !== null) {
    const reqPath = reqMatch[1];
    if (reqPath.includes("/")) {
      imports.push({
        name: reqPath.split("/").pop() ?? reqPath,
        source: reqPath,
        isDefault: true,
      });
    }
  }

  return { classes, associations, functions, callbacks, validations, imports };
}

/* ------------------------------------------------------------------ */
/*  Routes parsing (regex-based for routes.rb)                          */
/* ------------------------------------------------------------------ */

function parseRoutes(source: string): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const httpMatch = trimmed.match(
      /^(get|post|put|patch|delete)\s+['":\/]([^\s,'"]+)['"]*(?:.*?to:\s*['"]([^'"]+)['"])?/,
    );
    if (httpMatch) {
      const [, method, rawPath, target] = httpMatch;
      const route: RouteInfo = {
        method: method.toUpperCase(),
        path: rawPath.startsWith("/") ? rawPath : `/${rawPath}`,
      };
      if (target?.includes("#")) {
        const [controller, action] = target.split("#");
        route.controller = controller;
        route.action = action;
      }
      routes.push(route);
      continue;
    }

    const matchMatch = trimmed.match(
      /^match\s+['"]([^'"]+)['"]\s*(?:.*?to:\s*['"]([^'"]+)['"])?(?:.*?via:\s*\[?:(\w+)\]?)?/,
    );
    if (matchMatch) {
      const [, path, target, via] = matchMatch;
      const route: RouteInfo = {
        method: via?.toUpperCase() ?? "ANY",
        path: path.startsWith("/") ? path : `/${path}`,
      };
      if (target?.includes("#")) {
        const [controller, action] = target.split("#");
        route.controller = controller;
        route.action = action;
      }
      routes.push(route);
      continue;
    }

    const rootMatch = trimmed.match(
      /^root\s+(?:to:\s*)?['"]([^'"]+)['"]/,
    );
    if (rootMatch) {
      const [, target] = rootMatch;
      const route: RouteInfo = { method: "GET", path: "/" };
      if (target.includes("#")) {
        const [controller, action] = target.split("#");
        route.controller = controller;
        route.action = action;
      }
      routes.push(route);
      continue;
    }

    const resourceMatch = trimmed.match(
      /^resources?\s+:(\w+)(?:.*?path:\s*['"]([^'"]+)['"])?/,
    );
    if (resourceMatch) {
      const [, name, customPath] = resourceMatch;
      routes.push({
        method: "RESOURCES",
        path: customPath
          ? `/${customPath.replace(/^\//, "")}`
          : `/${name}`,
        controller: name,
      });
      continue;
    }

    const nsMatch = trimmed.match(/^namespace\s+:(\w+)/);
    if (nsMatch) {
      routes.push({ method: "NAMESPACE", path: `/${nsMatch[1]}` });
    }
  }

  return routes;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

export const rubyParser: LanguageParser = {
  id: "ruby",
  name: "Ruby",
  extensions: [".rb", ".rake", ".gemspec"],

  parse(content: string, filePath: string): Partial<ParsedFile> {
    const isRoutes =
      filePath.endsWith("routes.rb") || filePath.includes("/routes/");

    const result = parseRubySource(content, filePath);

    if (isRoutes) {
      result.routes = parseRoutes(content);
    }

    return result;
  },
};
