/* ------------------------------------------------------------------ */
/*  Domain types — shared across all indexer modules                    */
/*                                                                     */
/*  Superset of the original tree-sitter.ts interfaces.                */
/*  Every consumer (graph-builder, flow-detector, card-generator)      */
/*  can import from here without any breaking changes.                 */
/* ------------------------------------------------------------------ */

export type FileRole =
  | "domain"        // production code that belongs to a domain flow
  | "test"          // test, spec, fixture, e2e — indexed but excluded from graph
  | "entry_point"   // root files (App, index, main) — high degree but no domain meaning
  | "shared_utility"// polymorphic/generic utilities used across many domains
  | "config";       // config files — indexed but excluded from graph

export interface ParsedFile {
  path: string;
  repo: string;
  language:
    | "ruby"
    | "javascript"
    | "typescript"
    | "vue"
    | "python"
    | "go"
    | "java"
    | "php"
    | "elixir"
    | "rust"
    | "csharp";
  fileRole: FileRole;
  classes: ClassInfo[];
  associations: Association[];
  routes: RouteInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  functions: FunctionInfo[];
  apiCalls: ApiCallInfo[];
  storeUsages: string[];
  callbacks: string[];
  validations: string[];
}

export interface ClassInfo {
  name: string;
  parent?: string;
  type:
    | "model"
    | "controller"
    | "job"
    | "service"
    | "component"
    | "store"
    | "middleware"
    | "serializer"
    | "migration"
    | "test"
    | "helper"
    | "concern"
    | "decorator"
    | "module"
    | "other";
}

export interface Association {
  type:
    | "has_many"
    | "belongs_to"
    | "has_one"
    | "has_and_belongs_to_many"
    | "ForeignKey"
    | "ManyToManyField"
    | "OneToOneField";
  name: string;
  target_model?: string;
  options?: string;
}

export interface RouteInfo {
  method: string;
  path: string;
  controller?: string;
  action?: string;
}

export interface ImportInfo {
  name: string;
  source: string;
  isDefault: boolean;
}

export interface ExportInfo {
  name: string;
  isDefault: boolean;
}

export interface FunctionInfo {
  name: string;
  visibility: "public" | "private" | "protected";
  isAsync: boolean;
}

export interface ApiCallInfo {
  method: string;
  path?: string;
  variable?: string;
}

/* ------------------------------------------------------------------ */
/*  Plugin interfaces                                                  */
/* ------------------------------------------------------------------ */

/** A language-specific parser that converts source text into structural data. */
export interface LanguageParser {
  /** Language identifier (must be unique across registered parsers). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** File extensions this parser handles (e.g. `['.rb', '.rake']`). */
  extensions: string[];
  /** Parse file content and return partial `ParsedFile` data. */
  parse(content: string, filePath: string): Partial<ParsedFile>;
}

/**
 * A framework-aware post-processor that enriches parsed data with
 * conventions specific to a framework (e.g. Rails, Django, Next.js).
 */
export interface FrameworkExtractor {
  /** Extractor identifier (must be unique). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Language parser IDs this extractor is compatible with. */
  languages: string[];
  /** Detect whether this framework is present given a list of project files. */
  detect(files: string[]): boolean;
  /** Enrich a parsed file with framework-specific conventions. */
  enhance(parsed: ParsedFile): ParsedFile;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Creates a `ParsedFile` with every array field initialised to `[]`. */
export function emptyParsedFile(
  path: string,
  repo: string,
  language: ParsedFile["language"],
): ParsedFile {
  return {
    path,
    repo,
    language,
    fileRole: "domain",
    classes: [],
    associations: [],
    routes: [],
    imports: [],
    exports: [],
    functions: [],
    apiCalls: [],
    storeUsages: [],
    callbacks: [],
    validations: [],
  };
}
