import type {
  LanguageParser,
  ParsedFile,
  ImportInfo,
  ExportInfo,
  FunctionInfo,
  ApiCallInfo,
  ClassInfo,
} from "../types.js";
import { parseJsSource } from "./javascript.js";

/* ------------------------------------------------------------------ */
/*  Regex patterns                                                     */
/* ------------------------------------------------------------------ */

const SCRIPT_BLOCK_RE = /<script(\s[^>]*)?>([^]*?)<\/script>/gi;
const TEMPLATE_BLOCK_RE = /<template[^>]*>([^]*?)<\/template>/i;
const LANG_TS_RE = /\blang\s*=\s*["'](ts|typescript)["']/i;

/** Matches PascalCase component tags (e.g. `<MyComponent`, `<RouterView`). */
const COMPONENT_TAG_RE = /<([A-Z][a-zA-Z0-9]+)/g;

/** Matches v-model bindings (e.g. `v-model="form.name"`, `v-model:title="val"`). */
const VMODEL_RE = /v-model(?::([a-zA-Z]+))?\s*=\s*"([^"]+)"/g;

/** Matches event handlers (e.g. `@click="handler"`, `v-on:submit="onSubmit"`). */
const EVENT_RE = /(?:@|v-on:)([a-zA-Z.-]+)\s*=\s*"([^"]+)"/g;

/* ------------------------------------------------------------------ */
/*  Script block extraction                                            */
/* ------------------------------------------------------------------ */

interface ScriptBlock {
  content: string;
  isTs: boolean;
}

function extractScriptBlocks(source: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  let match: RegExpExecArray | null;

  SCRIPT_BLOCK_RE.lastIndex = 0;
  while ((match = SCRIPT_BLOCK_RE.exec(source)) !== null) {
    const attrs = match[1] ?? "";
    const content = match[2] ?? "";
    blocks.push({
      content,
      isTs: LANG_TS_RE.test(attrs),
    });
  }

  return blocks;
}

/* ------------------------------------------------------------------ */
/*  Template-level extraction                                          */
/* ------------------------------------------------------------------ */

interface TemplateInfo {
  componentUsages: string[];
  vModelBindings: string[];
  eventHandlers: string[];
}

function extractTemplateInfo(source: string): TemplateInfo {
  const templateMatch = TEMPLATE_BLOCK_RE.exec(source);
  const template = templateMatch?.[1] ?? "";

  const componentUsages: string[] = [];
  const vModelBindings: string[] = [];
  const eventHandlers: string[] = [];

  let m: RegExpExecArray | null;

  COMPONENT_TAG_RE.lastIndex = 0;
  while ((m = COMPONENT_TAG_RE.exec(template)) !== null) {
    const name = m[1];
    if (!componentUsages.includes(name)) {
      componentUsages.push(name);
    }
  }

  VMODEL_RE.lastIndex = 0;
  while ((m = VMODEL_RE.exec(template)) !== null) {
    vModelBindings.push(m[2]);
  }

  EVENT_RE.lastIndex = 0;
  while ((m = EVENT_RE.exec(template)) !== null) {
    const handler = m[2].replace(/\(.*\)$/, "");
    if (!eventHandlers.includes(handler)) {
      eventHandlers.push(handler);
    }
  }

  return { componentUsages, vModelBindings, eventHandlers };
}

/* ------------------------------------------------------------------ */
/*  Merge helper                                                       */
/* ------------------------------------------------------------------ */

function mergePartials(
  parts: Partial<ParsedFile>[],
): Partial<ParsedFile> {
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];
  const functions: FunctionInfo[] = [];
  const apiCalls: ApiCallInfo[] = [];
  const classes: ClassInfo[] = [];
  const storeUsages: string[] = [];

  for (const p of parts) {
    if (p.imports) imports.push(...p.imports);
    if (p.exports) exports.push(...p.exports);
    if (p.functions) functions.push(...p.functions);
    if (p.apiCalls) apiCalls.push(...p.apiCalls);
    if (p.classes) classes.push(...p.classes);
    if (p.storeUsages) storeUsages.push(...p.storeUsages);
  }

  return { imports, exports, functions, apiCalls, classes, storeUsages };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export const vueParser: LanguageParser = {
  id: "vue",
  name: "Vue Single File Component",
  extensions: [".vue"],

  parse(content: string, filePath: string): Partial<ParsedFile> {
    const scriptBlocks = extractScriptBlocks(content);
    const parts: Partial<ParsedFile>[] = [];

    for (const block of scriptBlocks) {
      const lang = block.isTs ? "ts" : "js";
      parts.push(parseJsSource(block.content, filePath, lang));
    }

    const merged = mergePartials(parts);

    const templateInfo = extractTemplateInfo(content);
    const storeUsages = merged.storeUsages ?? [];
    for (const comp of templateInfo.componentUsages) {
      if (!storeUsages.includes(comp)) {
        storeUsages.push(comp);
      }
    }
    merged.storeUsages = storeUsages;

    const classes = merged.classes ?? [];
    const componentName =
      filePath
        .split("/")
        .pop()
        ?.replace(/\.vue$/, "") ?? "UnknownComponent";

    if (!classes.some((c) => c.type === "component")) {
      classes.push({ name: componentName, type: "component" });
    }
    merged.classes = classes;

    return merged;
  },
};
