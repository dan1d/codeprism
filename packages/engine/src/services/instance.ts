import { createRequire } from "node:module";
import { getDb } from "../db/connection.js";
import { createLLMProvider, type LLMConfig } from "../llm/provider.js";

const _require = createRequire(import.meta.url);

const MASK_CHAR = "\u2022";

export function maskApiKey(raw: string): string {
  if (!raw) return "";
  if (raw.length <= 11) return MASK_CHAR.repeat(raw.length);
  return raw.slice(0, 7) + MASK_CHAR.repeat(8) + raw.slice(-4);
}

export function isMasked(value: string): boolean {
  return value.includes(MASK_CHAR);
}

export function getEngineVersion(): string {
  try {
    const pkg = _require("../../package.json") as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

export interface InstanceInfo {
  instanceId: string;
  companyName: string;
  plan: string;
  engineVersion: string;
}

export function getInstanceInfo(): InstanceInfo {
  const db = getDb();
  const profile = db
    .prepare("SELECT * FROM instance_profile WHERE id = 1")
    .get() as { company_name: string; plan: string; instance_id: string } | undefined;

  return {
    instanceId: profile?.instance_id ?? "",
    companyName: profile?.company_name ?? "",
    plan: profile?.plan ?? "self_hosted",
    engineVersion: getEngineVersion(),
  };
}

export function updateInstanceInfo(companyName?: string, plan?: string): InstanceInfo {
  const db = getDb();
  if (companyName !== undefined) {
    db.prepare("UPDATE instance_profile SET company_name = ? WHERE id = 1").run(companyName.trim());
  }
  if (plan !== undefined) {
    db.prepare("UPDATE instance_profile SET plan = ? WHERE id = 1").run(plan);
  }
  return getInstanceInfo();
}

export function getSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM search_config").all() as Array<{ key: string; value: string }>;
  const config: Record<string, string> = {};
  for (const row of rows) {
    if (row.key === "llm_api_key") {
      config["llm_api_key"] = row.value ? maskApiKey(row.value) : "";
      config["llm_api_key_configured"] = row.value ? "true" : "false";
    } else {
      config[row.key] = row.value;
    }
  }
  return config;
}

export function updateSettings(updates: Record<string, string>): void {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO search_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  );
  const tx = db.transaction((pairs: Record<string, string>) => {
    for (const [key, value] of Object.entries(pairs)) {
      if (key === "llm_api_key" && (!value || isMasked(value))) continue;
      upsert.run(key, String(value));
    }
  });
  tx(updates);
}

export function getLLMFromDb(): ReturnType<typeof createLLMProvider> {
  const db = getDb();
  const get = (key: string): string | undefined => {
    const row = db.prepare("SELECT value FROM search_config WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value || undefined;
  };
  const provider = get("llm_provider") ?? process.env["SRCMAP_LLM_PROVIDER"];
  const model    = get("llm_model")    ?? process.env["SRCMAP_LLM_MODEL"];
  const apiKey   = get("llm_api_key")  ?? process.env["SRCMAP_LLM_API_KEY"];
  return createLLMProvider({
    provider: (provider as LLMConfig["provider"]) ?? "none",
    model,
    apiKey,
  });
}

// ---------------------------------------------------------------------------
// Search config CRUD — used by MCP srcmap_configure tool
// ---------------------------------------------------------------------------

export interface SearchConfigEntry {
  key: string;
  value: string;
  updatedAt: string;
}

export function listSearchConfig(): SearchConfigEntry[] {
  const db = getDb();
  return db
    .prepare("SELECT key, value, updated_at AS updatedAt FROM search_config ORDER BY key")
    .all() as SearchConfigEntry[];
}

export function getSearchConfigEntry(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare("SELECT value FROM search_config WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSearchConfigEntry(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO search_config (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value);
}
