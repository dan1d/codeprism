import { spawn } from "node:child_process";
import { getDb } from "../db/connection.js";
import { getWorkspaceRoot } from "./utils.js";

export interface ReindexState {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  log: string[];
  error: string | null;
}

/**
 * Process-scoped singleton. In multi-tenant SaaS mode this reflects the
 * shared reindex child-process state (admin-only operation), not per-tenant
 * state. Self-hosted mode has only one implicit tenant so this is fine.
 */
export const reindexState: ReindexState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  log: [],
  error: null,
};

export function runIncrementalReindex(repo?: string): void {
  if (reindexState.status === "running") return;

  reindexState.status = "running";
  reindexState.startedAt = new Date().toISOString();
  reindexState.finishedAt = null;
  reindexState.log = [];
  reindexState.error = null;

  const workspaceRoot = getWorkspaceRoot();

  const args = ["--filter", "engine", "index-repos"];
  if (repo) args.push("--repo", repo);

  const child = spawn("pnpm", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  const append = (line: string) => {
    reindexState.log.push(line);
    if (reindexState.log.length > 200) reindexState.log.shift();
  };

  child.stdout?.on("data", (chunk: Buffer) =>
    String(chunk).split("\n").filter(Boolean).forEach(append),
  );
  child.stderr?.on("data", (chunk: Buffer) =>
    String(chunk).split("\n").filter(Boolean).forEach(append),
  );

  child.on("close", (code) => {
    reindexState.finishedAt = new Date().toISOString();
    if (code === 0) {
      reindexState.status = "done";
      reindexState.error = null;
    } else {
      reindexState.status = "error";
      reindexState.error = `Process exited with code ${code}`;
    }
  });

  child.on("error", (err) => {
    reindexState.finishedAt = new Date().toISOString();
    reindexState.status = "error";
    reindexState.error = err.message;
  });
}

export function getStaleCardCount(repo?: string): number {
  const db = getDb();
  return repo
    ? (db.prepare("SELECT COUNT(*) as n FROM cards WHERE stale = 1 AND source_repos LIKE ?").get(`%${repo}%`) as { n: number }).n
    : (db.prepare("SELECT COUNT(*) as n FROM cards WHERE stale = 1").get() as { n: number }).n;
}
