import { PrismaClient } from "@prisma/client";
import { NetRealizationRepository } from "../../src/modules/net-realization/net-realization.repository";

describe("NetRealizationRepository (Module 14)", () => {
  let prismaMock: any;
  let repository: NetRealizationRepository;

  beforeEach(() => {
    prismaMock = {
      netRealizationCalculation: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    repository = new NetRealizationRepository(prismaMock as unknown as PrismaClient);
  });

  it("creates a PENDING calculation", async () => {
    prismaMock.netRealizationCalculation.create.mockResolvedValue({ id: "calc-1", status: "PENDING" });

    await repository.createPendingCalculation("lot-1", "crop-1", "user-1");

    expect(prismaMock.netRealizationCalculation.create).toHaveBeenCalledWith({
      data: { lotId: "lot-1", cropId: "crop-1", requestedByUserId: "user-1", status: "PENDING" },
    });
  });

  it("completes a calculation with the full immutable snapshot and metadata", async () => {
    prismaMock.netRealizationCalculation.update.mockResolvedValue({ id: "calc-1", status: "COMPLETED" });

    const snapshot = {
      lot: { lotId: "lot-1", lotPublicId: "lp-1", cropId: "crop-1", cropName: "Tomato", availableQuantityKg: 100 },
      sale: {
        pricePerUnit: 2000,
        priceUnit: "QTL" as const,
        quantity: 10,
        quantityUnit: "QTL" as const,
        source: { type: "ACCEPTED_OFFER" as const, referenceId: "offer-1", valueSource: "ACTUAL" as const },
      },
      costs: { resolved: [], unavailable: [] },
    };

    await repository.completeCalculation("calc-1", {
      currency: "INR",
      priceSourceOfferId: "offer-1",
      priceSourceType: "ACCEPTED_OFFER",
      salePricePerUnit: 2000,
      saleQuantityKg: 1000,
      grossRevenue: 20000,
      totalKnownCosts: 0,
      totalEstimatedCosts: 0,
      totalUserProvidedCosts: 0,
      totalDeductions: 0,
      netRealization: 20000,
      completeness: "COMPLETE",
      dataCompletenessScore: 1,
      inputSnapshot: snapshot,
      calculationMetadata: { calculationVersion: "v1" },
    });

    expect(prismaMock.netRealizationCalculation.update).toHaveBeenCalledWith({
      where: { id: "calc-1" },
      data: expect.objectContaining({
        status: "COMPLETED",
        netRealization: 20000,
        completeness: "COMPLETE",
        inputSnapshot: snapshot,
      }),
    });
  });

  it("marks a calculation INSUFFICIENT_DATA without fabricating totals", async () => {
    prismaMock.netRealizationCalculation.update.mockResolvedValue({ id: "calc-1", status: "INSUFFICIENT_DATA" });

    const snapshot = {
      lot: { lotId: "lot-1", lotPublicId: "lp-1", cropId: "crop-1", cropName: "Tomato", availableQuantityKg: 100 },
      sale: {
        pricePerUnit: null,
        priceUnit: null,
        quantity: null,
        quantityUnit: null,
        source: { type: "UNAVAILABLE" as const, referenceId: null, valueSource: "UNKNOWN" as const },
      },
      costs: { resolved: [], unavailable: [] },
    };

    await repository.markInsufficient("calc-1", "UNAVAILABLE", snapshot, { calculationVersion: "v1" });

    expect(prismaMock.netRealizationCalculation.update).toHaveBeenCalledWith({
      where: { id: "calc-1" },
      data: {
        status: "INSUFFICIENT_DATA",
        priceSourceType: "UNAVAILABLE",
        inputSnapshot: snapshot,
        calculationMetadata: { calculationVersion: "v1" },
      },
    });
  });

  it("marks a calculation FAILED", async () => {
    prismaMock.netRealizationCalculation.update.mockResolvedValue({ id: "calc-1", status: "FAILED" });

    await repository.failCalculation("calc-1");

    expect(prismaMock.netRealizationCalculation.update).toHaveBeenCalledWith({
      where: { id: "calc-1" },
      data: { status: "FAILED" },
    });
  });

  it("finds a calculation by its public ID", async () => {
    prismaMock.netRealizationCalculation.findUnique.mockResolvedValue({ id: "calc-1" });

    await repository.findByPublicId("calc-public-1");

    expect(prismaMock.netRealizationCalculation.findUnique).toHaveBeenCalledWith({
      where: { publicId: "calc-public-1" },
    });
  });

  it("lists by lot ID scoped to COMPLETED/INSUFFICIENT_DATA, newest first, with a bounded take", async () => {
    prismaMock.netRealizationCalculation.findMany.mockResolvedValue([]);

    await repository.listByLotId("lot-1");

    expect(prismaMock.netRealizationCalculation.findMany).toHaveBeenCalledWith({
      where: { lotId: "lot-1", status: { in: ["COMPLETED", "INSUFFICIENT_DATA"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  });

  it("paginates history and clamps page size to the configured maximum", async () => {
    prismaMock.netRealizationCalculation.findMany.mockResolvedValue([]);
    prismaMock.netRealizationCalculation.count.mockResolvedValue(0);

    const result = await repository.listByLotIdPaginated("lot-1", 1, 500);

    expect(result.pageSize).toBe(100);
    expect(prismaMock.netRealizationCalculation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, skip: 0 }),
    );
  });

  it("clamps a nonsensical page number to at least 1", async () => {
    prismaMock.netRealizationCalculation.findMany.mockResolvedValue([]);
    prismaMock.netRealizationCalculation.count.mockResolvedValue(0);

    const result = await repository.listByLotIdPaginated("lot-1", -5, 20);

    expect(result.page).toBe(1);
  });
});
