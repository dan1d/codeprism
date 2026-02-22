import type {
  LanguageParser,
  FrameworkExtractor,
  ParsedFile,
} from "./types.js";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { glob } from "glob";
import { emptyParsedFile } from "./types.js";
import { classifyFileRole, applyGraphRoles, computeInboundDegrees, type RepoConfig } from "./file-classifier.js";

const SKIP_PATTERNS = [
  "**/node_modules/**",
  "**/vendor/**",
  "**/dist/**",
  "**/.git/**",
];

const BATCH_SIZE = 50;

export class ParserRegistry {
  private parsers = new Map<string, LanguageParser>();
  private extractors: FrameworkExtractor[] = [];
  private extensionMap = new Map<string, LanguageParser>();
  private activeExtractors: FrameworkExtractor[] = [];

  /** Register a language parser and index its file extensions. */
  registerParser(parser: LanguageParser): void {
    this.parsers.set(parser.id, parser);
    for (const ext of parser.extensions) {
      this.extensionMap.set(ext, parser);
    }
  }

  /** Register a framework extractor for later detection. */
  registerExtractor(extractor: FrameworkExtractor): void {
    this.extractors.push(extractor);
  }

  /**
   * Scan `rootPaths` for files and run each registered extractor's `detect`
   * method. Active extractors are stored for use during parsing.
   *
   * @returns IDs of the extractors that matched.
   */
  async detectFrameworks(rootPaths: string[]): Promise<string[]> {
    const allFiles: string[] = [];

    for (const root of rootPaths) {
      const files = await glob("**/*", {
        cwd: root,
        absolute: true,
        ignore: SKIP_PATTERNS,
        nodir: true,
      });
      allFiles.push(...files);
    }

    this.activeExtractors = this.extractors.filter((ext) => {
      const hasMatchingParser = ext.languages.some((lang) =>
        this.parsers.has(lang),
      );
      return hasMatchingParser && ext.detect(allFiles);
    });

    return this.activeExtractors.map((e) => e.id);
  }

  /**
   * Parse a single file. The appropriate language parser is selected by file
   * extension. Active framework extractors are applied in registration order.
   * File role is classified immediately after parsing.
   */
  async parseFile(filePath: string, repo: string, repoConfig?: RepoConfig): Promise<ParsedFile> {
    const ext = extname(filePath);
    const parser = this.extensionMap.get(ext);

    if (!parser) {
      const pf = emptyParsedFile(filePath, repo, languageFromExt(ext));
      pf.fileRole = classifyFileRole(filePath, pf, repoConfig);
      return pf;
    }

    let source: string;
    try {
      source = await readFile(filePath, "utf-8");
    } catch {
      const pf = emptyParsedFile(filePath, repo, parser.id as ParsedFile["language"]);
      pf.fileRole = classifyFileRole(filePath, pf, repoConfig);
      return pf;
    }

    const partial = parser.parse(source, filePath);
    let result: ParsedFile = {
      ...emptyParsedFile(filePath, repo, parser.id as ParsedFile["language"]),
      ...partial,
      path: filePath,
      repo,
    };

    for (const extractor of this.activeExtractors) {
      if (extractor.languages.includes(parser.id)) {
        result = extractor.enhance(result);
      }
    }

    // First-pass role classification (path + content signals)
    result.fileRole = classifyFileRole(filePath, result, repoConfig);

    return result;
  }

  /**
   * Recursively parse every supported file under `dirPath`.
   * Skips `node_modules`, `vendor`, `dist`, and `.git`. Files are
   * processed in batches of {@link BATCH_SIZE} for backpressure control.
   * After parsing, applies graph-based role promotion (entry_point by
   * inbound import degree, shared_utility by polymorphic associations).
   */
  async parseDirectory(
    dirPath: string,
    repo: string,
    repoConfig?: RepoConfig,
  ): Promise<ParsedFile[]> {
    const extensions = this.getSupportedExtensions();
    if (extensions.length === 0) return [];

    const pattern = `**/*{${extensions.join(",")}}`;

    const files = await glob(pattern, {
      cwd: dirPath,
      absolute: true,
      ignore: SKIP_PATTERNS,
    });

    const results: ParsedFile[] = [];

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const parsed = await Promise.all(
        batch.map((f) => this.parseFile(f, repo, repoConfig).catch(() => null)),
      );
      for (const p of parsed) {
        if (p) results.push(p);
      }
    }

    // Second-pass: promote by graph degree (entry_point, shared_utility)
    const { inboundImport } = computeInboundDegrees(results);
    applyGraphRoles(results, inboundImport, new Map());

    return results;
  }

  /** All file extensions handled by registered parsers. */
  getSupportedExtensions(): string[] {
    return [...this.extensionMap.keys()];
  }

  /** All registered language parsers. */
  getRegisteredParsers(): LanguageParser[] {
    return [...this.parsers.values()];
  }

  /** Extractors that matched during the last `detectFrameworks` call. */
  getActiveExtractors(): FrameworkExtractor[] {
    return [...this.activeExtractors];
  }
}

/**
 * Best-effort language tag when no parser is registered for the extension.
 * Falls back to `"javascript"` to preserve the original behaviour of
 * `tree-sitter.ts`.
 */
function languageFromExt(ext: string): ParsedFile["language"] {
  switch (ext) {
    case ".rb":
    case ".rake":
      return "ruby";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".java":
      return "java";
    case ".php":
      return "php";
    case ".ex":
    case ".exs":
      return "elixir";
    case ".rs":
      return "rust";
    case ".cs":
      return "csharp";
    case ".vue":
      return "vue";
    case ".ts":
    case ".tsx":
      return "typescript";
    default:
      return "javascript";
  }
}

export const registry = new ParserRegistry();
