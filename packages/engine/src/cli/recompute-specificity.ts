/**
 * Recomputes specificity scores for all cards based on current embeddings.
 * Run after any re-embedding or card addition.
 */
import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { computeSpecificity } from "../search/specificity.js";

const db = getDb();
runMigrations(db);
const stats = computeSpecificity();
console.log(`Specificity recomputed: ${stats.total} cards, range [${stats.globalRange[0].toFixed(4)}, ${stats.globalRange[1].toFixed(4)}]`);
closeDb();
