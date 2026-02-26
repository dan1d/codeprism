/**
 * Minimal vscode API mock for unit tests.
 * Only covers what GitWatcher, StatusBar, and SyncClient actually use.
 */

import { vi } from "vitest";

export const StatusBarAlignment = { Right: 2, Left: 1 };

export class ThemeColor {
  constructor(public id: string) {}
}

export class Uri {
  constructor(
    public scheme: string,
    public fsPath: string,
  ) {}

  static file(path: string): Uri {
    return new Uri("file", path);
  }
}

export const mockStatusBarItem = {
  text: "",
  tooltip: "",
  command: "",
  backgroundColor: undefined as ThemeColor | undefined,
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
};

export const mockFileSystemWatcher = {
  onDidCreate: vi.fn((_cb: (uri: Uri) => void) => ({ dispose: vi.fn() })),
  onDidChange: vi.fn((_cb: (uri: Uri) => void) => ({ dispose: vi.fn() })),
  onDidDelete: vi.fn((_cb: (uri: Uri) => void) => ({ dispose: vi.fn() })),
  dispose: vi.fn(),
};

export const window = {
  createStatusBarItem: vi.fn(() => mockStatusBarItem),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  setStatusBarMessage: vi.fn(),
  createTerminal: vi.fn(() => ({ show: vi.fn(), sendText: vi.fn() })),
};

export const workspace = {
  createFileSystemWatcher: vi.fn(() => mockFileSystemWatcher),
  onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  workspaceFolders: undefined as { uri: { fsPath: string } }[] | undefined,
  getConfiguration: vi.fn((_section: string) => ({
    get: vi.fn((_key: string, def: unknown) => def),
  })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
};

export const commands = {
  registerCommand: vi.fn((_cmd: string, _handler: () => void) => ({ dispose: vi.fn() })),
};

export class Disposable {
  constructor(private callOnDispose: () => void) {}
  dispose() { this.callOnDispose(); }
}
