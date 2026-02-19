import type {
  FrameworkExtractor,
  ParsedFile,
  RouteInfo,
} from "../types.js";

/* ------------------------------------------------------------------ */
/*  Detection                                                          */
/* ------------------------------------------------------------------ */

const PKG_JSON_RE = /package\.json$/;

const FRAMEWORK_MARKERS = ["express", "fastify", "@nestjs/core"];

const CONVENTION_FILES = [/\.controller\.ts$/, /\.module\.ts$/];

function detect(files: string[]): boolean {
  const hasPkgJson = files.some((f) => PKG_JSON_RE.test(f));
  const hasConventionFile = files.some((f) =>
    CONVENTION_FILES.some((re) => re.test(f)),
  );

  if (hasConventionFile) return true;

  return hasPkgJson;
}

/* ------------------------------------------------------------------ */
/*  Regex patterns for enhancement                                     */
/* ------------------------------------------------------------------ */

const ROUTER_RE = /(?:express\.Router|Router)\s*\(\s*\)/;

const EXPRESS_ROUTE_RE =
  /\.\s*(?<method>get|post|put|patch|delete|all|use)\s*\(\s*['"](?<path>[^'"]+)['"]/gi;

const NEST_CONTROLLER_RE = /@Controller\(\s*['"]?(?<prefix>[^'")\s]*)['"]?\s*\)/;

const NEST_ROUTE_RE =
  /@(?<method>Get|Post|Put|Patch|Delete|All)\(\s*['"]?(?<path>[^'")\s]*)['"]?\s*\)/gi;

/* ------------------------------------------------------------------ */
/*  Enhancement                                                        */
/* ------------------------------------------------------------------ */

function enhance(parsed: ParsedFile): ParsedFile {
  const result = { ...parsed };
  const content = (parsed as ParsedFile & { _raw?: string })._raw;

  const p = parsed.path.replace(/\\/g, "/");

  /* --- Middleware classification ---------------------------------- */
  if (/\/middleware\//.test(p)) {
    result.classes = parsed.classes.map((cls) => ({
      ...cls,
      type: "middleware" as const,
    }));
  }

  if (!content) return result;

  const routes: RouteInfo[] = [...parsed.routes];

  /* --- Express / Fastify route extraction ------------------------- */
  if (ROUTER_RE.test(content)) {
    EXPRESS_ROUTE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = EXPRESS_ROUTE_RE.exec(content)) !== null) {
      routes.push({
        method: m.groups!.method.toUpperCase(),
        path: m.groups!.path,
      });
    }
  }

  /* --- NestJS decorator-based routes ------------------------------ */
  const controllerMatch = NEST_CONTROLLER_RE.exec(content);
  if (controllerMatch) {
    const prefix = controllerMatch.groups!.prefix || "";

    result.classes = parsed.classes.map((cls) => ({
      ...cls,
      type: "controller" as const,
    }));

    NEST_ROUTE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = NEST_ROUTE_RE.exec(content)) !== null) {
      const routePath = m.groups!.path || "";
      routes.push({
        method: m.groups!.method.toUpperCase(),
        path: prefix ? `/${prefix}/${routePath}`.replace(/\/+/g, "/") : `/${routePath}`,
      });
    }
  }

  result.routes = routes;
  return result;
}

/** Regex-based Express/Fastify/NestJS framework extractor. */
export const expressExtractor: FrameworkExtractor = {
  id: "express",
  name: "Express / Fastify / NestJS (regex)",
  languages: ["javascript", "typescript"],
  detect,
  enhance,
};
