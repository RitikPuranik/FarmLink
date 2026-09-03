import { PrismaClient } from "@prisma/client";
import { PriceHistoryRepository } from "../../src/modules/price-forecasting/price-history.repository";

describe("PriceHistoryRepository (Module 7 Part 2)", () => {
  let prismaMock: any;
  let repository: PriceHistoryRepository;

  beforeEach(() => {
    prismaMock = {
      mandiPrice: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    repository = new PriceHistoryRepository(prismaMock as unknown as PrismaClient);
  });

  const window = { start: new Date("2026-07-01"), end: new Date("2026-09-01") };

  it("mandiHistory queries by crop + mandi, bounded by the date window, selecting only the needed columns", async () => {
    await repository.mandiHistory("crop-1", "mandi-1", window);

    expect(prismaMock.mandiPrice.findMany).toHaveBeenCalledWith({
      where: { cropId: "crop-1", mandiId: "mandi-1", observedDate: { gte: window.start, lte: window.end } },
      select: { mandiId: true, observedDate: true, modalPrice: true },
    });
  });

  it("regionalHistory queries by crop + state via a single joined query, without a district filter when none is given", async () => {
    await repository.regionalHistory("crop-1", "Maharashtra", undefined, window);

    expect(prismaMock.mandiPrice.findMany).toHaveBeenCalledWith({
      where: {
        cropId: "crop-1",
        observedDate: { gte: window.start, lte: window.end },
        mandi: { state: "Maharashtra" },
      },
      select: { mandiId: true, observedDate: true, modalPrice: true },
    });
  });

  it("regionalHistory narrows to a district when one is provided", async () => {
    await repository.regionalHistory("crop-1", "Maharashtra", "Pune", window);

    expect(prismaMock.mandiPrice.findMany).toHaveBeenCalledWith({
      where: {
        cropId: "crop-1",
        observedDate: { gte: window.start, lte: window.end },
        mandi: { state: "Maharashtra", district: "Pune" },
      },
      select: { mandiId: true, observedDate: true, modalPrice: true },
    });
  });

  it("cropWideHistory queries by crop only, across every mandi, in one bounded query", async () => {
    await repository.cropWideHistory("crop-1", window);

    expect(prismaMock.mandiPrice.findMany).toHaveBeenCalledWith({
      where: { cropId: "crop-1", observedDate: { gte: window.start, lte: window.end } },
      select: { mandiId: true, observedDate: true, modalPrice: true },
    });
  });

  it("converts Decimal-like modalPrice values to numbers and passes through null", async () => {
    prismaMock.mandiPrice.findMany.mockResolvedValue([
      { mandiId: "m1", observedDate: new Date("2026-08-01"), modalPrice: { toString: () => "2500.50", valueOf: () => 2500.5 } },
      { mandiId: "m1", observedDate: new Date("2026-08-02"), modalPrice: null },
    ]);

    const result = await repository.mandiHistory("crop-1", "mandi-1", window);

    expect(result).toEqual([
      { mandiId: "m1", observedDate: new Date("2026-08-01"), modalPrice: 2500.5 },
      { mandiId: "m1", observedDate: new Date("2026-08-02"), modalPrice: null },
    ]);
  });

  it("countTotalObservations uses a COUNT query (no row data) scoped to MANDI", async () => {
    await repository.countTotalObservations("crop-1", { type: "MANDI", mandiId: "mandi-1" });
    expect(prismaMock.mandiPrice.count).toHaveBeenCalledWith({ where: { cropId: "crop-1", mandiId: "mandi-1" } });
  });

  it("countTotalObservations scopes to REGIONAL state (+ optional district)", async () => {
    await repository.countTotalObservations("crop-1", { type: "REGIONAL", state: "Maharashtra" });
    expect(prismaMock.mandiPrice.count).toHaveBeenCalledWith({
      where: { cropId: "crop-1", mandi: { state: "Maharashtra" } },
    });

    await repository.countTotalObservations("crop-1", { type: "REGIONAL", state: "Maharashtra", district: "Pune" });
    expect(prismaMock.mandiPrice.count).toHaveBeenCalledWith({
      where: { cropId: "crop-1", mandi: { state: "Maharashtra", district: "Pune" } },
    });
  });

  it("countTotalObservations scopes to crop only for CROP_WIDE", async () => {
    await repository.countTotalObservations("crop-1", { type: "CROP_WIDE" });
    expect(prismaMock.mandiPrice.count).toHaveBeenCalledWith({ where: { cropId: "crop-1" } });
  });
});
