import * as vscode from "vscode";

type ConnectionState = "connected" | "disconnected" | "syncing";

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private state: ConnectionState = "disconnected";
  private cardCount = 0;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      50,
    );
    this.item.command = "srcmap.showStatus";
    this.render();
    this.item.show();
  }

  setConnected(cards: number): void {
    this.state = "connected";
    this.cardCount = cards;
    this.render();
  }

  setDisconnected(): void {
    this.state = "disconnected";
    this.render();
  }

  setSyncing(): void {
    this.state = "syncing";
    this.render();
  }

  private render(): void {
    switch (this.state) {
      case "connected":
        this.item.text = `$(database) srcmap: ${this.cardCount} cards`;
        this.item.tooltip = "srcmap connected – click for status";
        this.item.backgroundColor = undefined;
        break;
      case "syncing":
        this.item.text = "$(sync~spin) srcmap: syncing...";
        this.item.tooltip = "Syncing changes to srcmap engine";
        this.item.backgroundColor = undefined;
        break;
      case "disconnected":
        this.item.text = "$(warning) srcmap: offline";
        this.item.tooltip = "Cannot reach srcmap engine – click to retry";
        this.item.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        );
        break;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
