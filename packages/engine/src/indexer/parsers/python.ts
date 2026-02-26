import type {
  LanguageParser,
  ParsedFile,
  ClassInfo,
  FunctionInfo,
  ImportInfo,
  RouteInfo,
} from "../types.js";

/* ------------------------------------------------------------------ */
/*  Regex patterns                                                     */
/* ------------------------------------------------------------------ */

const CLASS_RE =
  /^(?<indent> *)class\s+(?<name>\w+)\s*(?:\((?<parents>[^)]*)\))?\s*:/gm;

const FUNC_RE =
  /^(?<indent> *)(?<async>async\s+)?def\s+(?<name>\w+)\s*\(/gm;

const DECORATOR_RE = /^(?<indent> *)@(?<name>[\w.]+(?:\([^)]*\))?)\s*$/gm;

const IMPORT_PLAIN_RE = /^import\s+(?<module>[\w.]+)/gm;

const IMPORT_FROM_RE =
  /^from\s+(?<module>[\w.]+)\s+import\s+(?<names>.+)/gm;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function classifyByPath(filePath: string): ClassInfo["type"] {
  const p = filePath.replace(/\\/g, "/");

  if (/\/models\/|\/models\.py$/.test(p)) return "model";
  if (/\/views\/|\/views\.py$/.test(p)) return "controller";
  if (/\/serializers\//.test(p)) return "serializer";
  if (/\/middleware\//.test(p)) return "middleware";
  if (/\/tests\/|\/test_[^/]*\.py$/.test(p)) return "test";
  if (/\/migrations\//.test(p)) return "migration";

  return "other";
}

function visibility(name: string): FunctionInfo["visibility"] {
  if (name.startsWith("__") && !name.endsWith("__")) return "private";
  if (name.startsWith("_")) return "private";
  return "public";
}

/**
 * Collect all decorators from the source, keyed by the line number of the
 * decorator. We later match them to the definition that follows.
 */
function collectDecorators(
  content: string,
): Map<number, string[]> {
  const map = new Map<number, string[]>();
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*@([\w.]+)/.exec(lines[i]);
    if (m) {
      let target = i + 1;
      while (target < lines.length && /^\s*@/.test(lines[target])) {
        target++;
      }
      const existing = map.get(target) ?? [];
      existing.push(m[1]);
      map.set(target, existing);
    }
  }

  return map;
}

function lineOfOffset(content: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/* ------------------------------------------------------------------ */
/*  Parser                                                             */
/* ------------------------------------------------------------------ */

function parse(
  content: string,
  filePath: string,
): Partial<ParsedFile> {
  const classes: ClassInfo[] = [];
  const functions: FunctionInfo[] = [];
  const imports: ImportInfo[] = [];
  const fileType = classifyByPath(filePath);
  const decoratorMap = collectDecorators(content);

  /* --- Classes ---------------------------------------------------- */
  CLASS_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CLASS_RE.exec(content)) !== null) {
    const name = match.groups!.name;
    const parents = match.groups!.parents?.trim();
    const parent = parents?.split(",")[0]?.trim() || undefined;
    const type: ClassInfo["type"] = fileType !== "other" ? fileType : "other";

    classes.push({ name, parent, type });
  }

  /* --- Functions / methods ---------------------------------------- */
  FUNC_RE.lastIndex = 0;

  while ((match = FUNC_RE.exec(content)) !== null) {
    const name = match.groups!.name;
    const isAsync = match.groups!.async !== undefined;
    const line = lineOfOffset(content, match.index);
    const decorators = decoratorMap.get(line) ?? [];

    const fnName =
      decorators.length > 0
        ? `${name} ${decorators.map((d) => `decorator:${d}`).join(" ")}`
        : name;

    functions.push({
      name: fnName,
      visibility: visibility(name),
      isAsync,
    });
  }

  /* --- Imports: `import module` ----------------------------------- */
  IMPORT_PLAIN_RE.lastIndex = 0;

  while ((match = IMPORT_PLAIN_RE.exec(content)) !== null) {
    imports.push({
      name: match.groups!.module,
      source: match.groups!.module,
      isDefault: true,
    });
  }

  /* --- Imports: `from module import name [as alias], ...` --------- */
  IMPORT_FROM_RE.lastIndex = 0;

  while ((match = IMPORT_FROM_RE.exec(content)) !== null) {
    const source = match.groups!.module;
    const names = match.groups!.names;

    for (const part of names.split(",")) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === "\\") continue;

      const asMatch = /^(\w+)\s+as\s+(\w+)$/.exec(trimmed);
      const importName = asMatch ? asMatch[2] : trimmed.split(/\s/)[0];

      imports.push({
        name: importName,
        source,
        isDefault: false,
      });
    }
  }

  /* --- Routes: @app.route('/path') / @app.get('/path') --------------- */
  const routes: RouteInfo[] = [];
  const ROUTE_DECORATOR_RE = /^\s*@\w+\.(route|get|post|put|patch|delete|head|options)\(\s*['"]([^'"]+)['"]/gm;
  ROUTE_DECORATOR_RE.lastIndex = 0;

  while ((match = ROUTE_DECORATOR_RE.exec(content)) !== null) {
    const method = match[1] === "route" ? "GET" : match[1].toUpperCase();
    routes.push({ method, path: match[2] });
  }

  return {
    language: "python",
    classes,
    functions,
    imports,
    routes,
  };
}

/** Regex-based Python language parser (no tree-sitter dependency). */
export const pythonParser: LanguageParser = {
  id: "python",
  name: "Python (regex)",
  extensions: [".py", ".pyi"],
  parse,
};
