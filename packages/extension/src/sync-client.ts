import * as http from "node:http";
import * as https from "node:https";
import * as url from "node:url";

export interface ChangedFile {
  path: string;
  content: string;
  status: "added" | "modified" | "deleted";
}

export interface SyncPayload {
  repo: string;
  branch: string;
  commitSha?: string;
  eventType?: "save" | "merge" | "pull" | "rebase";
  changedFiles: ChangedFile[];
  devId?: string;
}

export interface SyncResult {
  indexed: number;
  invalidated: number;
}

export interface HealthResult {
  status: string;
  cards: number;
  flows: number;
}

export class SyncClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async sync(payload: SyncPayload): Promise<SyncResult> {
    return this.post<SyncResult>("/api/sync", payload);
  }

  async health(): Promise<HealthResult> {
    return this.get<HealthResult>("/api/health");
  }

  private get<T>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const parsed = new url.URL(this.baseUrl + path);
      const transport = parsed.protocol === "https:" ? https : http;

      const req = transport.get(parsed, { timeout: 5000 }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} from ${path}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`Invalid JSON from ${path}: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Timeout connecting to ${this.baseUrl}`));
      });
    });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const parsed = new url.URL(this.baseUrl + path);
      const transport = parsed.protocol === "https:" ? https : http;
      const payload = JSON.stringify(body);

      const req = transport.request(
        parsed,
        {
          method: "POST",
          timeout: 10000,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode} from ${path}: ${data.slice(0, 200)}`));
              return;
            }
            try {
              resolve(JSON.parse(data) as T);
            } catch {
              reject(new Error(`Invalid JSON from ${path}: ${data.slice(0, 200)}`));
            }
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Timeout posting to ${this.baseUrl}`));
      });

      req.write(payload);
      req.end();
    });
  }
}
