import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getCatalogDbPath(): string {
  const dataDir = process.env["CODEPRISM_DATA_DIR"] ?? join(__dirname, "../..", "data");
  const dir = join(dataDir, "benchmarks");
  mkdirSync(dir, { recursive: true });
  return join(dir, "catalog.db");
}

let _db: InstanceType<typeof Database> | null = null;

function db(): InstanceType<typeof Database> {
  if (_db) return _db;
  _db = new Database(getCatalogDbPath());
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS benchmark_catalog (
      repo         TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      language     TEXT NOT NULL,
      description  TEXT NOT NULL,
      requires_key INTEGER NOT NULL DEFAULT 0,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS benchmark_catalog_prompts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      repo        TEXT NOT NULL,
      prompt      TEXT NOT NULL,
      is_default  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (repo) REFERENCES benchmark_catalog(repo) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_catalog_prompts_repo
      ON benchmark_catalog_prompts(repo);
  `);
  return _db;
}

// ---------------------------------------------------------------------------
// Seed data  (single source of truth — frontend fetches from API)
// ---------------------------------------------------------------------------

interface SeedEntry {
  repo: string;
  name: string;
  language: string;
  description: string;
  requiresKey?: boolean;
  prompts: string[];
}

const SEED: SeedEntry[] = [
  // ── Free tier (< 2 000 files) ────────────────────────────────────────
  {
    repo: "caddyserver/caddy",
    name: "Caddy",
    language: "Go",
    description: "Web server with automatic HTTPS — used by millions",
    prompts: [
      "How does Caddy provision and renew TLS certificates automatically?",
      "How does the Caddyfile get parsed into a running server config?",
      "How does Caddy's reverse proxy handle load balancing and health checks?",
    ],
  },
  {
    repo: "huginn/huginn",
    name: "Huginn",
    language: "Ruby",
    description: "Build agents that monitor and act on your behalf — like IFTTT on your server",
    prompts: [
      "How does the agent event pipeline propagate data between agents?",
      "How does Huginn schedule and run agents in the background?",
      "How does a new agent type get registered and configured?",
    ],
  },
  {
    repo: "lobsters/lobsters",
    name: "Lobsters",
    language: "Ruby",
    description: "Community link aggregation site — like Hacker News, open source",
    prompts: [
      "How does the story voting and ranking algorithm work?",
      "How does the invitation tree and moderation system work?",
      "How are comment threads threaded and rendered?",
    ],
  },
  {
    repo: "excalidraw/excalidraw",
    name: "Excalidraw",
    language: "TypeScript",
    description: "Virtual collaborative whiteboard — 90k+ stars",
    prompts: [
      "How does real-time collaboration and conflict resolution work?",
      "How does the canvas rendering and element selection work?",
      "How does the undo/redo history system work?",
    ],
  },
  {
    repo: "basecamp/kamal",
    name: "Kamal",
    language: "Ruby",
    description: "Deploy web apps anywhere — from Basecamp (DHH)",
    prompts: [
      "How does Kamal orchestrate a zero-downtime rolling deploy?",
      "How does Kamal manage Traefik as the load balancer?",
      "How does the remote Docker host connection and command execution work?",
    ],
  },
  {
    repo: "gogs/gogs",
    name: "Gogs",
    language: "Go",
    description: "Painless self-hosted Git service — lightweight Gitea alternative",
    prompts: [
      "How does Gogs handle Git push/pull authentication and authorization?",
      "How does the repository creation and hook system work?",
      "How does Gogs render diffs and manage merge operations?",
    ],
  },
  {
    repo: "maybe-finance/maybe",
    name: "Maybe",
    language: "Ruby",
    description: "Personal finance OS — open-sourced after $1M+ investment",
    prompts: [
      "How does Maybe sync bank accounts and transactions?",
      "How does the net worth calculation and portfolio tracking work?",
      "How does the multi-currency support work?",
    ],
  },
  {
    repo: "ghostfolio/ghostfolio",
    name: "Ghostfolio",
    language: "TypeScript",
    description: "Open source wealth management — tracks stocks, ETFs, crypto",
    prompts: [
      "How does Ghostfolio fetch and cache market data from providers?",
      "How does the portfolio performance calculation work?",
      "How does the asset allocation and rebalancing analysis work?",
    ],
  },
  // ── JavaScript / Node.js ────────────────────────────────────────────
  {
    repo: "expressjs/express",
    name: "Express",
    language: "JavaScript",
    description: "Fast, minimalist web framework for Node.js — the most popular JS server",
    prompts: [
      "How does Express route matching and middleware chaining work?",
      "How does Express handle error middleware and error propagation?",
      "How does the request and response object get extended?",
    ],
  },
  {
    repo: "fastify/fastify",
    name: "Fastify",
    language: "JavaScript",
    description: "High-performance web framework for Node.js — plugin-based architecture",
    prompts: [
      "How does the Fastify plugin system and encapsulation work?",
      "How does Fastify validate request/response schemas with JSON Schema?",
      "How does the Fastify hook lifecycle work?",
    ],
  },
  {
    repo: "socketio/socket.io",
    name: "Socket.IO",
    language: "TypeScript",
    description: "Bidirectional event-based communication for Node.js",
    prompts: [
      "How does Socket.IO handle room-based broadcasting?",
      "How does Socket.IO manage reconnection and connection state?",
      "How does the namespace isolation system work?",
    ],
  },
  // ── PHP ─────────────────────────────────────────────────────────────
  {
    repo: "monicahq/monica",
    name: "Monica",
    language: "PHP",
    description: "Personal CRM — manage relationships, reminders, notes",
    prompts: [
      "How does Monica track contact activities and relationship data?",
      "How does the reminder and notification system work?",
      "How does Monica manage journal entries and life events?",
    ],
  },
  {
    repo: "BookStackApp/BookStack",
    name: "BookStack",
    language: "PHP",
    description: "Open source wiki and documentation platform — Laravel-powered",
    requiresKey: true,
    prompts: [
      "How does BookStack organize books, chapters, and pages?",
      "How does the WYSIWYG editor integrate with the backend?",
      "How does BookStack handle permissions and role-based access?",
    ],
  },
  // ── Svelte ──────────────────────────────────────────────────────────
  {
    repo: "sveltejs/svelte",
    name: "Svelte",
    language: "TypeScript",
    description: "Cybernetically enhanced web apps — compile-time framework",
    prompts: [
      "How does Svelte's compiler transform components to vanilla JS?",
      "How does Svelte's reactive statement system work?",
      "How does the Svelte store contract and subscription model work?",
    ],
  },
  // ── Requires API key (> 2 000 files) ────────────────────────────────
  {
    repo: "mastodon/mastodon",
    name: "Mastodon",
    language: "Ruby",
    description: "Decentralized social network — 50k+ stars, ActivityPub federation",
    requiresKey: true,
    prompts: [
      "How does ActivityPub federation deliver posts to remote instances?",
      "How does the home timeline get assembled from followed accounts?",
      "How does Mastodon handle media attachments and content warnings?",
    ],
  },
  {
    repo: "chatwoot/chatwoot",
    name: "Chatwoot",
    language: "Ruby",
    description: "Open source customer engagement — omnichannel inbox",
    requiresKey: true,
    prompts: [
      "How does the omnichannel inbox route messages from different platforms?",
      "How does the real-time agent assignment and notification work?",
      "How does Chatwoot integrate with WhatsApp and Slack?",
    ],
  },
  {
    repo: "pixelfed/pixelfed",
    name: "Pixelfed",
    language: "PHP",
    description: "Federated image sharing — ActivityPub Instagram alternative",
    requiresKey: true,
    prompts: [
      "How does Pixelfed federate posts and interactions via ActivityPub?",
      "How does media storage and processing work?",
      "How does the timeline aggregation and federation discovery work?",
    ],
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  repo: string;
  name: string;
  language: string;
  description: string;
  requiresKey: boolean;
  prompts: Array<{ id: number; prompt: string; isDefault: boolean; createdAt: string }>;
}

/** Seed the catalog on first boot if empty. Safe to call repeatedly. */
export function seedCatalogIfEmpty(): void {
  const d = db();
  const count = (d.prepare("SELECT COUNT(*) as n FROM benchmark_catalog").get() as { n: number }).n;
  if (count > 0) return;

  const insertProject = d.prepare(
    "INSERT OR IGNORE INTO benchmark_catalog (repo, name, language, description, requires_key, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertPrompt = d.prepare(
    "INSERT INTO benchmark_catalog_prompts (repo, prompt, is_default) VALUES (?, ?, 1)"
  );

  const seedAll = d.transaction(() => {
    SEED.forEach((entry, idx) => {
      insertProject.run(
        entry.repo,
        entry.name,
        entry.language,
        entry.description,
        entry.requiresKey ? 1 : 0,
        idx,
      );
      for (const p of entry.prompts) {
        insertPrompt.run(entry.repo, p);
      }
    });
  });
  seedAll();
}

/** Return all catalog projects ordered by sort_order, with their prompts. */
export function getCatalog(): CatalogEntry[] {
  const d = db();
  seedCatalogIfEmpty();

  type ProjectRow = {
    repo: string; name: string; language: string;
    description: string; requires_key: number;
  };
  type PromptRow = {
    id: number; repo: string; prompt: string; is_default: number; created_at: string;
  };

  const projects = d
    .prepare("SELECT repo, name, language, description, requires_key FROM benchmark_catalog ORDER BY sort_order, created_at")
    .all() as ProjectRow[];

  const prompts = d
    .prepare("SELECT id, repo, prompt, is_default, created_at FROM benchmark_catalog_prompts ORDER BY is_default DESC, id ASC")
    .all() as PromptRow[];

  const promptsByRepo = new Map<string, CatalogEntry["prompts"]>();
  for (const p of prompts) {
    if (!promptsByRepo.has(p.repo)) promptsByRepo.set(p.repo, []);
    promptsByRepo.get(p.repo)!.push({
      id: p.id,
      prompt: p.prompt,
      isDefault: p.is_default === 1,
      createdAt: p.created_at,
    });
  }

  return projects.map((p) => ({
    repo: p.repo,
    name: p.name,
    language: p.language,
    description: p.description,
    requiresKey: p.requires_key === 1,
    prompts: promptsByRepo.get(p.repo) ?? [],
  }));
}

/** Add a user-submitted prompt for a repo. Returns the new prompt id. */
export function addCatalogPrompt(repo: string, prompt: string): number {
  const d = db();
  seedCatalogIfEmpty();
  // Ensure the repo exists (create a minimal entry if it's a fresh submission)
  const exists = d.prepare("SELECT 1 FROM benchmark_catalog WHERE repo = ?").get(repo);
  if (!exists) {
    const parts = repo.split("/");
    const name = parts[parts.length - 1] ?? repo;
    d.prepare(
      "INSERT OR IGNORE INTO benchmark_catalog (repo, name, language, description, requires_key, sort_order) VALUES (?, ?, ?, ?, 0, 9999)"
    ).run(repo, name, "Unknown", "User-submitted project");
  }
  const result = d.prepare(
    "INSERT INTO benchmark_catalog_prompts (repo, prompt, is_default) VALUES (?, ?, 0)"
  ).run(repo, prompt.trim());
  return result.lastInsertRowid as number;
}
