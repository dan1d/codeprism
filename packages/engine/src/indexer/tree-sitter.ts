/**
 * Entry point for the codeprism indexer.
 *
 * Re-exports all types from types.ts and exposes parseFile / parseDirectory
 * via the ParserRegistry, with all built-in parsers and extractors registered.
 */

export type {
  ParsedFile,
  ClassInfo,
  Association,
  RouteInfo,
  ImportInfo,
  ExportInfo,
  FunctionInfo,
  ApiCallInfo,
  LanguageParser,
  FrameworkExtractor,
} from "./types.js";

export { emptyParsedFile } from "./types.js";

import { registry } from "./parser-registry.js";

import { rubyParser } from "./parsers/ruby.js";
import { javascriptParser } from "./parsers/javascript.js";
import { vueParser } from "./parsers/vue.js";
import { pythonParser } from "./parsers/python.js";
import { goParser } from "./parsers/go.js";

import { railsExtractor } from "./extractors/rails.js";
import { reactExtractor } from "./extractors/react.js";
import { djangoExtractor } from "./extractors/django.js";
import { expressExtractor } from "./extractors/express.js";

registry.registerParser(rubyParser);
registry.registerParser(javascriptParser);
registry.registerParser(vueParser);
registry.registerParser(pythonParser);
registry.registerParser(goParser);

registry.registerExtractor(railsExtractor);
registry.registerExtractor(reactExtractor);
registry.registerExtractor(djangoExtractor);
registry.registerExtractor(expressExtractor);

export const parseFile = registry.parseFile.bind(registry);
export const parseVirtualFile = registry.parseVirtualFile.bind(registry);
export const parseDirectory = registry.parseDirectory.bind(registry);
export const getSupportedExtensions = registry.getSupportedExtensions.bind(registry);
export { registry };
