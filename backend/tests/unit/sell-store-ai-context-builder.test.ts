import { buildSellStoreAIContext } from "../../src/modules/sell-vs-store/ai/sell-store-ai-context.builder";
import { ResolvedDecisionInput } from "../../src/modules/sell-vs-store/sell-store-input-resolver.types";
import { DecisionEngineResult } from "../../src/modules/sell-vs-store/sell-store-decision-engine.types";

describe("buildSellStoreAIContext", () => {
  const fullInput: ResolvedDecisionInput = {
    snapshot: {
      market: {
        modalPrice: 2100,
        trend: "UP",
        volatility: 0.12,
        freshness: "FRESH",
        confidence: 0.9,
        sourceTimestamp: "2026-08-01T00:00:00.000Z",
      },
      lot: {
        quantity: 500,
        unit: "KG",
        cropName: "Wheat",
        qualityGrade: "A",
      },
      storage: {
        availability: null,
        costPerUnit: null,
        durationDays: null,
        constraints: null,
        spoilageRisk: null,
      },
    },
    availability: { market: true, quality: true, storage: "UNKNOWN" },
    missingInputs: ["STORAGE_DATA"],
    timestamps: { marketDataTimestamp: new Date("2026-08-01"), storageDataTimestamp: null },
  };

  const decisionResult: DecisionEngineResult = {
    result: "SELL_NOW",
    sellScore: 80,
    storeScore: 20,
    confidence: 0.85,
    factorsUsed: ["MARKET_TREND", "QUALITY_CONSTRAINTS"],
    omittedFactors: ["STORAGE_RISK"],
    insufficiencyReasons: [],
  };

  it("1. returns the expected compact context shape", () => {
    const context = buildSellStoreAIContext(fullInput, decisionResult);

    expect(context).toEqual({
      crop: { name: "Wheat", quantity: 500, unit: "KG", qualityGrade: "A" },
      market: { modalPrice: 2100, trend: "UP", volatility: 0.12, freshness: "FRESH", confidence: 0.9 },
      storage: { availability: "UNKNOWN", costPerUnit: null, durationDays: null, spoilageRisk: null, constraints: null },
      deterministicDecision: {
        result: "SELL_NOW",
        confidence: 0.85,
        sellScore: 80,
        storeScore: 20,
        factorsUsed: ["MARKET_TREND", "QUALITY_CONSTRAINTS"],
        omittedFactors: ["STORAGE_RISK"],
        insufficiencyReasons: [],
      },
    });
  });

  it("2. only contains the allow-listed top-level keys (no extra fields)", () => {
    const context = buildSellStoreAIContext(fullInput, decisionResult);
    expect(Object.keys(context).sort()).toEqual(["crop", "deterministicDecision", "market", "storage"]);
  });

  it("3. excludes database IDs, user identity, and coordinates — nothing in the context resembles them", () => {
    const context = buildSellStoreAIContext(fullInput, decisionResult);
    const serialized = JSON.stringify(context);

    // None of these keys/values ever appear anywhere in the built context.
    expect(serialized).not.toMatch(/"id"/i);
    expect(serialized).not.toMatch(/lotId|cropId|userId|requestedByUserId/i);
    expect(serialized).not.toMatch(/latitude|longitude/i);
    expect(serialized).not.toMatch(/email|phone|mobile|address/i);
  });

  it("4. does not forward raw market history — only the resolver's already-aggregated fields", () => {
    const context = buildSellStoreAIContext(fullInput, decisionResult);
    // The context has no array-of-records field anywhere except the
    // engine's own bounded factor lists.
    expect(context.market).not.toHaveProperty("history");
    expect(context.market).not.toHaveProperty("records");
  });

  it("5. represents unavailable market/storage data as null, never fabricated", () => {
    const sparseInput: ResolvedDecisionInput = {
      snapshot: {
        market: {
          modalPrice: null,
          trend: null,
          volatility: null,
          freshness: null,
          confidence: null,
          sourceTimestamp: null,
        },
        lot: { quantity: 10, unit: "KG", cropName: "Onion", qualityGrade: null },
        storage: { availability: null, costPerUnit: null, durationDays: null, constraints: null, spoilageRisk: null },
      },
      availability: { market: false, quality: false, storage: "UNKNOWN" },
      missingInputs: ["MARKET_DATA", "QUALITY_GRADE", "STORAGE_DATA"],
      timestamps: { marketDataTimestamp: null, storageDataTimestamp: null },
    };
    const insufficientResult: DecisionEngineResult = {
      result: "INSUFFICIENT_DATA",
      sellScore: null,
      storeScore: null,
      confidence: 0,
      factorsUsed: [],
      omittedFactors: ["MARKET_TREND", "VOLATILITY", "STORAGE_RISK", "QUALITY_CONSTRAINTS"],
      insufficiencyReasons: ["MISSING_MARKET_DATA"],
    };

    const context = buildSellStoreAIContext(sparseInput, insufficientResult);

    expect(context.market.modalPrice).toBeNull();
    expect(context.market.trend).toBeNull();
    expect(context.crop.qualityGrade).toBeNull();
    expect(context.storage.costPerUnit).toBeNull();
    expect(context.storage.availability).toBe("UNKNOWN");
    expect(context.deterministicDecision.result).toBe("INSUFFICIENT_DATA");
    expect(context.deterministicDecision.sellScore).toBeNull();
  });

  it("6. reflects the deterministic result exactly as computed, never altering it", () => {
    const context = buildSellStoreAIContext(fullInput, decisionResult);
    expect(context.deterministicDecision).toEqual({
      result: decisionResult.result,
      confidence: decisionResult.confidence,
      sellScore: decisionResult.sellScore,
      storeScore: decisionResult.storeScore,
      factorsUsed: decisionResult.factorsUsed,
      omittedFactors: decisionResult.omittedFactors,
      insufficiencyReasons: decisionResult.insufficiencyReasons,
    });
  });
});
