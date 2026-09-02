import { PrismaClient } from "@prisma/client";
import { SellStoreDecisionRepository } from "../../src/modules/sell-vs-store/sell-vs-store.repository";
import { SellStoreInputSnapshot } from "../../src/modules/sell-vs-store/sell-vs-store.types";

describe("SellStoreDecisionRepository (Module 8)", () => {
  let prismaMock: any;
  let repository: SellStoreDecisionRepository;

  beforeEach(() => {
    prismaMock = {
      sellStoreDecision: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    repository = new SellStoreDecisionRepository(prismaMock as unknown as PrismaClient);
  });

  it("should create a decision record with an immutable input snapshot", async () => {
    const snapshot: SellStoreInputSnapshot = {
      market: {
        modalPrice: 2000,
        trend: "UP",
        volatility: 0.05,
        freshness: "1h",
        confidence: 0.9,
        sourceTimestamp: new Date().toISOString(),
      },
      lot: {
        quantity: 100,
        unit: "QTL",
        cropName: "Wheat",
        qualityGrade: "A",
      },
      storage: {
        availability: true,
        costPerUnit: 10,
        durationDays: 30,
        constraints: ["DRY_ONLY"],
        spoilageRisk: 0.01,
      },
    };

    const mockResponse = {
      id: "decision-123",
      lotId: "lot-1",
      cropId: "crop-1",
      requestedByUserId: "user-1",
      status: "PENDING",
      inputSnapshot: snapshot,
    };

    prismaMock.sellStoreDecision.create.mockResolvedValue(mockResponse);

    const result = await repository.createDecision(
      "lot-1",
      "crop-1",
      "user-1",
      snapshot,
      new Date(),
      new Date()
    );

    expect(prismaMock.sellStoreDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lotId: "lot-1",
        cropId: "crop-1",
        requestedByUserId: "user-1",
        status: "PENDING",
        inputSnapshot: snapshot,
      }),
    });
    
    expect(result.id).toBe("decision-123");
    expect(result.inputSnapshot).toEqual(snapshot);
  });
});
