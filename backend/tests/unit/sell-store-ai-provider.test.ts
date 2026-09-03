import { UnavailableSellStoreAIProvider } from "../../src/modules/sell-vs-store/ai/sell-store-ai.provider";
import { SellStoreAIProviderError } from "../../src/modules/sell-vs-store/ai/sell-store-ai.types";
import { SellStoreAIContext } from "../../src/modules/sell-vs-store/ai/sell-store-ai.types";

describe("UnavailableSellStoreAIProvider", () => {
  const provider = new UnavailableSellStoreAIProvider();

  const fakeContext: SellStoreAIContext = {
    crop: { name: "Wheat", quantity: 100, unit: "KG", qualityGrade: "A" },
    market: { modalPrice: 2000, trend: "UP", volatility: 0.1, freshness: "FRESH", confidence: 0.8 },
    storage: { availability: "UNKNOWN", costPerUnit: null, durationDays: null, spoilageRisk: null, constraints: null },
    deterministicDecision: {
      result: "SELL_NOW",
      confidence: 0.8,
      sellScore: 70,
      storeScore: 30,
      factorsUsed: ["MARKET_TREND"],
      omittedFactors: [],
      insufficiencyReasons: [],
    },
  };

  it("1. exposes a stable name/modelVersion identifying it as unavailable", () => {
    expect(provider.name).toBe("unavailable");
    expect(provider.modelVersion).toBe("n/a");
  });

  it("2. analyze() always rejects — it never resolves with a fabricated result", async () => {
    await expect(provider.analyze(fakeContext)).rejects.toBeInstanceOf(SellStoreAIProviderError);
  });

  it("3. rejects with the stable AI_ADVISORY_UNAVAILABLE code", async () => {
    await expect(provider.analyze(fakeContext)).rejects.toMatchObject({ code: "AI_ADVISORY_UNAVAILABLE" });
  });
});
