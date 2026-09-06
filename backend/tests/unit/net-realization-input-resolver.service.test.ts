import { NetRealizationInputResolverService } from "../../src/modules/net-realization/net-realization-input-resolver.service";
import { NotFoundError, NetRealizationDomainError } from "../../src/common/errors";

describe("NetRealizationInputResolverService", () => {
  let lotsRepoMock: any;
  let prismaMock: any;
  let marketRepoMock: any;
  let storageIntelligenceMock: any;
  let resolver: NetRealizationInputResolverService;

  const mockLot = {
    id: "lot-internal-id",
    publicId: "lot-public-1",
    cropId: "crop-1",
    originState: "MH",
    originDistrict: "Pune",
    availableQuantityKg: 1000,
    crop: { name: "Tomato" },
  };

  beforeEach(() => {
    lotsRepoMock = {
      findByPublicId: jest.fn().mockResolvedValue(mockLot),
      findById: jest.fn().mockResolvedValue(mockLot),
    };
    prismaMock = {
      tradeOffer: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    marketRepoMock = {
      latestMarkets: jest.fn().mockResolvedValue([]),
    };
    storageIntelligenceMock = {
      resolveStorageContext: jest.fn().mockResolvedValue({ estimatedCost: null }),
    };
    resolver = new NetRealizationInputResolverService(
      lotsRepoMock,
      prismaMock,
      marketRepoMock,
      storageIntelligenceMock,
    );
  });

  const user = { id: "user-1", role: "FARMER" };

  it("throws NotFoundError when the lot does not exist", async () => {
    lotsRepoMock.findByPublicId.mockResolvedValue(null);
    await expect(resolver.resolve("missing-lot", {}, user)).rejects.toThrow(NotFoundError);
  });

  it("resolves price from the lot's ACCEPTED trade offer when no override is given", async () => {
    prismaMock.tradeOffer.findFirst.mockResolvedValue({
      id: "offer-1",
      publicId: "offer-public-1",
      lotId: "lot-internal-id",
      status: "ACCEPTED",
      offeredPrice: 2500,
      quantity: 10,
      quantityUnit: "QTL",
    });

    const result = await resolver.resolve("lot-public-1", {}, user);

    expect(result.input.sale.source).toEqual({
      type: "ACCEPTED_OFFER",
      referenceId: "offer-public-1",
      valueSource: "ACTUAL",
    });
    expect(result.input.sale.pricePerUnit).toBe(2500);
    expect(result.input.sale.quantity).toBe(10);
    expect(result.input.sale.priceUnit).toBe("QTL");
  });

  it("prefers an explicitly requested offerPublicId over the auto-detected accepted offer", async () => {
    prismaMock.tradeOffer.findUnique.mockResolvedValue({
      id: "offer-2",
      publicId: "offer-public-2",
      lotId: "lot-internal-id",
      status: "SENT",
      offeredPrice: 2200,
      quantity: 8,
      quantityUnit: "QTL",
    });

    const result = await resolver.resolve("lot-public-1", { offerPublicId: "offer-public-2" }, user);

    expect(result.input.sale.source.type).toBe("OFFER");
    expect(result.input.sale.source.referenceId).toBe("offer-public-2");
    expect(prismaMock.tradeOffer.findFirst).not.toHaveBeenCalled();
  });

  it("rejects an explicit offerPublicId that does not belong to the lot", async () => {
    prismaMock.tradeOffer.findUnique.mockResolvedValue({
      id: "offer-3",
      publicId: "offer-public-3",
      lotId: "some-other-lot",
      status: "SENT",
      offeredPrice: 2200,
      quantity: 8,
      quantityUnit: "QTL",
    });

    await expect(resolver.resolve("lot-public-1", { offerPublicId: "offer-public-3" }, user)).rejects.toThrow(
      NetRealizationDomainError,
    );
  });

  it("falls back to a USER_PROVIDED price when there is no offer at all", async () => {
    const result = await resolver.resolve(
      "lot-public-1",
      { salePricePerUnit: 20, salePriceUnit: "KG" },
      user,
    );

    expect(result.input.sale.source).toEqual({ type: "USER_PROVIDED", referenceId: null, valueSource: "USER_PROVIDED" });
    expect(result.input.sale.pricePerUnit).toBe(20);
  });

  it("falls back to a MARKET_REFERENCE price when no offer or user price is given", async () => {
    marketRepoMock.latestMarkets.mockResolvedValueOnce([
      { mandi: { id: "m1" }, latest: { modalPrice: 2000 } },
      { mandi: { id: "m2" }, latest: { modalPrice: 2200 } },
    ]);

    const result = await resolver.resolve("lot-public-1", {}, user);

    expect(result.input.sale.source.type).toBe("MARKET_REFERENCE");
    expect(result.input.sale.pricePerUnit).toBe(2100); // average of the two mandis
  });

  it("never fabricates a price: returns SALE_PRICE_UNAVAILABLE when nothing resolves", async () => {
    const result = await resolver.resolve("lot-public-1", {}, user);

    expect(result.input.sale.source.type).toBe("UNAVAILABLE");
    expect(result.input.sale.pricePerUnit).toBeNull();
    expect(result.input.sale.quantity).toBeNull();
  });

  it("rejects a negative explicit sale price", async () => {
    await expect(resolver.resolve("lot-public-1", { salePricePerUnit: -5 }, user)).rejects.toThrow(
      NetRealizationDomainError,
    );
  });

  it("rejects a zero or negative explicit sale quantity override", async () => {
    await expect(
      resolver.resolve("lot-public-1", { salePricePerUnit: 20, saleQuantity: 0 }, user),
    ).rejects.toThrow(NetRealizationDomainError);
  });

  it("labels a user-provided cost override as USER_PROVIDED and never as ACTUAL", async () => {
    const result = await resolver.resolve(
      "lot-public-1",
      { salePricePerUnit: 20, costs: [{ category: "COMMISSION", amount: 100 }] },
      user,
    );

    const commission = result.input.costs.resolved.find((c) => c.category === "COMMISSION");
    expect(commission?.source).toBe("USER_PROVIDED");
    expect(commission?.amount).toBe(100);
  });

  it("rejects a negative user-provided cost amount", async () => {
    await expect(
      resolver.resolve(
        "lot-public-1",
        { salePricePerUnit: 20, costs: [{ category: "TRANSPORT", amount: -10 }] },
        user,
      ),
    ).rejects.toThrow(NetRealizationDomainError);
  });

  it("resolves STORAGE cost as ESTIMATED from the existing StorageIntelligenceProvider", async () => {
    storageIntelligenceMock.resolveStorageContext.mockResolvedValue({ estimatedCost: 150 });

    const result = await resolver.resolve("lot-public-1", { salePricePerUnit: 20 }, user);

    const storage = result.input.costs.resolved.find((c) => c.category === "STORAGE");
    expect(storage).toEqual({ category: "STORAGE", amount: 150, source: "ESTIMATED" });
  });

  it("marks every named category with no real data as unavailable, never fabricated", async () => {
    const result = await resolver.resolve("lot-public-1", { salePricePerUnit: 20 }, user);

    const unavailableCategories = result.input.costs.unavailable.map((c) => c.category);
    expect(unavailableCategories).toEqual(
      expect.arrayContaining(["TRANSPORT", "LOADING", "UNLOADING", "PACKAGING", "COMMISSION", "MARKET_FEE", "TAX", "INSURANCE"]),
    );
    // Nothing here was invented — every one of these has an explicit reason.
    for (const item of result.input.costs.unavailable) {
      expect(item.reason).toContain("UNAVAILABLE");
    }
  });

  it("supports multiple OTHER cost entries distinguished by name", async () => {
    const result = await resolver.resolve(
      "lot-public-1",
      {
        salePricePerUnit: 20,
        costs: [
          { category: "OTHER", amount: 10, name: "Weighbridge" },
          { category: "OTHER", amount: 5, name: "Cleaning" },
        ],
      },
      user,
    );

    const others = result.input.costs.resolved.filter((c) => c.category === "OTHER");
    expect(others).toHaveLength(2);
    expect(others.map((o) => o.name)).toEqual(expect.arrayContaining(["Weighbridge", "Cleaning"]));
  });
});
