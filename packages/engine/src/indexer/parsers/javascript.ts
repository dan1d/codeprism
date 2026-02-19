import { createRequire } from "node:module";
import type Parser from "tree-sitter";
import type {
  LanguageParser,
  ParsedFile,
  ImportInfo,
  ExportInfo,
  FunctionInfo,
  ApiCallInfo,
  ClassInfo,
} from "../types.js";

const require = createRequire(import.meta.url);
const TreeSitter: typeof Parser = require("tree-sitter");
const JavaScript: unknown = require("tree-sitter-javascript");
const TreeSitterTypescript: { typescript: unknown; tsx: unknown } =
  require("tree-sitter-typescript");

/* ------------------------------------------------------------------ */
/*  Parser singletons                                                  */
/* ------------------------------------------------------------------ */

function makeParser(language: unknown): Parser {
  const p = new TreeSitter();
  p.setLanguage(language as Parser.Language);
  return p;
}

const jsParser = makeParser(JavaScript);
const tsParser = makeParser(TreeSitterTypescript.typescript);
const tsxParser = makeParser(TreeSitterTypescript.tsx);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "destroy",
]);

const METHOD_MAP: Record<string, string> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
  destroy: "DELETE",
  head: "HEAD",
  options: "OPTIONS",
};

function stripQuotes(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, "");
}

function stringValue(
  node: Parser.SyntaxNode | null | undefined,
): string | undefined {
  if (!node) return undefined;
  if (node.type === "string" || node.type === "string_fragment")
    return stripQuotes(node.text);
  if (node.type === "template_string")
    return node.text.replace(/^`|`$/g, "");
  return undefined;
}

function findPropertyStringValue(
  obj: Parser.SyntaxNode,
  key: string,
): string | undefined {
  for (const pair of obj.descendantsOfType("pair")) {
    const k = pair.childForFieldName("key");
    if (!k) continue;
    const kText =
      k.type === "property_identifier" ? k.text : stripQuotes(k.text);
    if (kText === key) {
      const v = pair.childForFieldName("value");
      return v ? stripQuotes(v.text) : undefined;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Import extraction                                                  */
/* ------------------------------------------------------------------ */

function extractImports(root: Parser.SyntaxNode): ImportInfo[] {
  const imports: ImportInfo[] = [];

  for (const stmt of root.descendantsOfType("import_statement")) {
    const strings = stmt.descendantsOfType("string");
    const source = strings.length > 0 ? stripQuotes(strings[0].text) : "";

    const importClause = stmt.namedChildren.find(
      (c) => c.type === "import_clause",
    );

    if (!importClause) {
      if (source) imports.push({ name: source, source, isDefault: false });
      continue;
    }

    for (const child of importClause.children) {
      if (child.type === "identifier") {
        imports.push({ name: child.text, source, isDefault: true });
        break;
      }
    }

    for (const specifier of importClause.descendantsOfType(
      "import_specifier",
    )) {
      const alias = specifier.childForFieldName("alias");
      const name = specifier.childForFieldName("name");
      imports.push({
        name: alias?.text ?? name?.text ?? specifier.text,
        source,
        isDefault: false,
      });
    }

    for (const ns of importClause.descendantsOfType("namespace_import")) {
      const ident = ns.namedChildren.find((c) => c.type === "identifier");
      imports.push({ name: ident?.text ?? "*", source, isDefault: false });
    }
  }

  return imports;
}

/* ------------------------------------------------------------------ */
/*  Export extraction                                                   */
/* ------------------------------------------------------------------ */

function extractExports(root: Parser.SyntaxNode): ExportInfo[] {
  const exports: ExportInfo[] = [];

  for (const stmt of root.descendantsOfType("export_statement")) {
    const isDefault = stmt.children.some((c) => c.type === "default");
    let found = false;

    for (const child of stmt.namedChildren) {
      if (
        child.type === "function_declaration" ||
        child.type === "generator_function_declaration"
      ) {
        exports.push({
          name: child.childForFieldName("name")?.text ?? "default",
          isDefault,
        });
        found = true;
        break;
      }

      if (child.type === "class_declaration") {
        exports.push({
          name: child.childForFieldName("name")?.text ?? "default",
          isDefault,
        });
        found = true;
        break;
      }

      if (
        child.type === "lexical_declaration" ||
        child.type === "variable_declaration"
      ) {
        for (const decl of child.descendantsOfType("variable_declarator")) {
          const name = decl.childForFieldName("name");
          if (name) {
            exports.push({ name: name.text, isDefault });
            found = true;
          }
        }
        if (found) break;
      }

      if (child.type === "export_clause") {
        for (const spec of child.descendantsOfType("export_specifier")) {
          const name = spec.childForFieldName("name");
          exports.push({ name: name?.text ?? spec.text, isDefault: false });
          found = true;
        }
        if (found) break;
      }
    }

    if (!found && isDefault) {
      const value = stmt.namedChildren.find((c) => c.type !== "comment");
      if (value?.type === "identifier") {
        exports.push({ name: value.text, isDefault: true });
      } else if (value?.type === "call_expression") {
        const fn = value.childForFieldName("function");
        exports.push({ name: fn?.text ?? "default", isDefault: true });
      } else {
        exports.push({ name: "default", isDefault: true });
      }
    }
  }

  return exports;
}

/* ------------------------------------------------------------------ */
/*  Function extraction (top-level only)                               */
/* ------------------------------------------------------------------ */

function collectTopLevelFunctions(
  node: Parser.SyntaxNode,
  out: FunctionInfo[],
): void {
  if (
    node.type === "function_declaration" ||
    node.type === "generator_function_declaration"
  ) {
    out.push({
      name: node.childForFieldName("name")?.text ?? "anonymous",
      visibility: "public",
      isAsync: node.children.some((c) => c.type === "async"),
    });
    return;
  }

  if (
    node.type === "lexical_declaration" ||
    node.type === "variable_declaration"
  ) {
    for (const declarator of node.descendantsOfType("variable_declarator")) {
      const name = declarator.childForFieldName("name");
      const value = declarator.childForFieldName("value");
      if (
        value &&
        (value.type === "arrow_function" ||
          value.type === "function_expression" ||
          value.type === "function")
      ) {
        out.push({
          name: name?.text ?? "anonymous",
          visibility: "public",
          isAsync: value.children.some((c) => c.type === "async"),
        });
      }
    }
  }
}

function extractFunctions(root: Parser.SyntaxNode): FunctionInfo[] {
  const functions: FunctionInfo[] = [];

  for (const child of root.namedChildren) {
    collectTopLevelFunctions(child, functions);

    if (child.type === "export_statement") {
      for (const inner of child.namedChildren) {
        collectTopLevelFunctions(inner, functions);
      }
    }
  }

  return functions;
}

/* ------------------------------------------------------------------ */
/*  API call detection                                                 */
/* ------------------------------------------------------------------ */

function extractApiCalls(root: Parser.SyntaxNode): ApiCallInfo[] {
  const calls: ApiCallInfo[] = [];

  for (const callExpr of root.descendantsOfType("call_expression")) {
    const func = callExpr.childForFieldName("function");
    if (!func) continue;

    if (func.type === "identifier" && func.text === "fetch") {
      const args = callExpr.childForFieldName("arguments");
      const firstArg = args?.namedChildren[0];
      calls.push({
        method: "FETCH",
        path: stringValue(firstArg),
        variable: "fetch",
      });
      continue;
    }

    if (func.type === "member_expression") {
      const prop = func.childForFieldName("property");
      const obj = func.childForFieldName("object");
      if (prop && HTTP_METHODS.has(prop.text)) {
        const args = callExpr.childForFieldName("arguments");
        const firstArg = args?.namedChildren[0];
        calls.push({
          method: METHOD_MAP[prop.text] ?? prop.text.toUpperCase(),
          path: stringValue(firstArg),
          variable: obj?.text,
        });
      }
    }
  }

  return calls;
}

/* ------------------------------------------------------------------ */
/*  Store / slice / component detection                                */
/* ------------------------------------------------------------------ */

function extractStoreInfo(root: Parser.SyntaxNode): {
  storeUsages: string[];
  sliceName?: string;
} {
  const storeUsages: string[] = [];
  let sliceName: string | undefined;

  for (const callExpr of root.descendantsOfType("call_expression")) {
    const func = callExpr.childForFieldName("function");
    if (!func || func.type !== "identifier") continue;

    if (func.text === "createSlice") {
      const args = callExpr.childForFieldName("arguments");
      const obj = args?.namedChildren.find((c) => c.type === "object");
      if (obj) sliceName = findPropertyStringValue(obj, "name");
    }

    if (func.text === "defineStore") {
      const args = callExpr.childForFieldName("arguments");
      const firstArg = args?.namedChildren[0];
      sliceName = stringValue(firstArg);
    }

    if (/^use\w+Store$/.test(func.text)) {
      storeUsages.push(func.text);
    }
  }

  return { storeUsages, sliceName };
}

function extractComponentName(
  root: Parser.SyntaxNode,
): string | undefined {
  for (const callExpr of root.descendantsOfType("call_expression")) {
    const func = callExpr.childForFieldName("function");
    if (func?.type === "identifier" && func.text === "defineComponent") {
      const args = callExpr.childForFieldName("arguments");
      const obj = args?.namedChildren.find((c) => c.type === "object");
      if (obj) return findPropertyStringValue(obj, "name");
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Class extraction                                                   */
/* ------------------------------------------------------------------ */

function classifyJsType(
  filePath: string,
  superclass?: string,
): ClassInfo["type"] {
  if (filePath.includes("/component") || superclass?.includes("Component"))
    return "component";
  if (filePath.includes("/store") || filePath.includes("/slice"))
    return "store";
  return "other";
}

function extractJsClasses(
  root: Parser.SyntaxNode,
  filePath: string,
): ClassInfo[] {
  const classes: ClassInfo[] = [];

  for (const classNode of root.descendantsOfType("class_declaration")) {
    const nameNode = classNode.childForFieldName("name");
    const heritage = classNode.namedChildren.find(
      (c) => c.type === "class_heritage",
    );
    const parent = heritage?.namedChildren[0]?.text;

    classes.push({
      name: nameNode?.text ?? "",
      parent,
      type: classifyJsType(filePath, parent),
    });
  }

  return classes;
}

/* ------------------------------------------------------------------ */
/*  Combined AST extraction                                            */
/* ------------------------------------------------------------------ */

function parseJsTree(
  root: Parser.SyntaxNode,
  filePath: string,
): Partial<ParsedFile> {
  const imports = extractImports(root);
  const xports = extractExports(root);
  const functions = extractFunctions(root);
  const apiCalls = extractApiCalls(root);
  const classes = extractJsClasses(root, filePath);
  const { storeUsages, sliceName } = extractStoreInfo(root);
  const componentName = extractComponentName(root);

  if (sliceName && !classes.some((c) => c.name === sliceName)) {
    classes.push({ name: sliceName, type: "store" });
  }
  if (componentName && !classes.some((c) => c.name === componentName)) {
    classes.push({ name: componentName, type: "component" });
  }

  return {
    imports,
    exports: xports,
    functions,
    apiCalls,
    classes,
    storeUsages,
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

function parserForPath(filePath: string): Parser {
  if (filePath.endsWith(".tsx")) return tsxParser;
  if (filePath.endsWith(".ts") || filePath.endsWith(".mts")) return tsParser;
  return jsParser;
}

/**
 * Parse JS/TS source content and return structural data.
 * Exposed for reuse by the Vue SFC parser.
 */
export function parseJsSource(
  content: string,
  filePath: string,
  lang: "js" | "ts" | "tsx",
): Partial<ParsedFile> {
  const parser =
    lang === "tsx" ? tsxParser : lang === "ts" ? tsParser : jsParser;
  const tree = parser.parse(content);
  return parseJsTree(tree.rootNode, filePath);
}

export const javascriptParser: LanguageParser = {
  id: "javascript",
  name: "JavaScript / TypeScript",
  extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts"],

  parse(content: string, filePath: string): Partial<ParsedFile> {
    const tree = parserForPath(filePath).parse(content);
    return parseJsTree(tree.rootNode, filePath);
  },
};
