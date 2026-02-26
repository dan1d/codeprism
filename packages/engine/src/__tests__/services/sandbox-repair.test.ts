import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

function createBenchDb(repo: string, llmLabel?: string) {
  const benchDir = join(tmpDir, "benchmarks");
  mkdirSync(benchDir, { recursive: true });
  const base = repo.replace(/\//g, "-");
  const suffix = llmLabel ? `-${llmLabel}` : "";
  const dbPath = join(benchDir, `${base}${suffix}.db`);
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      flow TEXT,
      title TEXT,
      content TEXT,
      card_type TEXT,
      source_files TEXT,
      source_repos TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now')),
      identifiers TEXT DEFAULT '',
      stale INTEGER NOT NULL DEFAULT 0
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
      title, content, flow, source_repos, tags, identifiers,
      content='cards', content_rowid='rowid'
    );
  `);
  return { db, dbPath };
}

function seedCard(db: InstanceType<typeof Database>, opts: { id: string; title: string; content?: string; flow?: string; identifiers?: string }) {
  db.prepare(
    "INSERT INTO cards (id, flow, title, content, card_type, source_files, source_repos, tags, identifiers, stale) VALUES (?, ?, ?, ?, 'flow', '[]', '[]', '[]', ?, 0)",
  ).run(
    opts.id,
    opts.flow ?? "test-flow",
    opts.title,
    opts.content ?? "content",
    opts.identifiers ?? "",
  );
  db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')");
}

describe("/api/benchmarks/sandbox LLM repair", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cp-sandbox-repair-"));
    process.env["CODEPRISM_DATA_DIR"] = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env["CODEPRISM_DATA_DIR"];
    vi.restoreAllMocks();
  });

  it("does not call LLM repair when FTS hits", async () => {
    vi.doMock("../../services/query-repair.js", () => ({
      llmQueryRepair: () => { throw new Error("should not be called"); },
    }));
    const { registerBenchmarkRoutes } = await import("../../routes/benchmarks.js");

    const { db } = createBenchDb("acme/repo");
    seedCard(db, { id: "c1", title: "Actor Serializer", identifiers: "ActorSerializer" });
    db.close();

    const app = Fastify({ logger: false });
    await app.register(registerBenchmarkRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/api/benchmarks/sandbox",
      payload: {
        repo: "acme/repo",
        query: "ActorSerializer",
        repair: { enabled: true, provider: "anthropic", model: "claude-haiku-3-5", apiKey: "sk_test_1234567890" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { cards: unknown[]; diagnostics?: { llm_repair_attempted?: boolean } };
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.diagnostics?.llm_repair_attempted).toBeUndefined();
    await app.close();
  });

  it("uses LLM repair on miss when probe yields DB hits", async () => {
    const llmQueryRepairMock = vi.fn(async () => ({
      probes: [{ query: "ActorSerializer", fts_terms: "ActorSerializer" }],
    }));
    vi.doMock("../../services/query-repair.js", () => ({ llmQueryRepair: llmQueryRepairMock }));

    const { registerBenchmarkRoutes } = await import("../../routes/benchmarks.js");

    const { db } = createBenchDb("acme/repo");
    seedCard(db, { id: "c1", title: "Actor Serializer", identifiers: "ActorSerializer" });
    db.close();

    const app = Fastify({ logger: false });
    await app.register(registerBenchmarkRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/api/benchmarks/sandbox",
      payload: {
        repo: "acme/repo",
        query: "completely_miss_query",
        repair: { enabled: true, provider: "anthropic", model: "claude-haiku-3-5", apiKey: "sk_test_1234567890" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { cards: unknown[]; diagnostics?: { fallback_used?: string; llm_repair_used?: boolean } };
    expect(llmQueryRepairMock).toHaveBeenCalledTimes(1);
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.diagnostics?.fallback_used).toBe("llm_repair");
    expect(body.diagnostics?.llm_repair_used).toBe(true);
    await app.close();
  });
});

