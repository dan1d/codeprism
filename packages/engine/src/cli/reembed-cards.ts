/**
 * Re-generates embeddings for all non-stale cards using current card content.
 * Run after any content migration that changes what cards say.
 */

import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { getEmbedder } from "../embeddings/local-embedder.js";
import type { Card } from "../db/schema.js";

async function main(): Promise<void> {
  const db = getDb();
  runMigrations(db);

  const cards = db
    .prepare("SELECT * FROM cards WHERE stale = 0")
    .all() as Card[];

  console.log(`Re-embedding ${cards.length} cards...`);

  // Clear existing embeddings
  db.exec("DELETE FROM card_embeddings");
  try { db.exec("DELETE FROM card_title_embeddings"); } catch { /* pre-v14 */ }

  const embedder = getEmbedder();
  const insertEmbedding = db.prepare(
    "INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)"
  );
  const insertTitleEmbedding = db.prepare(
    "INSERT INTO card_title_embeddings (card_id, embedding) VALUES (?, ?)"
  );

  const batch: Array<{ id: string; embedding: Float32Array; titleEmbedding: Float32Array }> = [];

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    const text = `${card.title}\n${card.content}`;
    const [embedding, titleEmbedding] = await Promise.all([
      embedder.embed(text, "document"),
      embedder.embed(card.title, "document"),
    ]);
    batch.push({ id: card.id, embedding, titleEmbedding });
    process.stdout.write(`\r  ${i + 1}/${cards.length}`);
  }

  console.log("\nWriting to DB...");
  const insertTx = db.transaction(() => {
    for (const { id, embedding, titleEmbedding } of batch) {
      insertEmbedding.run(id, Buffer.from(embedding.buffer));
      try { insertTitleEmbedding.run(id, Buffer.from(titleEmbedding.buffer)); } catch { /* pre-v14 */ }
    }
  });
  insertTx();

  console.log("Done. Embeddings updated.");
  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
