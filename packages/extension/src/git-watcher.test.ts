/**
 * GitWatcher unit tests.
 *
 * Covers the two things that must work before production:
 *   1. File filtering — node_modules, .git, out-of-workspace, non-file URIs are all ignored.
 *   2. Payload building — branch name, repo name, and file action mapping are correct.
 *
 * vscode is mocked (no VS Code binary needed).
 * child_process is vi.mock'd at module level (required for ESM).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", () => import("./__mocks__/vscode.js"));

// ESM-compatible child_process mock — must use vi.mock factory, not vi.spyOn
vi.mock("node:child_process", () => {
  const execSync = vi.fn();
  return { execSync, default: { execSync } };
});

vi.mock("node:fs", () => {
  const readFileSync = vi.fn(() => "file contents");
  return { readFileSync, default: { readFileSync } };
});

import * as cp from "node:child_process";
import { Uri, mockFileSystemWatcher } from "./__mocks__/vscode.js";
import { GitWatcher } from "./git-watcher.js";

const WORKSPACE = "/home/user/myrepo";
const execSyncMock = vi.mocked(cp.execSync);

function makeUri(fsPath: string, scheme = "file"): Uri {
  return new Uri(scheme, fsPath);
}

function setGitOutputs(opts: { branch?: string; status?: string; diff?: string }) {
  execSyncMock.mockImplementation((cmd: unknown) => {
    const c = cmd as string;
    if (c.includes("rev-parse --abbrev-ref")) {
      if (opts.branch === undefined) throw new Error("no branch");
      return opts.branch as unknown as ReturnType<typeof cp.execSync>;
    }
    if (c.includes("git status")) return (opts.status ?? "") as unknown as ReturnType<typeof cp.execSync>;
    if (c.includes("git diff")) return (opts.diff ?? "") as unknown as ReturnType<typeof cp.execSync>;
    return "" as unknown as ReturnType<typeof cp.execSync>;
  });
}

describe("GitWatcher — file filtering", () => {
  let watcher: GitWatcher;
  let payloads: Parameters<NonNullable<GitWatcher["onSyncReady"]>>[0][];

  beforeEach(() => {
    vi.clearAllMocks();
    payloads = [];
    watcher = new GitWatcher(WORKSPACE);
    watcher.onSyncReady = (p) => payloads.push(p);
    setGitOutputs({ branch: "main", status: "M  app/models/user.rb" });
  });

  it("ignores URIs with non-file scheme", async () => {
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
    cb(makeUri("git://remote/file.rb", "git"));
    await watcher.syncNow();
    expect(payloads).toHaveLength(0);
  });

  it("ignores paths outside the workspace root", async () => {
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
    cb(makeUri("/home/user/otherrepo/file.rb"));
    await watcher.syncNow();
    expect(payloads).toHaveLength(0);
  });

  it("ignores node_modules paths", async () => {
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/node_modules/lodash/index.js`));
    await watcher.syncNow();
    expect(payloads).toHaveLength(0);
  });

  it("ignores .git directory paths", async () => {
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/.git/COMMIT_EDITMSG`));
    await watcher.syncNow();
    expect(payloads).toHaveLength(0);
  });

  it("passes through valid workspace files", async () => {
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/app/models/user.rb`));
    await watcher.syncNow();
    expect(payloads).toHaveLength(1);
  });
});

describe("GitWatcher — payload building", () => {
  let watcher: GitWatcher;
  let payloads: Parameters<NonNullable<GitWatcher["onSyncReady"]>>[0][];

  beforeEach(() => {
    vi.clearAllMocks();
    payloads = [];
    watcher = new GitWatcher(WORKSPACE);
    watcher.onSyncReady = (p) => payloads.push(p);
  });

  it("sets repo to the workspace directory name", async () => {
    setGitOutputs({ branch: "main", status: "M  app/models/user.rb" });
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/app/models/user.rb`));
    await watcher.syncNow();
    expect(payloads[0].repo).toBe("myrepo");
  });

  it("sets branch from git rev-parse", async () => {
    setGitOutputs({ branch: "feature/auth", status: "M  file.rb" });
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/file.rb`));
    await watcher.syncNow();
    expect(payloads[0].branch).toBe("feature/auth");
  });

  it("maps git status '??' to action add", async () => {
    setGitOutputs({ branch: "main", status: "?? app/models/new.rb" });
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidCreate.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/app/models/new.rb`));
    await watcher.syncNow();
    expect(payloads[0].changedFiles[0].status).toBe("added");
  });

  it("maps git status 'A ' to action add", async () => {
    setGitOutputs({ branch: "main", status: "A  app/models/new.rb" });
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidCreate.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/app/models/new.rb`));
    await watcher.syncNow();
    expect(payloads[0].changedFiles[0].status).toBe("added");
  });

  it("maps git status 'D ' to action delete", async () => {
    setGitOutputs({ branch: "main", status: "D  app/models/old.rb" });
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidDelete.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/app/models/old.rb`));
    await watcher.syncNow();
    expect(payloads[0].changedFiles[0].status).toBe("deleted");
  });

  it("maps git status 'M ' to action modify and includes content", async () => {
    setGitOutputs({ branch: "main", status: "M  app/models/user.rb" });
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/app/models/user.rb`));
    await watcher.syncNow();
    expect(payloads[0].changedFiles[0].status).toBe("modified");
    expect(payloads[0].changedFiles[0].content).toBe("file contents");
  });

  it("uses relative paths in the file list", async () => {
    setGitOutputs({ branch: "main", status: "M  app/services/billing.rb" });
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/app/services/billing.rb`));
    await watcher.syncNow();
    expect(payloads[0].changedFiles[0].path).toBe("app/services/billing.rb");
  });

  it("deduplicates rapid changes to the same file", async () => {
    setGitOutputs({ branch: "main", status: "M  app/models/user.rb" });
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/app/models/user.rb`));
    cb(makeUri(`${WORKSPACE}/app/models/user.rb`));
    cb(makeUri(`${WORKSPACE}/app/models/user.rb`));
    await watcher.syncNow();
    expect(payloads[0].changedFiles).toHaveLength(1);
  });

  it("falls back to branch 'unknown' when git rev-parse fails", async () => {
    setGitOutputs({ status: "M  file.rb" }); // branch: undefined → throws
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/file.rb`));
    await watcher.syncNow();
    expect(payloads[0].branch).toBe("unknown");
  });

  it("sets eventType=save in the payload", async () => {
    setGitOutputs({ branch: "main", status: "M  file.rb" });
    watcher.start(0);
    const cb = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
    cb(makeUri(`${WORKSPACE}/file.rb`));
    await watcher.syncNow();
    expect(payloads[0].eventType).toBe("save");
  });
});

describe("GitWatcher — dispose", () => {
  it("disposes all internal disposables without throwing", () => {
    vi.clearAllMocks();
    setGitOutputs({ branch: "main", status: "" });
    const watcher = new GitWatcher(WORKSPACE);
    watcher.start(0);
    expect(() => watcher.dispose()).not.toThrow();
    expect(mockFileSystemWatcher.dispose).toHaveBeenCalled();
  });
});
