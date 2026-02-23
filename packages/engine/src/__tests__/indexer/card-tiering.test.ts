import { describe, it, expect } from "vitest";
import { getFlowHeat, cardTier } from "../../indexer/card-generator.js";

describe("getFlowHeat", () => {
  it("returns average heat across flow files", () => {
    const thermal = new Map([
      ["app/controllers/auth.rb", 0.9],
      ["app/models/user.rb", 0.5],
      ["app/services/auth_service.rb", 0.8],
    ]);
    const heat = getFlowHeat(
      ["app/controllers/auth.rb", "app/models/user.rb", "app/services/auth_service.rb"],
      thermal,
    );
    expect(heat).toBeCloseTo((0.9 + 0.5 + 0.8) / 3, 5);
  });

  it("returns 0 for files not in thermal map", () => {
    const thermal = new Map<string, number>();
    expect(getFlowHeat(["cold/file.rb"], thermal)).toBe(0);
  });

  it("returns 0 for empty file list", () => {
    const thermal = new Map([["file.rb", 0.9]]);
    expect(getFlowHeat([], thermal)).toBe(0);
  });

  it("treats missing files as heat 0", () => {
    const thermal = new Map([["hot.rb", 1.0]]);
    const heat = getFlowHeat(["hot.rb", "cold.rb"], thermal);
    expect(heat).toBe(0.5);
  });
});

describe("cardTier", () => {
  it("classifies heat > 0.6 as premium", () => {
    expect(cardTier(0.9)).toBe("premium");
    expect(cardTier(0.61)).toBe("premium");
    expect(cardTier(1.0)).toBe("premium");
  });

  it("classifies 0.3–0.6 as standard", () => {
    expect(cardTier(0.6)).toBe("standard");
    expect(cardTier(0.45)).toBe("standard");
    expect(cardTier(0.31)).toBe("standard");
  });

  it("classifies < 0.3 as structural", () => {
    expect(cardTier(0.3)).toBe("structural");
    expect(cardTier(0.1)).toBe("structural");
    expect(cardTier(0)).toBe("structural");
  });
});
