import * as vscode from "vscode";
import { SyncClient } from "./sync-client";
import { GitWatcher } from "./git-watcher";
import { StatusBar } from "./status-bar";

let statusBar: StatusBar;
let watcher: GitWatcher;
let client: SyncClient;
let healthInterval: ReturnType<typeof setInterval>;

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("codeprism");
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
      const health = await client.health();
      statusBar.setConnected(health.cards);
      if (result.invalidated && result.invalidated > 0) {
        vscode.window.setStatusBarMessage(
          `codeprism: ${result.invalidated} card(s) marked stale`,
          3000,
        );
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
    vscode.commands.registerCommand("codeprism.syncNow", async () => {
      statusBar.setSyncing();
      try {
        await watcher.syncNow();
        const health = await client.health();
        statusBar.setConnected(health.cards);
        vscode.window.showInformationMessage(
          `codeprism: Synced. ${health.cards} cards across ${health.flows} flows.`,
        );
      } catch (err) {
        statusBar.setDisconnected();
        vscode.window.showErrorMessage(
          `codeprism: Sync failed – ${err instanceof Error ? err.message : err}`,
        );
      }
    }),
    vscode.commands.registerCommand("codeprism.showStatus", async () => {
      try {
        const health = await client.health();
        vscode.window.showInformationMessage(
          `codeprism engine: ${health.cards} cards, ${health.flows} flows – ${engineUrl}`,
        );
        statusBar.setConnected(health.cards);
      } catch {
        vscode.window.showWarningMessage(
          `codeprism engine unreachable at ${engineUrl}`,
        );
        statusBar.setDisconnected();
      }
    }),
    vscode.commands.registerCommand("codeprism.reindex", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Trigger a full re-index of the codebase? This runs the indexer CLI.",
        "Yes",
        "Cancel",
      );
      if (confirm !== "Yes") return;

      const terminal = vscode.window.createTerminal("codeprism reindex");
      terminal.show();
      terminal.sendText(
        `cd "${workspaceRoot}" && npx codeprism-index || echo "Run the indexer from the codeprism directory"`,
      );
    }),
  );

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("codeprism")) {
      const newConfig = vscode.workspace.getConfiguration("codeprism");
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
