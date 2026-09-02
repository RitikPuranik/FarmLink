import { Prisma } from "@prisma/client";
import { SellStoreOrchestrationService } from "../../src/modules/sell-vs-store/sell-store-orchestration.service";
import { NotFoundError } from "../../src/common/errors";
import { ResolvedDecisionInput } from "../../src/modules/sell-vs-store/sell-store-input-resolver.types";
import { DecisionEngineResult } from "../../src/modules/sell-vs-store/sell-store-decision-engine.types";

describe("SellStoreOrchestrationService", () => {
  let orchestrationService: SellStoreOrchestrationService;
  let lotsRepositoryMock: any;
  let decisionRepositoryMock: any;
  let resolverServiceMock: any;
  let engineServiceMock: any;

  beforeEach(() => {
    lotsRepositoryMock = {
      findByPublicId: jest.fn(),
    };
    decisionRepositoryMock = {
      createDecision: jest.fn(),
      completeDecision: jest.fn(),
      failDecision: jest.fn(),
      findByPublicId: jest.fn(),
      listByLotId: jest.fn(),
    };
    resolverServiceMock = {
      resolveDecisionInputs: jest.fn(),
    };
    engineServiceMock = {
      evaluate: jest.fn(),
    };

    orchestrationService = new SellStoreOrchestrationService(
      lotsRepositoryMock,
      decisionRepositoryMock,
      resolverServiceMock,
      engineServiceMock
    );
  });

  const lotFixture = { id: "lot-1", publicId: "public-lot-1", cropId: "crop-1" };
  const mockSnapshot = { market: { trend: "UP" } }; // minimal mock
  const mockTimestamps = { marketDataTimestamp: new Date(), storageDataTimestamp: null };
  const resolvedInputFixture: ResolvedDecisionInput = {
    snapshot: mockSnapshot as any,
    availability: { market: true, quality: true, storage: "UNKNOWN" },
    missingInputs: [],
    timestamps: mockTimestamps,
  };

  it("1. Orchestrates a complete successful decision", async () => {
    lotsRepositoryMock.findByPublicId.mockResolvedValue(lotFixture);
    resolverServiceMock.resolveDecisionInputs.mockResolvedValue(resolvedInputFixture);

    const pendingRecord = { id: "dec-1", status: "PENDING" };
    decisionRepositoryMock.createDecision.mockResolvedValue(pendingRecord);

    const engineResult: DecisionEngineResult = {
      result: "SELL_NOW",
      sellScore: 80,
      storeScore: 20,
      confidence: 0.9,
      factorsUsed: ["MARKET_TREND"],
      omittedFactors: [],
      insufficiencyReasons: [],
    };
    engineServiceMock.evaluate.mockReturnValue(engineResult);

    const completedRecord = {
      id: "dec-1",
      publicId: "pub-dec-1",
      status: "COMPLETED",
      result: "SELL_NOW",
      confidenceScore: new Prisma.Decimal(0.9),
      inputSnapshot: mockSnapshot,
      decisionMetadata: {
        engineVersion: "v1",
        sellScore: 80,
        storeScore: 20,
        factorsUsed: ["MARKET_TREND"],
        omittedFactors: [],
        insufficiencyReasons: [],
      },
    };
    decisionRepositoryMock.completeDecision.mockResolvedValue(completedRecord);

    const result = await orchestrationService.generateDecision("public-lot-1", "user-1");

    // Assertions
    expect(resolverServiceMock.resolveDecisionInputs).toHaveBeenCalledWith("public-lot-1");
    expect(decisionRepositoryMock.createDecision).toHaveBeenCalledWith(
      "lot-1",
      "crop-1",
      "user-1",
      mockSnapshot,
      mockTimestamps.marketDataTimestamp,
      mockTimestamps.storageDataTimestamp
    );
    expect(engineServiceMock.evaluate).toHaveBeenCalledWith(resolvedInputFixture);
    expect(decisionRepositoryMock.completeDecision).toHaveBeenCalledWith(
      "dec-1",
      "SELL_NOW",
      0.9,
      mockSnapshot,
      expect.objectContaining({ engineVersion: "v1", sellScore: 80 }),
      mockTimestamps.marketDataTimestamp,
      mockTimestamps.storageDataTimestamp
    );
    expect(result.status).toBe("COMPLETED");
    expect(result.result).toBe("SELL_NOW");
  });

  it("2. Treats INSUFFICIENT_DATA as a successful completion, not a failure", async () => {
    lotsRepositoryMock.findByPublicId.mockResolvedValue(lotFixture);
    resolverServiceMock.resolveDecisionInputs.mockResolvedValue(resolvedInputFixture);
    decisionRepositoryMock.createDecision.mockResolvedValue({ id: "dec-2", status: "PENDING" });

    const engineResult: DecisionEngineResult = {
      result: "INSUFFICIENT_DATA",
      sellScore: null,
      storeScore: null,
      confidence: 0,
      factorsUsed: [],
      omittedFactors: ["MARKET_TREND"],
      insufficiencyReasons: ["MISSING_MARKET_DATA"],
    };
    engineServiceMock.evaluate.mockReturnValue(engineResult);

    const completedRecord = {
      id: "dec-2",
      publicId: "pub-dec-2",
      status: "COMPLETED",
      result: "INSUFFICIENT_DATA",
      confidenceScore: new Prisma.Decimal(0),
    };
    decisionRepositoryMock.completeDecision.mockResolvedValue(completedRecord);

    const result = await orchestrationService.generateDecision("public-lot-1");

    expect(decisionRepositoryMock.completeDecision).toHaveBeenCalledWith(
      "dec-2",
      "INSUFFICIENT_DATA",
      0,
      expect.any(Object),
      expect.objectContaining({ insufficiencyReasons: ["MISSING_MARKET_DATA"] }),
      mockTimestamps.marketDataTimestamp,
      null
    );
    expect(decisionRepositoryMock.failDecision).not.toHaveBeenCalled();
    expect(result.result).toBe("INSUFFICIENT_DATA");
  });

  it("3. Marks decision as FAILED if an unexpected error occurs after PENDING", async () => {
    lotsRepositoryMock.findByPublicId.mockResolvedValue(lotFixture);
    resolverServiceMock.resolveDecisionInputs.mockResolvedValue(resolvedInputFixture);
    decisionRepositoryMock.createDecision.mockResolvedValue({ id: "dec-fail", status: "PENDING" });

    // Simulate unexpected engine crash
    engineServiceMock.evaluate.mockImplementation(() => {
      throw new Error("Unexpected engine crash");
    });

    await expect(orchestrationService.generateDecision("public-lot-1")).rejects.toThrow("Unexpected engine crash");

    expect(decisionRepositoryMock.failDecision).toHaveBeenCalledWith("dec-fail");
    expect(decisionRepositoryMock.completeDecision).not.toHaveBeenCalled();
  });

  it("4. Retrieves historical decision accurately using mapped DTO", async () => {
    const historicalRecord = {
      id: "dec-hist",
      publicId: "hist-pub",
      status: "COMPLETED",
      result: "STORE",
      confidenceScore: new Prisma.Decimal(0.85),
      inputSnapshot: mockSnapshot,
      decisionMetadata: { engineVersion: "v1" },
    };
    decisionRepositoryMock.findByPublicId.mockResolvedValue(historicalRecord);

    const result = await orchestrationService.getDecisionByPublicId("hist-pub");

    expect(result.publicId).toBe("hist-pub");
    expect(result.result).toBe("STORE");
    expect(result.confidenceScore).toBe(0.85);
    expect(result.inputSnapshot).toEqual(mockSnapshot);
    expect(result.decisionMetadata?.engineVersion).toBe("v1");
  });

  it("5. Throws NotFound if retrieving non-existent decision", async () => {
    decisionRepositoryMock.findByPublicId.mockResolvedValue(null);
    await expect(orchestrationService.getDecisionByPublicId("nope")).rejects.toThrow(NotFoundError);
  });
});
