/**
 * One-time migration: appends a "Code identifiers" section to each card's content
 * so that class names, hooks, and routes are visible to LLM judges and users.
 *
 * Before: identifiers live only in the cards_fts `identifiers` column (4.0x BM25 weight).
 * After:  identifiers ALSO appear in card prose → LLM can answer "where is X defined?".
 *
 * Rebuilds cards_fts after all content updates.
 *
 * Safe to re-run: skips cards that already have a "## Code identifiers" section.
 */

import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";

function extractClassNames(identifiers: string): string[] {
  return identifiers
    .split(/\s+/)
    .filter((t) => /^[A-Z][a-zA-Z0-9]{1,}/.test(t) || /^use[A-Z]/.test(t))
    .slice(0, 20);
}

function extractRoutes(identifiers: string): string[] {
  return identifiers
    .split(/\s+/)
    .reduce<string[]>((acc, token, i, arr) => {
      if (/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(token)) {
        const path = arr[i + 1];
        if (path) acc.push(`${token} ${path}`);
      }
      return acc;
    }, [])
    .slice(0, 5);
}

function buildIdentifiersSection(identifiers: string): string {
  const classNames = extractClassNames(identifiers);
  const routes = extractRoutes(identifiers);

  const lines: string[] = ["", "## Code identifiers"];
  if (classNames.length > 0) {
    lines.push(`**Classes & hooks:** ${classNames.join(", ")}`);
  }
  if (routes.length > 0) {
    lines.push(`**Routes:** ${routes.join(", ")}`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const db = getDb();
  runMigrations(db);

  const cards = db
    .prepare("SELECT id, content, identifiers FROM cards WHERE identifiers <> '' AND stale = 0")
    .all() as { id: string; content: string; identifiers: string }[];

  console.log(`Found ${cards.length} cards with identifiers.`);

  let updated = 0;
  let skipped = 0;

  const updateStmt = db.prepare("UPDATE cards SET content = ? WHERE id = ?");

  const migrate = db.transaction(() => {
    for (const card of cards) {
      if (card.content.includes("## Code identifiers")) {
        skipped++;
        continue;
      }
      const section = buildIdentifiersSection(card.identifiers);
      updateStmt.run(card.content + section, card.id);
      updated++;
    }
  });

  migrate();

  console.log(`Updated ${updated} cards, skipped ${skipped} (already migrated).`);

  // Rebuild FTS5 index to reflect content changes
  console.log("Rebuilding cards_fts...");
  db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')");
  console.log("Done.");

  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
