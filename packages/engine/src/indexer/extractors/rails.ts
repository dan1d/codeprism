import type {
  ClassInfo,
  FrameworkExtractor,
  ParsedFile,
} from "../types.js";

/* ------------------------------------------------------------------ */
/*  Detection patterns                                                  */
/* ------------------------------------------------------------------ */

const RAILS_MARKERS = [
  "Gemfile",
  "config/routes.rb",
  "app/models/",
] as const;

/* ------------------------------------------------------------------ */
/*  Path → class type mapping                                           */
/* ------------------------------------------------------------------ */

const PATH_TYPE_MAP: [RegExp, ClassInfo["type"]][] = [
  [/\/app\/models\//, "model"],
  [/\/app\/controllers\//, "controller"],
  [/\/app\/jobs\//, "job"],
  [/\/app\/services\//, "service"],
  [/\/app\/helpers\//, "helper"],
  [/\/app\/serializers\//, "serializer"],
  [/\/app\/mailers\//, "middleware"],
];

const PARENT_TYPE_MAP: Record<string, ClassInfo["type"]> = {
  ApplicationRecord: "model",
  ApplicationController: "controller",
  "ActiveJob::Base": "job",
  ActionMailer: "middleware",
  ApplicationMailer: "middleware",
};

/* ------------------------------------------------------------------ */
/*  Enhancement logic                                                   */
/* ------------------------------------------------------------------ */

function inferTypeFromPath(filePath: string): ClassInfo["type"] | undefined {
  for (const [pattern, type] of PATH_TYPE_MAP) {
    if (pattern.test(filePath)) return type;
  }
  return undefined;
}

function inferTypeFromParent(parent?: string): ClassInfo["type"] | undefined {
  if (!parent) return undefined;
  if (PARENT_TYPE_MAP[parent]) return PARENT_TYPE_MAP[parent];
  if (parent.endsWith("Controller")) return "controller";
  return undefined;
}

function enhanceParsedFile(parsed: ParsedFile): ParsedFile {
  const pathType = inferTypeFromPath(parsed.path);

  const classes = parsed.classes.map((cls) => {
    const parentType = inferTypeFromParent(cls.parent);

    if (parentType) {
      return { ...cls, type: parentType };
    }

    if (pathType && cls.type === "other") {
      return { ...cls, type: pathType };
    }

    return cls;
  });

  return { ...parsed, classes };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

export const railsExtractor: FrameworkExtractor = {
  id: "rails",
  name: "Ruby on Rails",
  languages: ["ruby"],

  detect(files: string[]): boolean {
    return files.some((f) =>
      RAILS_MARKERS.some((marker) => f.includes(marker)),
    );
  },

  enhance(parsed: ParsedFile): ParsedFile {
    if (parsed.language !== "ruby") return parsed;
    return enhanceParsedFile(parsed);
  },
};
