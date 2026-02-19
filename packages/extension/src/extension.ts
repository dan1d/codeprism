import * as vscode from "vscode";
import { SyncClient } from "./sync-client";
import { GitWatcher } from "./git-watcher";
import { StatusBar } from "./status-bar";

let statusBar: StatusBar;
let watcher: GitWatcher;
let client: SyncClient;
let healthInterval: ReturnType<typeof setInterval>;

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("srcmap");
  const engineUrl = config.get<string>("engineUrl", "http://localhost:4000");
  const autoSync = config.get<boolean>("autoSync", true);
  const debounceMs = config.get<number>("syncDebounceMs", 2000);

  client = new SyncClient(engineUrl);
  statusBar = new StatusBar();

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    statusBar.setDisconnected();
    return;
  }

  watcher = new GitWatcher(workspaceRoot);

  watcher.onSyncReady = async (payload) => {
    if (!autoSync) return;

    statusBar.setSyncing();
    try {
      const result = await client.sync(payload);
      if (result.ok) {
        const health = await client.health();
        statusBar.setConnected(health.cards);
        if (result.staleCards && result.staleCards > 0) {
          vscode.window.setStatusBarMessage(
            `srcmap: ${result.staleCards} card(s) marked stale`,
            3000,
          );
        }
      } else {
        statusBar.setDisconnected();
      }
    } catch {
      statusBar.setDisconnected();
    }
  };

  watcher.start(debounceMs);

  checkHealth();
  healthInterval = setInterval(checkHealth, 30_000);

  context.subscriptions.push(
    statusBar,
    watcher,
    vscode.commands.registerCommand("srcmap.syncNow", async () => {
      statusBar.setSyncing();
      try {
        await watcher.syncNow();
        const health = await client.health();
        statusBar.setConnected(health.cards);
        vscode.window.showInformationMessage(
          `srcmap: Synced. ${health.cards} cards across ${health.flows} flows.`,
        );
      } catch (err) {
        statusBar.setDisconnected();
        vscode.window.showErrorMessage(
          `srcmap: Sync failed – ${err instanceof Error ? err.message : err}`,
        );
      }
    }),
    vscode.commands.registerCommand("srcmap.showStatus", async () => {
      try {
        const health = await client.health();
        vscode.window.showInformationMessage(
          `srcmap engine: ${health.cards} cards, ${health.flows} flows – ${engineUrl}`,
        );
        statusBar.setConnected(health.cards);
      } catch {
        vscode.window.showWarningMessage(
          `srcmap engine unreachable at ${engineUrl}`,
        );
        statusBar.setDisconnected();
      }
    }),
    vscode.commands.registerCommand("srcmap.reindex", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Trigger a full re-index of the codebase? This runs the indexer CLI.",
        "Yes",
        "Cancel",
      );
      if (confirm !== "Yes") return;

      const terminal = vscode.window.createTerminal("srcmap reindex");
      terminal.show();
      terminal.sendText(
        `cd "${workspaceRoot}" && npx tsx node_modules/.bin/srcmap-index || echo "Run the indexer from the srcmap directory"`,
      );
    }),
  );

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("srcmap")) {
      const newConfig = vscode.workspace.getConfiguration("srcmap");
      const newUrl = newConfig.get<string>("engineUrl", "http://localhost:4000");
      client.setBaseUrl(newUrl);
      checkHealth();
    }
  });
}

async function checkHealth(): Promise<void> {
  try {
    const health = await client.health();
    statusBar.setConnected(health.cards);
  } catch {
    statusBar.setDisconnected();
  }
}

export function deactivate(): void {
  if (healthInterval) clearInterval(healthInterval);
}
