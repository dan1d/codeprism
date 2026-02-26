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

const FUNC_RE =
  /^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(/gm;

const SINGLE_IMPORT_RE = /^import\s+"(?<pkg>[^"]+)"/gm;

const BLOCK_IMPORT_RE = /^import\s*\(([^)]*)\)/gms;
const IMPORT_LINE_RE = /(?:(?<alias>\w+)\s+)?"(?<pkg>[^"]+)"/g;

const STRUCT_RE = /^type\s+(?<name>\w+)\s+struct\s*\{/gm;

const INTERFACE_RE = /^type\s+(?<name>\w+)\s+interface\s*\{/gm;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function classifyByPath(filePath: string): ClassInfo["type"] {
  const p = filePath.replace(/\\/g, "/");

  if (/\/handlers\/|\/controllers\//.test(p)) return "controller";
  if (/\/models\/|\/entities\//.test(p)) return "model";
  if (/\/middleware\//.test(p)) return "middleware";
  if (/\/services\//.test(p)) return "service";
  if (/_test\.go$/.test(p)) return "test";

  return "other";
}

function goVisibility(name: string): FunctionInfo["visibility"] {
  if (name.length === 0) return "private";
  return name[0] === name[0].toUpperCase() ? "public" : "private";
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

  let match: RegExpExecArray | null;

  /* --- Structs ---------------------------------------------------- */
  STRUCT_RE.lastIndex = 0;

  while ((match = STRUCT_RE.exec(content)) !== null) {
    classes.push({
      name: match.groups!.name,
      type: fileType !== "other" ? fileType : "other",
    });
  }

  /* --- Interfaces ------------------------------------------------- */
  INTERFACE_RE.lastIndex = 0;

  while ((match = INTERFACE_RE.exec(content)) !== null) {
    classes.push({
      name: match.groups!.name,
      type: "other",
    });
  }

  /* --- Functions / methods ---------------------------------------- */
  FUNC_RE.lastIndex = 0;

  while ((match = FUNC_RE.exec(content)) !== null) {
    const receiver = match[2];
    const name = match[3];

    functions.push({
      name: receiver ? `${receiver}.${name}` : name,
      visibility: goVisibility(name),
      isAsync: false,
    });
  }

  /* --- Single-line imports ---------------------------------------- */
  SINGLE_IMPORT_RE.lastIndex = 0;

  while ((match = SINGLE_IMPORT_RE.exec(content)) !== null) {
    const pkg = match.groups!.pkg;
    const shortName = pkg.split("/").pop()!;

    imports.push({
      name: shortName,
      source: pkg,
      isDefault: true,
    });
  }

  /* --- Block imports ---------------------------------------------- */
  BLOCK_IMPORT_RE.lastIndex = 0;

  while ((match = BLOCK_IMPORT_RE.exec(content)) !== null) {
    const block = match[1];
    IMPORT_LINE_RE.lastIndex = 0;
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = IMPORT_LINE_RE.exec(block)) !== null) {
      const pkg = lineMatch.groups!.pkg;
      const alias = lineMatch.groups!.alias;
      const shortName = alias ?? pkg.split("/").pop()!;

      imports.push({
        name: shortName,
        source: pkg,
        isDefault: false,
      });
    }
  }

  /* --- Routes: r.GET("/path", handler) / e.POST("/path", handler) ---- */
  const routes: RouteInfo[] = [];
  const GO_ROUTE_RE = /\.\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any|Use)\s*\(\s*"([^"]+)"/gm;

  while ((match = GO_ROUTE_RE.exec(content)) !== null) {
    const method = match[1] === "Any" ? "ANY" : match[1] === "Use" ? "USE" : match[1];
    routes.push({ method, path: match[2] });
  }

  return {
    language: "go",
    classes,
    functions,
    imports,
    routes,
  };
}

/** Regex-based Go language parser (no tree-sitter dependency). */
export const goParser: LanguageParser = {
  id: "go",
  name: "Go (regex)",
  extensions: [".go"],
  parse,
};
