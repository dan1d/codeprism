import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const { getInstanceInfo, updateInstanceInfo, getSettings, updateSettings, maskApiKey, isMasked, getEngineVersion } =
  await import("../../services/instance.js");

describe("instance service", () => {
  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb.close(); });

  describe("maskApiKey", () => {
    it("masks a long key preserving prefix and suffix", () => {
      const masked = maskApiKey("sk-1234567890abcdef");
      expect(masked.startsWith("sk-1234")).toBe(true);
      expect(masked.endsWith("cdef")).toBe(true);
      expect(masked).toContain("\u2022");
    });

    it("fully masks short keys", () => {
      const masked = maskApiKey("short");
      expect(masked).toBe("\u2022\u2022\u2022\u2022\u2022");
    });

    it("returns empty string for empty input", () => {
      expect(maskApiKey("")).toBe("");
    });
  });

  describe("isMasked", () => {
    it("detects masked values", () => {
      expect(isMasked("sk-1234\u2022\u2022\u2022\u2022cdef")).toBe(true);
    });

    it("returns false for unmasked values", () => {
      expect(isMasked("sk-1234567890abcdef")).toBe(false);
    });
  });

  describe("getEngineVersion", () => {
    it("returns a semver string", () => {
      const ver = getEngineVersion();
      expect(ver).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe("getInstanceInfo", () => {
    it("returns defaults when instance_profile is unseeded", () => {
      const info = getInstanceInfo();
      expect(info.plan).toBe("self_hosted");
      expect(info.engineVersion).toBeTruthy();
      expect(info).toHaveProperty("instanceId");
      expect(info).toHaveProperty("companyName");
    });
  });

  describe("updateInstanceInfo", () => {
    it("updates company name", () => {
      updateInstanceInfo("Acme Corp");
      const info = getInstanceInfo();
      expect(info.companyName).toBe("Acme Corp");
    });

    it("updates plan", () => {
      updateInstanceInfo(undefined, "pro");
      const info = getInstanceInfo();
      expect(info.plan).toBe("pro");
    });
  });

  describe("getSettings / updateSettings", () => {
    it("returns empty config for fresh DB", () => {
      const s = getSettings();
      expect(typeof s).toBe("object");
    });

    it("stores and retrieves a setting", () => {
      updateSettings({ hub_penalty: "0.3" });
      const s = getSettings();
      expect(s["hub_penalty"]).toBe("0.3");
    });

    it("masks llm_api_key in getSettings output", () => {
      updateSettings({ llm_api_key: "sk-1234567890abcdef" });
      const s = getSettings();
      expect(s["llm_api_key"]).toContain("\u2022");
      expect(s["llm_api_key_configured"]).toBe("true");
    });

    it("skips masked values on updateSettings (does not overwrite real key)", () => {
      updateSettings({ llm_api_key: "sk-real-key-here-abc" });
      const before = testDb.prepare("SELECT value FROM search_config WHERE key = 'llm_api_key'").get() as { value: string };
      expect(before.value).toBe("sk-real-key-here-abc");

      updateSettings({ llm_api_key: maskApiKey("sk-real-key-here-abc") });
      const after = testDb.prepare("SELECT value FROM search_config WHERE key = 'llm_api_key'").get() as { value: string };
      expect(after.value).toBe("sk-real-key-here-abc");
    });
  });
});
