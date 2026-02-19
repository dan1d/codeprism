import { readFileSync } from "node:fs";
import type { FrameworkExtractor, ParsedFile } from "../types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function fileNameToComponentName(filePath: string): string {
  const base = filePath.split("/").pop() ?? "";
  return base.replace(/\.\w+$/, "");
}

/* ------------------------------------------------------------------ */
/*  Extractor                                                          */
/* ------------------------------------------------------------------ */

export const reactExtractor: FrameworkExtractor = {
  id: "react",
  name: "React / Redux",
  languages: ["javascript"],

  detect(files: string[]): boolean {
    for (const f of files) {
      if (f.endsWith("/package.json") || f === "package.json") {
        const pkg = readJsonSafe(f);
        if (!pkg) continue;
        const deps: Record<string, unknown> = {
          ...(pkg.dependencies as Record<string, unknown> | undefined),
          ...(pkg.devDependencies as Record<string, unknown> | undefined),
          ...(pkg.peerDependencies as Record<string, unknown> | undefined),
        };
        if ("react" in deps) return true;
      }
    }

    return files.some(
      (f) =>
        f.includes("/src/redux/") ||
        f.includes("/src/store/") ||
        f.includes("/src/components/"),
    );
  },

  enhance(parsed: ParsedFile): ParsedFile {
    const fp = parsed.path;

    // Redux store files: createSlice was already detected by the JS parser
    // as a class with type "store". Promote remaining "other" classes to
    // "store" when the file contains slice/store indicators.
    const hasStoreSignals =
      parsed.storeUsages.length > 0 ||
      parsed.classes.some((c) => c.type === "store") ||
      fp.includes("/store/") ||
      fp.includes("/slices/") ||
      fp.includes("/redux/");

    if (hasStoreSignals) {
      for (const cls of parsed.classes) {
        if (cls.type === "other") cls.type = "store";
      }
    }

    // Component files
    const isComponentPath =
      fp.includes("/components/") ||
      fp.includes("/pages/") ||
      fp.includes("/views/");

    if (isComponentPath) {
      const hasExportedFunction =
        parsed.exports.length > 0 && parsed.functions.length > 0;

      if (hasExportedFunction && !parsed.classes.some((c) => c.type === "component")) {
        const name =
          parsed.exports.find((e) => e.isDefault)?.name ??
          parsed.exports[0]?.name ??
          fileNameToComponentName(fp);
        parsed.classes.push({ name, type: "component" });
      }

      for (const cls of parsed.classes) {
        if (cls.type === "other") cls.type = "component";
      }
    }

    // Hook files
    if (fp.includes("/hooks/")) {
      for (const cls of parsed.classes) {
        if (cls.type === "other") cls.type = "helper";
      }

      if (parsed.classes.length === 0 && parsed.functions.length > 0) {
        const name =
          parsed.exports.find((e) => e.isDefault)?.name ??
          parsed.functions[0]?.name ??
          "hook";
        parsed.classes.push({ name, type: "helper" });
      }
    }

    // Middleware files
    if (fp.includes("/middleware/") || fp.includes("/middlewares/")) {
      for (const cls of parsed.classes) {
        if (cls.type === "other") cls.type = "middleware";
      }
    }

    return parsed;
  },
};
