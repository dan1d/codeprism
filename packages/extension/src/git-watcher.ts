import * as vscode from "vscode";
import * as cp from "node:child_process";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import type { ChangedFile, SyncPayload } from "./sync-client";

export class GitWatcher implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingFiles = new Set<string>();
  private workspaceRoot: string;

  onSyncReady: ((payload: SyncPayload) => void) | undefined;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  start(debounceMs: number): void {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");

    watcher.onDidCreate((uri) => this.enqueue(uri, debounceMs));
    watcher.onDidChange((uri) => this.enqueue(uri, debounceMs));
    watcher.onDidDelete((uri) => this.enqueue(uri, debounceMs));

    this.disposables.push(watcher);

    const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
      this.enqueue(doc.uri, debounceMs);
    });
    this.disposables.push(saveListener);
  }

  private enqueue(uri: vscode.Uri, debounceMs: number): void {
    if (uri.scheme !== "file") return;

    const rel = path.relative(this.workspaceRoot, uri.fsPath);
    if (
      rel.startsWith("..") ||
      rel.includes("node_modules") ||
      rel.includes(".git/") ||
      rel.startsWith(".git")
    ) {
      return;
    }

    this.pendingFiles.add(uri.fsPath);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flush(), debounceMs);
  }

  async syncNow(): Promise<void> {
    await this.flush();
  }

  private async flush(): Promise<void> {
    const files = Array.from(this.pendingFiles);
    this.pendingFiles.clear();

    if (files.length === 0) return;

    const branch = await this.getCurrentBranch();
    const repoName = path.basename(this.workspaceRoot);

    const changedFiles = await this.getChangedFiles(files);

    const payload: SyncPayload = {
      repo: repoName,
      branch,
      eventType: "save",
      changedFiles,
    };

    this.onSyncReady?.(payload);
  }

  private getChangedFiles(absolutePaths: string[]): Promise<ChangedFile[]> {
    return new Promise((resolve) => {
      const changed: ChangedFile[] = [];

      for (const abs of absolutePaths) {
        const rel = path.relative(this.workspaceRoot, abs);
        try {
          const status = cp.execSync(
            `git status --porcelain -- "${rel}" 2>/dev/null`,
            { cwd: this.workspaceRoot, encoding: "utf-8", timeout: 5000 },
          ).trim();

          let fileStatus: ChangedFile["status"] = "modified";
          if (status.startsWith("?") || status.startsWith("A")) fileStatus = "added";
          else if (status.startsWith("D")) fileStatus = "deleted";

          let content = "";
          if (fileStatus !== "deleted") {
            try {
              content = readFileSync(abs, "utf-8");
            } catch {
              content = "";
            }
          }

          changed.push({ path: rel, status: fileStatus, content });
        } catch {
          let content = "";
          try {
            content = readFileSync(abs, "utf-8");
          } catch {
            content = "";
          }
          changed.push({ path: rel, status: "modified", content });
        }
      }

      resolve(changed);
    });
  }

  private getCurrentBranch(): Promise<string> {
    return new Promise((resolve) => {
      try {
        const branch = cp
          .execSync("git rev-parse --abbrev-ref HEAD", {
            cwd: this.workspaceRoot,
            encoding: "utf-8",
            timeout: 3000,
          })
          .trim();
        resolve(branch || "unknown");
      } catch {
        resolve("unknown");
      }
    });
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.disposables.forEach((d) => d.dispose());
  }
}
