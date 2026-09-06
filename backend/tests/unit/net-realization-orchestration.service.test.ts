import { NetRealizationOrchestrationService } from "../../src/modules/net-realization/net-realization-orchestration.service";
import { NotFoundError } from "../../src/common/errors";
import { NetRealizationInput } from "../../src/modules/net-realization/net-realization.types";
import { CalculationEngineResult } from "../../src/modules/net-realization/net-realization-calculator.types";

describe("NetRealizationOrchestrationService", () => {
  let lotsRepositoryMock: any;
  let repositoryMock: any;
  let resolverMock: any;
  let engineMock: any;
  let auditServiceMock: any;
  let orchestrator: NetRealizationOrchestrationService;

  const lotFixture = { id: "lot-1", publicId: "lot-public-1", cropId: "crop-1" };
  const user = { id: "user-1", role: "FARMER" };

  const resolvedInputFixture: { lotId: string; cropId: string; input: NetRealizationInput } = {
    lotId: "lot-1",
    cropId: "crop-1",
    input: {
      lot: { lotId: "lot-1", lotPublicId: "lot-public-1", cropId: "crop-1", cropName: "Tomato", availableQuantityKg: 1000 },
      sale: {
        pricePerUnit: 2000,
        priceUnit: "QTL",
        quantity: 10,
        quantityUnit: "QTL",
        source: { type: "ACCEPTED_OFFER", referenceId: "offer-1", valueSource: "ACTUAL" },
      },
      costs: { resolved: [], unavailable: [] },
    },
  };

  const completeEngineResult: CalculationEngineResult = {
    grossRevenue: 20000,
    totalKnownCosts: 0,
    totalEstimatedCosts: 0,
    totalUserProvidedCosts: 0,
    totalDeductions: 0,
    netRealization: 20000,
    completeness: "COMPLETE",
    dataCompletenessScore: 1,
    includedComponents: [],
    omittedComponents: [],
    warnings: [],
    explanation: { includedFactors: [], omittedFactors: [], assumptions: [], warnings: [], disclaimer: "disclaimer text" },
  };

  const insufficientEngineResult: CalculationEngineResult = {
    grossRevenue: null,
    totalKnownCosts: null,
    totalEstimatedCosts: null,
    totalUserProvidedCosts: null,
    totalDeductions: null,
    netRealization: null,
    completeness: "INSUFFICIENT",
    dataCompletenessScore: null,
    includedComponents: [],
    omittedComponents: [],
    warnings: ["SALE_PRICE_UNAVAILABLE"],
    explanation: { includedFactors: [], omittedFactors: [], assumptions: [], warnings: [], disclaimer: "disclaimer text" },
  };

  beforeEach(() => {
    lotsRepositoryMock = { findByPublicId: jest.fn().mockResolvedValue(lotFixture), findById: jest.fn() };
    repositoryMock = {
      createPendingCalculation: jest.fn().mockResolvedValue({ id: "calc-1", publicId: "calc-public-1", status: "PENDING" }),
      completeCalculation: jest.fn(),
      markInsufficient: jest.fn(),
      failCalculation: jest.fn().mockResolvedValue({ id: "calc-1", publicId: "calc-public-1", status: "FAILED" }),
      findByPublicId: jest.fn(),
      listByLotIdPaginated: jest.fn(),
    };
    resolverMock = { resolve: jest.fn().mockResolvedValue(resolvedInputFixture) };
    engineMock = { evaluate: jest.fn() };
    auditServiceMock = { record: jest.fn().mockResolvedValue(undefined) };

    orchestrator = new NetRealizationOrchestrationService(
      lotsRepositoryMock,
      repositoryMock,
      resolverMock,
      engineMock,
      auditServiceMock,
    );
  });

  it("orchestrates a complete successful calculation", async () => {
    engineMock.evaluate.mockReturnValue(completeEngineResult);
    repositoryMock.completeCalculation.mockResolvedValue({
      id: "calc-1",
      publicId: "calc-public-1",
      lotId: "lot-1",
      status: "COMPLETED",
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
      inputSnapshot: resolvedInputFixture.input,
      calculationMetadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await orchestrator.calculate("lot-public-1", {}, user);

    expect(repositoryMock.createPendingCalculation).toHaveBeenCalledWith("lot-1", "crop-1", "user-1");
    expect(repositoryMock.completeCalculation).toHaveBeenCalled();
    expect(repositoryMock.markInsufficient).not.toHaveBeenCalled();
    expect(result.status).toBe("COMPLETED");
    expect(result.result.netRealization).toBe(20000);
  });

  it("treats INSUFFICIENT_DATA as a successful completion, not a failure", async () => {
    engineMock.evaluate.mockReturnValue(insufficientEngineResult);
    repositoryMock.markInsufficient.mockResolvedValue({
      id: "calc-1",
      publicId: "calc-public-1",
      lotId: "lot-1",
      status: "INSUFFICIENT_DATA",
      currency: "INR",
      priceSourceOfferId: null,
      priceSourceType: "UNAVAILABLE",
      salePricePerUnit: null,
      saleQuantityKg: null,
      grossRevenue: null,
      totalKnownCosts: null,
      totalEstimatedCosts: null,
      totalUserProvidedCosts: null,
      totalDeductions: null,
      netRealization: null,
      completeness: "INSUFFICIENT",
      dataCompletenessScore: null,
      inputSnapshot: null,
      calculationMetadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await orchestrator.calculate("lot-public-1", {}, user);

    expect(repositoryMock.markInsufficient).toHaveBeenCalled();
    expect(repositoryMock.completeCalculation).not.toHaveBeenCalled();
    expect(repositoryMock.failCalculation).not.toHaveBeenCalled();
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.result.netRealization).toBeNull();
  });

  it("marks the calculation FAILED and rethrows if an unexpected error occurs after PENDING", async () => {
    resolverMock.resolve.mockRejectedValue(new Error("boom"));

    await expect(orchestrator.calculate("lot-public-1", {}, user)).rejects.toThrow("boom");
    expect(repositoryMock.failCalculation).toHaveBeenCalledWith("calc-1");
  });

  it("throws NotFound for a missing lot without touching the resolver/engine/repository", async () => {
    lotsRepositoryMock.findByPublicId.mockResolvedValue(null);

    await expect(orchestrator.calculate("missing-lot", {}, user)).rejects.toThrow(NotFoundError);
    expect(repositoryMock.createPendingCalculation).not.toHaveBeenCalled();
    expect(resolverMock.resolve).not.toHaveBeenCalled();
  });

  it("retrieves a historical calculation without recomputation (no resolver/engine calls)", async () => {
    repositoryMock.findByPublicId.mockResolvedValue({
      id: "calc-1",
      publicId: "calc-public-1",
      lotId: "lot-1",
      status: "COMPLETED",
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
      inputSnapshot: resolvedInputFixture.input,
      calculationMetadata: { calculationVersion: "v1", includedComponents: [], omittedComponents: [], explanation: completeEngineResult.explanation },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await orchestrator.getByPublicId("calc-public-1");

    expect(result.status).toBe("COMPLETED");
    expect(resolverMock.resolve).not.toHaveBeenCalled();
    expect(engineMock.evaluate).not.toHaveBeenCalled();
  });

  it("throws NotFound when retrieving a nonexistent calculation", async () => {
    repositoryMock.findByPublicId.mockResolvedValue(null);
    await expect(orchestrator.getByPublicId("missing")).rejects.toThrow(NotFoundError);
  });

  it("records an audit entry for a completed calculation", async () => {
    engineMock.evaluate.mockReturnValue(completeEngineResult);
    repositoryMock.completeCalculation.mockResolvedValue({
      id: "calc-1",
      publicId: "calc-public-1",
      lotId: "lot-1",
      status: "COMPLETED",
      currency: "INR",
      inputSnapshot: resolvedInputFixture.input,
      calculationMetadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await orchestrator.calculate("lot-public-1", {}, user);

    expect(auditServiceMock.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "NET_REALIZATION_CALCULATION_CREATED" }),
    );
    expect(auditServiceMock.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "NET_REALIZATION_CALCULATION_COMPLETED" }),
    );
  });

  it("an audit-logging failure does not fail the calculation or propagate to the caller", async () => {
    auditServiceMock.record.mockRejectedValue(new Error("audit down"));
    engineMock.evaluate.mockReturnValue(completeEngineResult);
    repositoryMock.completeCalculation.mockResolvedValue({
      id: "calc-1",
      publicId: "calc-public-1",
      lotId: "lot-1",
      status: "COMPLETED",
      currency: "INR",
      inputSnapshot: resolvedInputFixture.input,
      calculationMetadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(orchestrator.calculate("lot-public-1", {}, user)).resolves.toBeDefined();
  });

  it("paginates the lot history and never recomputes", async () => {
    repositoryMock.listByLotIdPaginated.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    const result = await orchestrator.listForLot("lot-public-1", 1, 20);

    expect(result.total).toBe(0);
    expect(resolverMock.resolve).not.toHaveBeenCalled();
  });
});
