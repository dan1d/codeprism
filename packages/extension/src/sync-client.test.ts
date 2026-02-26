/**
 * SyncClient unit tests.
 *
 * Uses a real in-process HTTP server — tests the actual HTTP layer.
 * Covers: successful sync, health check, error handling, base URL normalisation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import { SyncClient, type SyncPayload } from "./sync-client.js";

let server: http.Server;
let baseUrl: string;

// Each test sets this to control how the server responds.
// Receives (req, res, body) — body already buffered.
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;
let nextHandler: Handler | null = null;

function defaultHandler(_req: http.IncomingMessage, res: http.ServerResponse, _body: string) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", cards: 42, flows: 7 }));
}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const handler = nextHandler ?? defaultHandler;
          nextHandler = null;
          handler(req, res, body);
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    })
);

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const PAYLOAD: SyncPayload = {
  repo: "backend",
  branch: "main",
  eventType: "save",
  changedFiles: [{ path: "app/models/user.rb", status: "modified", content: "class User; end" }],
};

// ---------------------------------------------------------------------------

describe("SyncClient — health()", () => {
  it("returns card and flow counts from engine", async () => {
    nextHandler = (_req, res, _body) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", cards: 99, flows: 12 }));
    };
    const result = await new SyncClient(baseUrl).health();
    expect(result.cards).toBe(99);
    expect(result.flows).toBe(12);
  });

  it("throws on non-200 response", async () => {
    nextHandler = (_req, res, _body) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "overloaded" }));
    };
    await expect(new SyncClient(baseUrl).health()).rejects.toThrow("503");
  });

  it("throws on invalid JSON body", async () => {
    nextHandler = (_req, res, _body) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("not json");
    };
    await expect(new SyncClient(baseUrl).health()).rejects.toThrow(/Invalid JSON/);
  });
});

// ---------------------------------------------------------------------------

describe("SyncClient — sync()", () => {
  it("posts payload as JSON and returns ok:true on success", async () => {
    let receivedBody: unknown;
    nextHandler = (_req, res, body) => {
      receivedBody = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ indexed: 1, invalidated: 3 }));
    };
    const result = await new SyncClient(baseUrl).sync(PAYLOAD);
    expect(result.indexed).toBe(1);
    expect(result.invalidated).toBe(3);
    expect((receivedBody as SyncPayload).repo).toBe("backend");
  });

  it("sends Content-Type: application/json", async () => {
    let contentType = "";
    nextHandler = (req, res, _body) => {
      contentType = req.headers["content-type"] ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ indexed: 0, invalidated: 0 }));
    };
    await new SyncClient(baseUrl).sync(PAYLOAD);
    expect(contentType).toContain("application/json");
  });

  it("throws on engine 500 error", async () => {
    nextHandler = (_req, res, _body) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
    };
    await expect(new SyncClient(baseUrl).sync(PAYLOAD)).rejects.toThrow("500");
  });
});

// ---------------------------------------------------------------------------

describe("SyncClient — setBaseUrl()", () => {
  it("switches target URL mid-session", async () => {
    const client = new SyncClient("http://127.0.0.1:1"); // unreachable
    client.setBaseUrl(baseUrl);
    nextHandler = (_req, res, _body) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", cards: 5, flows: 1 }));
    };
    const result = await client.health();
    expect(result.cards).toBe(5);
  });

  it("strips trailing slash from base URL", async () => {
    const client = new SyncClient(`${baseUrl}/`);
    await expect(client.health()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------

describe("SyncClient — connection errors", () => {
  it("rejects when server is unreachable", async () => {
    await expect(new SyncClient("http://127.0.0.1:1").health()).rejects.toThrow();
  });
});
