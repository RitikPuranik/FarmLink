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

  it("6. generateDecision throws NotFound for a missing lot without touching the resolver/engine/repository", async () => {
    lotsRepositoryMock.findByPublicId.mockResolvedValue(null);

    await expect(orchestrationService.generateDecision("no-such-lot", "user-1")).rejects.toThrow(NotFoundError);

    expect(resolverServiceMock.resolveDecisionInputs).not.toHaveBeenCalled();
    expect(decisionRepositoryMock.createDecision).not.toHaveBeenCalled();
    expect(engineServiceMock.evaluate).not.toHaveBeenCalled();
  });

  it("7. getDecisionsForLot throws NotFound for a missing lot without querying decisions", async () => {
    lotsRepositoryMock.findByPublicId.mockResolvedValue(null);

    await expect(orchestrationService.getDecisionsForLot("no-such-lot")).rejects.toThrow(NotFoundError);

    expect(decisionRepositoryMock.listByLotId).not.toHaveBeenCalled();
  });

  it("8. getDecisionsForLot returns mapped historical decisions without recomputation (no engine/resolver/AI calls)", async () => {
    lotsRepositoryMock.findByPublicId.mockResolvedValue(lotFixture);
    decisionRepositoryMock.listByLotId.mockResolvedValue([
      {
        id: "dec-a",
        publicId: "pub-dec-a",
        status: "COMPLETED",
        result: "SELL_NOW",
        confidenceScore: new Prisma.Decimal(0.7),
        inputSnapshot: mockSnapshot,
        decisionMetadata: { engineVersion: "v1" },
      },
      {
        id: "dec-b",
        publicId: "pub-dec-b",
        status: "COMPLETED",
        result: "STORE",
        confidenceScore: new Prisma.Decimal(0.6),
        inputSnapshot: mockSnapshot,
        decisionMetadata: { engineVersion: "v1" },
      },
    ]);

    const result = await orchestrationService.getDecisionsForLot("public-lot-1");

    expect(decisionRepositoryMock.listByLotId).toHaveBeenCalledWith("lot-1");
    expect(result).toHaveLength(2);
    expect(result[0].publicId).toBe("pub-dec-a");
    expect(result[1].publicId).toBe("pub-dec-b");
    // Historical reads never recompute or contact the AI provider.
    expect(resolverServiceMock.resolveDecisionInputs).not.toHaveBeenCalled();
    expect(engineServiceMock.evaluate).not.toHaveBeenCalled();
    expect(decisionRepositoryMock.createDecision).not.toHaveBeenCalled();
    // Historical decisions never carry a persisted AI advisory.
    expect(result[0].aiAdvisory).toBeNull();
    expect(result[1].aiAdvisory).toBeNull();
  });

  it("9. Repeated sequential generateDecision calls for the same lot behave independently", async () => {
    lotsRepositoryMock.findByPublicId.mockResolvedValue(lotFixture);
    resolverServiceMock.resolveDecisionInputs.mockResolvedValue(resolvedInputFixture);

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

    decisionRepositoryMock.createDecision
      .mockResolvedValueOnce({ id: "dec-first", status: "PENDING" })
      .mockResolvedValueOnce({ id: "dec-second", status: "PENDING" });
    decisionRepositoryMock.completeDecision
      .mockResolvedValueOnce({ id: "dec-first", publicId: "pub-first", status: "COMPLETED", result: "SELL_NOW" })
      .mockResolvedValueOnce({ id: "dec-second", publicId: "pub-second", status: "COMPLETED", result: "SELL_NOW" });

    const first = await orchestrationService.generateDecision("public-lot-1", "user-1");
    const second = await orchestrationService.generateDecision("public-lot-1", "user-1");

    expect(first.publicId).toBe("pub-first");
    expect(second.publicId).toBe("pub-second");
    expect(decisionRepositoryMock.createDecision).toHaveBeenCalledTimes(2);
    expect(decisionRepositoryMock.completeDecision).toHaveBeenNthCalledWith(
      1,
      "dec-first",
      "SELL_NOW",
      0.9,
      expect.any(Object),
      expect.any(Object),
      mockTimestamps.marketDataTimestamp,
      mockTimestamps.storageDataTimestamp
    );
    expect(decisionRepositoryMock.completeDecision).toHaveBeenNthCalledWith(
      2,
      "dec-second",
      "SELL_NOW",
      0.9,
      expect.any(Object),
      expect.any(Object),
      mockTimestamps.marketDataTimestamp,
      mockTimestamps.storageDataTimestamp
    );
    expect(decisionRepositoryMock.failDecision).not.toHaveBeenCalled();
  });

  describe("audit logging (Part 7)", () => {
    let auditServiceMock: { record: jest.Mock };

    beforeEach(() => {
      auditServiceMock = { record: jest.fn().mockResolvedValue(undefined) };
      // 6th constructor argument: aiProvider defaults, auditService supplied.
      orchestrationService = new SellStoreOrchestrationService(
        lotsRepositoryMock,
        decisionRepositoryMock,
        resolverServiceMock,
        engineServiceMock,
        undefined,
        auditServiceMock as any
      );

      lotsRepositoryMock.findByPublicId.mockResolvedValue(lotFixture);
      resolverServiceMock.resolveDecisionInputs.mockResolvedValue(resolvedInputFixture);
      decisionRepositoryMock.createDecision.mockResolvedValue({ id: "dec-audit", status: "PENDING" });

      const engineResult: DecisionEngineResult = {
        result: "STORE",
        sellScore: 30,
        storeScore: 70,
        confidence: 0.8,
        factorsUsed: ["MARKET_TREND"],
        omittedFactors: [],
        insufficiencyReasons: [],
      };
      engineServiceMock.evaluate.mockReturnValue(engineResult);
      decisionRepositoryMock.completeDecision.mockResolvedValue({
        id: "dec-audit",
        publicId: "pub-dec-audit",
        status: "COMPLETED",
        result: "STORE",
      });
    });

    it("10. Records SELL_STORE_DECISION_GENERATED after a successful decision", async () => {
      const result = await orchestrationService.generateDecision("public-lot-1", "user-1");

      expect(auditServiceMock.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: "user-1",
          action: "SELL_STORE_DECISION_GENERATED",
          entityType: "SellStoreDecision",
          entityId: "pub-dec-audit",
          metadata: expect.objectContaining({ lotPublicId: "public-lot-1", result: "STORE" }),
        })
      );
      expect(result.publicId).toBe("pub-dec-audit");
    });

    it("11. An audit-logging failure does not fail the decision or propagate to the caller", async () => {
      auditServiceMock.record.mockRejectedValue(new Error("audit sink unavailable"));

      const result = await orchestrationService.generateDecision("public-lot-1", "user-1");

      expect(result.status).toBe("COMPLETED");
      expect(result.result).toBe("STORE");
      expect(decisionRepositoryMock.failDecision).not.toHaveBeenCalled();
    });

    it("12. Does not audit-log when the decision fails before completion", async () => {
      engineServiceMock.evaluate.mockImplementation(() => {
        throw new Error("boom");
      });

      await expect(orchestrationService.generateDecision("public-lot-1", "user-1")).rejects.toThrow("boom");

      expect(auditServiceMock.record).not.toHaveBeenCalled();
    });

    it("13. Does not audit-log routine historical reads", async () => {
      decisionRepositoryMock.listByLotId.mockResolvedValue([]);
      await orchestrationService.getDecisionsForLot("public-lot-1");

      decisionRepositoryMock.findByPublicId.mockResolvedValue({
        id: "dec-x",
        publicId: "pub-x",
        status: "COMPLETED",
        result: "STORE",
      });
      await orchestrationService.getDecisionByPublicId("pub-x");

      expect(auditServiceMock.record).not.toHaveBeenCalled();
    });
  });
});
