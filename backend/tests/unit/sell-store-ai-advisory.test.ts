import { SellStoreOrchestrationService } from "../../src/modules/sell-vs-store/sell-store-orchestration.service";
import { ResolvedDecisionInput } from "../../src/modules/sell-vs-store/sell-store-input-resolver.types";
import { DecisionEngineResult } from "../../src/modules/sell-vs-store/sell-store-decision-engine.types";
import { SellStoreAIProvider } from "../../src/modules/sell-vs-store/ai/sell-store-ai.provider";
import { UnavailableSellStoreAIProvider } from "../../src/modules/sell-vs-store/ai/sell-store-ai.provider";
import { SellStoreAIProviderError } from "../../src/modules/sell-vs-store/ai/sell-store-ai.types";

describe("SellStoreOrchestrationService — AI advisory (Module 8 Part 6)", () => {
  let lotsRepositoryMock: any;
  let decisionRepositoryMock: any;
  let resolverServiceMock: any;
  let engineServiceMock: any;
  let callOrder: string[];

  const lotFixture = { id: "lot-1", publicId: "public-lot-1", cropId: "crop-1" };
  const mockSnapshot = {
    market: { modalPrice: 2000, trend: "UP", volatility: 0.1, freshness: "FRESH", confidence: 0.8, sourceTimestamp: null },
    lot: { quantity: 100, unit: "KG", cropName: "Wheat", qualityGrade: "A" },
    storage: { availability: null, costPerUnit: null, durationDays: null, constraints: null, spoilageRisk: null },
  };
  const mockTimestamps = { marketDataTimestamp: new Date(), storageDataTimestamp: null };
  const resolvedInputFixture: ResolvedDecisionInput = {
    snapshot: mockSnapshot as any,
    availability: { market: true, quality: true, storage: "UNKNOWN" },
    missingInputs: [],
    timestamps: mockTimestamps,
  };
  const engineResult: DecisionEngineResult = {
    result: "SELL_NOW",
    sellScore: 80,
    storeScore: 20,
    confidence: 0.9,
    factorsUsed: ["MARKET_TREND"],
    omittedFactors: [],
    insufficiencyReasons: [],
  };
  const completedRecord = {
    id: "dec-1",
    publicId: "pub-dec-1",
    lotId: "lot-1",
    cropId: "crop-1",
    requestedByUserId: "user-1",
    status: "COMPLETED",
    result: "SELL_NOW",
    confidenceScore: 0.9,
    inputSnapshot: mockSnapshot,
    decisionMetadata: {
      engineVersion: "v1",
      sellScore: 80,
      storeScore: 20,
      factorsUsed: ["MARKET_TREND"],
      omittedFactors: [],
      insufficiencyReasons: [],
    },
    marketDataTimestamp: mockTimestamps.marketDataTimestamp,
    storageDataTimestamp: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const validAdvisory = {
    summary: "Available data shows an upward price trend with strong confidence.",
    reasoning: ["Market trend is UP.", "Quality grade A supports the deterministic result."],
    risks: ["Storage feasibility is unknown."],
    considerations: ["Consider local mandi arrival volumes before acting."],
    dataLimitations: ["Storage cost and duration are not currently available."],
    advisoryAlignment: { agreesWithDeterministicDecision: true, explanation: "Evidence broadly supports SELL_NOW." },
  };

  beforeEach(() => {
    callOrder = [];
    lotsRepositoryMock = { findByPublicId: jest.fn().mockResolvedValue(lotFixture) };
    decisionRepositoryMock = {
      createDecision: jest.fn().mockImplementation(async () => {
        callOrder.push("createDecision");
        return { id: "dec-1", status: "PENDING" };
      }),
      completeDecision: jest.fn().mockImplementation(async () => {
        callOrder.push("completeDecision");
        return completedRecord;
      }),
      failDecision: jest.fn().mockResolvedValue({ ...completedRecord, status: "FAILED" }),
      findByPublicId: jest.fn(),
      listByLotId: jest.fn(),
    };
    resolverServiceMock = {
      resolveDecisionInputs: jest.fn().mockImplementation(async () => {
        callOrder.push("resolveDecisionInputs");
        return resolvedInputFixture;
      }),
    };
    engineServiceMock = {
      evaluate: jest.fn().mockImplementation(() => {
        callOrder.push("evaluate");
        return engineResult;
      }),
    };
  });

  function makeOrchestrator(aiProvider?: SellStoreAIProvider) {
    return new SellStoreOrchestrationService(
      lotsRepositoryMock,
      decisionRepositoryMock,
      resolverServiceMock,
      engineServiceMock,
      aiProvider
    );
  }

  it("1. defaults to UnavailableSellStoreAIProvider when no provider is supplied (backward-compatible construction)", async () => {
    // Constructing with only 4 args must still work — mirrors the existing
    // sell-store-orchestration.service.test.ts constructor call.
    const orchestrator = new SellStoreOrchestrationService(
      lotsRepositoryMock,
      decisionRepositoryMock,
      resolverServiceMock,
      engineServiceMock
    );

    const result = await orchestrator.generateDecision("public-lot-1", "user-1");

    expect(result.aiAdvisory).toBeNull();
    expect(result.result).toBe("SELL_NOW"); // deterministic decision unaffected
  });

  it("2. on a successful AI response, aiAdvisory is populated and the deterministic fields are untouched", async () => {
    const fakeProvider: SellStoreAIProvider = {
      name: "fake",
      modelVersion: "test-1",
      analyze: jest.fn().mockImplementation(async () => {
        callOrder.push("aiProvider.analyze");
        return validAdvisory;
      }),
    };

    const orchestrator = makeOrchestrator(fakeProvider);
    const result = await orchestrator.generateDecision("public-lot-1", "user-1");

    expect(result.aiAdvisory).toEqual(validAdvisory);
    // AI cannot modify deterministic result/scores/metadata (tests 13-15).
    expect(result.result).toBe("SELL_NOW");
    expect(result.confidenceScore).toBe(0.9);
    expect(result.decisionMetadata).toEqual(completedRecord.decisionMetadata);
  });

  it("3. AI is called only after the deterministic decision is persisted (execution order)", async () => {
    const fakeProvider: SellStoreAIProvider = {
      name: "fake",
      modelVersion: "test-1",
      analyze: jest.fn().mockImplementation(async () => {
        callOrder.push("aiProvider.analyze");
        return validAdvisory;
      }),
    };

    const orchestrator = makeOrchestrator(fakeProvider);
    await orchestrator.generateDecision("public-lot-1", "user-1");

    expect(callOrder).toEqual([
      "resolveDecisionInputs",
      "createDecision",
      "evaluate",
      "completeDecision",
      "aiProvider.analyze",
    ]);
  });

  it("4. provider failure returns aiAdvisory = null and the deterministic decision still succeeds", async () => {
    const failingProvider: SellStoreAIProvider = {
      name: "fake-failing",
      modelVersion: "test-1",
      analyze: jest.fn().mockRejectedValue(new SellStoreAIProviderError("AI_ADVISORY_FAILED", "boom")),
    };

    const orchestrator = makeOrchestrator(failingProvider);
    const result = await orchestrator.generateDecision("public-lot-1", "user-1");

    expect(result.aiAdvisory).toBeNull();
    expect(result.status).toBe("COMPLETED");
    expect(result.result).toBe("SELL_NOW");
    expect(decisionRepositoryMock.failDecision).not.toHaveBeenCalled();
  });

  it("5. provider timeout returns aiAdvisory = null and the deterministic decision still succeeds", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    const timingOutProvider: SellStoreAIProvider = {
      name: "fake-timeout",
      modelVersion: "test-1",
      analyze: jest.fn().mockRejectedValue(timeoutError),
    };

    const orchestrator = makeOrchestrator(timingOutProvider);
    const result = await orchestrator.generateDecision("public-lot-1", "user-1");

    expect(result.aiAdvisory).toBeNull();
    expect(result.status).toBe("COMPLETED");
    expect(decisionRepositoryMock.failDecision).not.toHaveBeenCalled();
  });

  it("6. malformed AI response (fails schema validation) returns aiAdvisory = null, decision still succeeds", async () => {
    const malformedProvider: SellStoreAIProvider = {
      name: "fake-malformed",
      modelVersion: "test-1",
      analyze: jest.fn().mockResolvedValue({ forecast: "prices will rise 20% next week", guaranteedProfit: 5000 }),
    };

    const orchestrator = makeOrchestrator(malformedProvider);
    const result = await orchestrator.generateDecision("public-lot-1", "user-1");

    expect(result.aiAdvisory).toBeNull();
    expect(result.status).toBe("COMPLETED");
    expect(decisionRepositoryMock.failDecision).not.toHaveBeenCalled();
  });

  it("7. the real UnavailableSellStoreAIProvider also degrades gracefully end-to-end", async () => {
    const orchestrator = makeOrchestrator(new UnavailableSellStoreAIProvider());
    const result = await orchestrator.generateDecision("public-lot-1", "user-1");

    expect(result.aiAdvisory).toBeNull();
    expect(result.result).toBe("SELL_NOW");
    expect(result.status).toBe("COMPLETED");
  });

  it("8. historical retrieval never fabricates a persisted aiAdvisory", async () => {
    decisionRepositoryMock.findByPublicId.mockResolvedValue(completedRecord);
    const orchestrator = makeOrchestrator(new UnavailableSellStoreAIProvider());

    const result = await orchestrator.getDecisionByPublicId("pub-dec-1");

    expect(result.aiAdvisory).toBeNull();
    expect(decisionRepositoryMock.findByPublicId).toHaveBeenCalledWith("pub-dec-1");
  });

  it("9. an unexpected engine crash before persistence still fails the decision and never calls the AI provider", async () => {
    const fakeProvider: SellStoreAIProvider = {
      name: "fake",
      modelVersion: "test-1",
      analyze: jest.fn(),
    };
    engineServiceMock.evaluate.mockImplementation(() => {
      throw new Error("Unexpected engine crash");
    });

    const orchestrator = makeOrchestrator(fakeProvider);

    await expect(orchestrator.generateDecision("public-lot-1", "user-1")).rejects.toThrow("Unexpected engine crash");
    expect(decisionRepositoryMock.failDecision).toHaveBeenCalledWith("dec-1");
    expect(fakeProvider.analyze).not.toHaveBeenCalled();
  });
});
