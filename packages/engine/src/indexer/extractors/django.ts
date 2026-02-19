import type {
  FrameworkExtractor,
  ParsedFile,
  Association,
  RouteInfo,
} from "../types.js";

/* ------------------------------------------------------------------ */
/*  Detection helpers                                                  */
/* ------------------------------------------------------------------ */

const DJANGO_MARKERS = [
  "manage.py",
  "settings.py",
  "urls.py",
  "wsgi.py",
];

function detect(files: string[]): boolean {
  const names = files.map((f) => f.replace(/\\/g, "/").split("/").pop()!);
  const hasMarker = DJANGO_MARKERS.some((m) => names.includes(m));
  const hasReq = files.some(
    (f) => /requirements.*\.txt$/.test(f) || /Pipfile$/.test(f),
  );

  return hasMarker || hasReq;
}

/* ------------------------------------------------------------------ */
/*  Regex patterns for enhancement                                     */
/* ------------------------------------------------------------------ */

const MODEL_BASES = /\bmodels\.Model\b/;
const API_VIEW_BASES = /\b(?:APIView|ViewSet|ModelViewSet|GenericAPIView)\b/;
const SERIALIZER_BASES = /\b(?:Serializer|ModelSerializer)\b/;

const RELATION_FIELD_RE =
  /^\s*(?<field>\w+)\s*=\s*models\.(?<kind>ForeignKey|ManyToManyField|OneToOneField)\(\s*(?:['"]?)(?<target>\w+)/gm;

const URL_PATH_RE =
  /path\(\s*['"](?<url>[^'"]*)['"]\s*,\s*(?<view>[^,)]+)/gm;

/* ------------------------------------------------------------------ */
/*  Enhancement                                                        */
/* ------------------------------------------------------------------ */

function enhance(parsed: ParsedFile): ParsedFile {
  const result = { ...parsed };

  const content = rawContentHint(parsed);

  /* --- Classify classes by base ----------------------------------- */
  result.classes = parsed.classes.map((cls) => {
    if (cls.parent && MODEL_BASES.test(cls.parent)) {
      return { ...cls, type: "model" as const };
    }
    if (cls.parent && API_VIEW_BASES.test(cls.parent)) {
      return { ...cls, type: "controller" as const };
    }
    if (cls.parent && SERIALIZER_BASES.test(cls.parent)) {
      return { ...cls, type: "serializer" as const };
    }
    return cls;
  });

  /* --- Extract relation-field associations ------------------------ */
  if (content) {
    const associations: Association[] = [...parsed.associations];

    RELATION_FIELD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = RELATION_FIELD_RE.exec(content)) !== null) {
      associations.push({
        type: m.groups!.kind as Association["type"],
        name: m.groups!.field,
        target_model: m.groups!.target,
      });
    }

    result.associations = associations;
  }

  /* --- Parse urls.py ---------------------------------------------- */
  if (parsed.path.replace(/\\/g, "/").endsWith("urls.py") && content) {
    const routes: RouteInfo[] = [...parsed.routes];

    URL_PATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = URL_PATH_RE.exec(content)) !== null) {
      const viewRaw = m.groups!.view.trim();
      const asViewMatch = /^(\w+)\.as_view\(\)/.exec(viewRaw);

      routes.push({
        method: "ALL",
        path: `/${m.groups!.url}`,
        controller: asViewMatch ? asViewMatch[1] : undefined,
        action: asViewMatch ? undefined : viewRaw.replace(/['"]/g, ""),
      });
    }

    result.routes = routes;
  }

  return result;
}

/**
 * We receive a `ParsedFile` not the raw source.  To run regex against raw
 * content we reconstruct a best-effort representation from the structural
 * data.  The *real* raw content should be attached by the registry layer in
 * a future iteration; for now we rely on function/class metadata and store
 * the raw hint in a convention field on the parsed file.
 *
 * Workaround: The enhance step re-reads the file content through
 * `ParsedFile` metadata.  Because the file content isn't available on the
 * `ParsedFile` interface, we stash it on a non-enumerable property during
 * parsing. If that property is absent we return `undefined`.
 */
function rawContentHint(parsed: ParsedFile): string | undefined {
  return (parsed as ParsedFile & { _raw?: string })._raw;
}

/** Regex-based Django framework extractor (no tree-sitter dependency). */
export const djangoExtractor: FrameworkExtractor = {
  id: "django",
  name: "Django (regex)",
  languages: ["python"],
  detect,
  enhance,
};
