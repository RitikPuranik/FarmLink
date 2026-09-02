import { DecisionInputResolverService } from "../../src/modules/sell-vs-store/sell-store-input-resolver.service";
import { NotFoundError } from "../../src/common/errors";

describe("DecisionInputResolverService", () => {
  let lotsRepoMock: any;
  let qualityRepoMock: any;
  let marketRepoMock: any;
  let resolver: DecisionInputResolverService;

  beforeEach(() => {
    lotsRepoMock = {
      findByPublicId: jest.fn(),
    };
    qualityRepoMock = {
      findCurrentByLotId: jest.fn(),
    };
    marketRepoMock = {
      latestMarkets: jest.fn(),
      historyForMandis: jest.fn(),
    };

    resolver = new DecisionInputResolverService(
      lotsRepoMock,
      qualityRepoMock,
      marketRepoMock
    );
  });

  const mockLot = {
    id: "lot-internal-id",
    publicId: "lot-123",
    cropId: "crop-1",
    originState: "MH",
    originDistrict: "Pune",
    availableQuantityKg: 1500,
    crop: { name: "Tomato" }
  };

  it("1. Complete available data (simulated)", async () => {
    lotsRepoMock.findByPublicId.mockResolvedValue(mockLot);
    
    qualityRepoMock.findCurrentByLotId.mockResolvedValue({
      overallGrade: "A"
    });

    const marketDate = new Date();
    marketRepoMock.latestMarkets.mockResolvedValue([
      { mandi: { id: "mandi-1" }, latest: { modalPrice: 2000, date: marketDate } }
    ]);
    
    marketRepoMock.historyForMandis.mockResolvedValue(new Map([
      ["mandi-1", [
        { modalPrice: 1900, date: new Date(Date.now() - 10 * 86400000) },
        { modalPrice: 2000, date: marketDate }
      ]]
    ]));

    const result = await resolver.resolveDecisionInputs("lot-123");

    expect(result.missingInputs).toEqual(["STORAGE_DATA"]);
    expect(result.availability.quality).toBe(true);
    expect(result.availability.market).toBe(true);
    
    expect(result.snapshot.lot.qualityGrade).toBe("A");
    expect(result.snapshot.market.modalPrice).toBe(2000);
    expect(result.snapshot.storage.availability).toBeNull();
  });

  it("2. Missing quality data", async () => {
    lotsRepoMock.findByPublicId.mockResolvedValue(mockLot);
    
    qualityRepoMock.findCurrentByLotId.mockResolvedValue(null); // No quality data

    const marketDate = new Date();
    marketRepoMock.latestMarkets.mockResolvedValue([
      { mandi: { id: "mandi-1" }, latest: { modalPrice: 2000, date: marketDate } }
    ]);
    marketRepoMock.historyForMandis.mockResolvedValue(new Map());

    const result = await resolver.resolveDecisionInputs("lot-123");

    expect(result.missingInputs).toContain("QUALITY_GRADE");
    expect(result.snapshot.lot.qualityGrade).toBeNull();
    expect(result.availability.quality).toBe(false);
  });

  it("3. Missing market data", async () => {
    lotsRepoMock.findByPublicId.mockResolvedValue(mockLot);
    qualityRepoMock.findCurrentByLotId.mockResolvedValue({ overallGrade: "B" });
    
    // Simulating no market data for district, state, or national
    marketRepoMock.latestMarkets.mockResolvedValue([]);

    const result = await resolver.resolveDecisionInputs("lot-123");

    expect(result.missingInputs).toContain("MARKET_DATA");
    expect(result.availability.market).toBe(false);
    expect(result.snapshot.market.modalPrice).toBeNull();
    expect(result.snapshot.market.trend).toBeNull();
    expect(result.snapshot.market.volatility).toBeNull();
    expect(result.snapshot.market.freshness).toBeNull();
    expect(result.snapshot.market.confidence).toBeNull();
  });

  it("4. No storage infrastructure available (baseline behavior)", async () => {
    lotsRepoMock.findByPublicId.mockResolvedValue(mockLot);
    qualityRepoMock.findCurrentByLotId.mockResolvedValue(null);
    marketRepoMock.latestMarkets.mockResolvedValue([]);

    const result = await resolver.resolveDecisionInputs("lot-123");

    expect(result.missingInputs).toContain("STORAGE_DATA");
    expect(result.availability.storage).toBe("UNKNOWN");
    expect(result.snapshot.storage.availability).toBeNull();
  });

  it("5. Lot not found", async () => {
    lotsRepoMock.findByPublicId.mockResolvedValue(null);

    await expect(resolver.resolveDecisionInputs("lot-invalid")).rejects.toThrow(NotFoundError);
  });

  it("6. Verify explicit nulls vs zero", async () => {
    lotsRepoMock.findByPublicId.mockResolvedValue(mockLot);
    qualityRepoMock.findCurrentByLotId.mockResolvedValue(null);
    marketRepoMock.latestMarkets.mockResolvedValue([]);

    const result = await resolver.resolveDecisionInputs("lot-123");
    
    // Ensure market fields are strictly null, not zero
    expect(result.snapshot.market.modalPrice).toBeNull();
    expect(result.snapshot.market.modalPrice).not.toBe(0);
    
    expect(result.snapshot.storage.spoilageRisk).toBeNull();
    expect(result.snapshot.storage.spoilageRisk).not.toBe(0);
  });
});
