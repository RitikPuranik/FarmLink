import { PriceHistoryPreparationService } from "../../src/modules/price-forecasting/price-history-preparation.service";
import { PRICE_FORECAST_CONFIG } from "../../src/modules/price-forecasting/price-forecasting.config";
import { RawPriceRow } from "../../src/modules/price-forecasting/price-history.types";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function makeRepo(overrides: {
  mandiHistory?: RawPriceRow[];
  regionalHistory?: RawPriceRow[];
  cropWideHistory?: RawPriceRow[];
  totalObservations?: number;
} = {}) {
  return {
    mandiHistory: jest.fn().mockResolvedValue(overrides.mandiHistory ?? []),
    regionalHistory: jest.fn().mockResolvedValue(overrides.regionalHistory ?? []),
    cropWideHistory: jest.fn().mockResolvedValue(overrides.cropWideHistory ?? []),
    countTotalObservations: jest.fn().mockResolvedValue(overrides.totalObservations ?? 0),
  };
}

// A run of consecutive daily rows for one mandi, all above the sufficiency
// threshold, used as a "plenty of good data" baseline several tests start
// from and then perturb.
function denseRows(mandiId: string, startIso: string, count: number, price = 2000): RawPriceRow[] {
  const rows: RawPriceRow[] = [];
  const start = day(startIso);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    rows.push({ mandiId, observedDate: d, modalPrice: price + i });
  }
  return rows;
}

describe("PriceHistoryPreparationService — MANDI scope", () => {
  it("prepares a normalized, sorted, deterministic series for a single mandi", async () => {
    const rows = denseRows("mandi-1", "2026-06-01", 60);
    const repo = makeRepo({ mandiHistory: rows, totalObservations: 60 });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "mandi-1" },
      startDate: day("2026-06-01"),
      endDate: day("2026-07-30"),
    });

    expect(repo.mandiHistory).toHaveBeenCalledWith("crop-1", "mandi-1", { start: day("2026-06-01"), end: day("2026-07-30") });
    expect(result.canonicalPriceSource).toBe("MODAL_PRICE");
    expect(result.observations).toHaveLength(60);
    expect(result.observations.every((o) => o.sourceScope.type === "MANDI")).toBe(true);
    expect(result.sufficient).toBe(true);
    expect(result.insufficiencyReasons).toEqual([]);
  });

  it("is deterministic — preparing the same request twice yields identical output", async () => {
    const rows = denseRows("mandi-1", "2026-06-01", 40);
    const repo = makeRepo({ mandiHistory: rows, totalObservations: 40 });
    const service = new PriceHistoryPreparationService(repo as any);
    const request = { cropId: "crop-1", scope: { type: "MANDI" as const, mandiId: "mandi-1" }, startDate: day("2026-06-01"), endDate: day("2026-07-10") };

    const first = await service.prepare(request);
    const second = await service.prepare(request);
    expect(first).toEqual(second);
  });
});

describe("PriceHistoryPreparationService — REGIONAL scope", () => {
  it("aggregates across mandis in the state via the daily median and reports district as optional", async () => {
    const rows: RawPriceRow[] = [
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2000 },
      { mandiId: "m2", observedDate: day("2026-08-01"), modalPrice: 2400 },
      ...denseRows("m1", "2026-08-02", 30),
    ];
    const repo = makeRepo({ regionalHistory: rows, totalObservations: rows.length });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "REGIONAL", state: "Maharashtra" },
      startDate: day("2026-08-01"),
      endDate: day("2026-08-31"),
    });

    expect(repo.regionalHistory).toHaveBeenCalledWith("crop-1", "Maharashtra", undefined, {
      start: day("2026-08-01"),
      end: day("2026-08-31"),
    });
    const first = result.observations.find((o) => o.date.getTime() === day("2026-08-01").getTime());
    expect(first?.price).toBe(2200); // median of [2000, 2400]
    expect(first?.observationCount).toBe(2);
  });

  it("passes an explicit district through to the repository when provided", async () => {
    const repo = makeRepo({ regionalHistory: denseRows("m1", "2026-08-01", 30), totalObservations: 30 });
    const service = new PriceHistoryPreparationService(repo as any);

    await service.prepare({
      cropId: "crop-1",
      scope: { type: "REGIONAL", state: "Maharashtra", district: "Pune" },
      startDate: day("2026-08-01"),
      endDate: day("2026-08-30"),
    });

    expect(repo.regionalHistory).toHaveBeenCalledWith("crop-1", "Maharashtra", "Pune", expect.anything());
  });
});

describe("PriceHistoryPreparationService — CROP_WIDE scope", () => {
  it("aggregates across every mandi via the daily median", async () => {
    const rows: RawPriceRow[] = [
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 1800 },
      { mandiId: "m2", observedDate: day("2026-08-01"), modalPrice: 2000 },
      { mandiId: "m3", observedDate: day("2026-08-01"), modalPrice: 2200 },
      ...denseRows("m1", "2026-08-02", 30),
    ];
    const repo = makeRepo({ cropWideHistory: rows, totalObservations: rows.length });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "CROP_WIDE" },
      startDate: day("2026-08-01"),
      endDate: day("2026-08-31"),
    });

    expect(repo.cropWideHistory).toHaveBeenCalledWith("crop-1", { start: day("2026-08-01"), end: day("2026-08-31") });
    const first = result.observations.find((o) => o.date.getTime() === day("2026-08-01").getTime());
    expect(first?.price).toBe(2000); // median of [1800, 2000, 2200]
    expect(first?.observationCount).toBe(3);
  });
});

describe("PriceHistoryPreparationService — chronological sorting & duplicate dates", () => {
  it("returns observations chronologically sorted even when raw rows arrive out of order", async () => {
    const rows: RawPriceRow[] = [
      { mandiId: "m1", observedDate: day("2026-08-05"), modalPrice: 2100 },
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2000 },
      { mandiId: "m1", observedDate: day("2026-08-03"), modalPrice: 2050 },
    ];
    const repo = makeRepo({ mandiHistory: rows, totalObservations: 3 });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "m1" },
      startDate: day("2026-08-01"),
      endDate: day("2026-08-05"),
    });

    expect(result.observations.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      "2026-08-01",
      "2026-08-03",
      "2026-08-05",
    ]);
    expect(result.dataQuality.sourceRecordsWereSorted).toBe(false);
  });

  it("produces exactly one observation per calendar date even with duplicate raw rows", async () => {
    const rows: RawPriceRow[] = [
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2000 },
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2100 },
      { mandiId: "m1", observedDate: day("2026-08-02"), modalPrice: 2050 },
    ];
    const repo = makeRepo({ mandiHistory: rows, totalObservations: 3 });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "m1" },
      startDate: day("2026-08-01"),
      endDate: day("2026-08-02"),
    });

    const dates = result.observations.map((o) => o.date.toISOString().slice(0, 10));
    expect(new Set(dates).size).toBe(dates.length);
    expect(result.dataQuality.duplicateGroupCount).toBe(1);
    expect(result.dataQuality.flags).toContain("DUPLICATE_SOURCE_RECORDS");
  });
});

describe("PriceHistoryPreparationService — canonical price quality", () => {
  it("excludes a row with a missing modal price and reports it as a data quality flag", async () => {
    const rows: RawPriceRow[] = [
      ...denseRows("m1", "2026-08-01", 30),
      { mandiId: "m1", observedDate: day("2026-09-05"), modalPrice: null },
    ];
    const repo = makeRepo({ mandiHistory: rows, totalObservations: rows.length });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "m1" },
      startDate: day("2026-08-01"),
      endDate: day("2026-09-05"),
    });

    expect(result.observations.some((o) => o.date.toISOString().slice(0, 10) === "2026-09-05")).toBe(false);
    expect(result.dataQuality.missingPriceCount).toBe(1);
    expect(result.dataQuality.flags).toContain("MISSING_PRICE_VALUES");
  });

  it("excludes an invalid negative price and reports it as a data quality flag", async () => {
    const rows: RawPriceRow[] = [
      ...denseRows("m1", "2026-08-01", 30),
      { mandiId: "m1", observedDate: day("2026-09-05"), modalPrice: -50 },
    ];
    const repo = makeRepo({ mandiHistory: rows, totalObservations: rows.length });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "m1" },
      startDate: day("2026-08-01"),
      endDate: day("2026-09-05"),
    });

    expect(result.observations.some((o) => o.date.toISOString().slice(0, 10) === "2026-09-05")).toBe(false);
    expect(result.dataQuality.invalidNegativePriceCount).toBe(1);
    expect(result.dataQuality.flags).toContain("INVALID_NEGATIVE_PRICES");
  });
});

describe("PriceHistoryPreparationService — sufficiency and sparse/empty histories", () => {
  it("reports NO_HISTORICAL_DATA and an empty series for a crop with zero observations", async () => {
    const repo = makeRepo({ mandiHistory: [], totalObservations: 0 });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "m1" },
      startDate: day("2026-08-01"),
      endDate: day("2026-08-31"),
    });

    expect(result.observations).toEqual([]);
    expect(result.sufficient).toBe(false);
    expect(result.insufficiencyReasons).toContain("NO_HISTORICAL_DATA");
    expect(result.dataQuality.flags).toContain("NO_OBSERVATIONS");
  });

  it("reports INSUFFICIENT_TOTAL_OBSERVATIONS below the Part 1 minimum", async () => {
    const rows = denseRows("m1", "2026-08-01", 5);
    const repo = makeRepo({ mandiHistory: rows, totalObservations: 5 });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "m1" },
      startDate: day("2026-08-01"),
      endDate: day("2026-08-05"),
    });

    expect(result.sufficient).toBe(false);
    expect(result.insufficiencyReasons).toContain("INSUFFICIENT_TOTAL_OBSERVATIONS");
  });

  it("reports sparse history (large gaps, low coverage) for a thin-but-long series", async () => {
    // Only 3 real observations spread across a 90-day window, each far
    // apart — total count clears the Part 1 minimum but coverage is poor.
    const rows: RawPriceRow[] = [
      { mandiId: "m1", observedDate: day("2026-06-01"), modalPrice: 2000 },
      { mandiId: "m1", observedDate: day("2026-07-01"), modalPrice: 2050 },
      { mandiId: "m1", observedDate: day("2026-08-30"), modalPrice: 2100 },
    ];
    const repo = makeRepo({ mandiHistory: rows, totalObservations: PRICE_FORECAST_CONFIG.MIN_HISTORICAL_OBSERVATIONS + 10 });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "m1" },
      startDate: day("2026-06-01"),
      endDate: day("2026-08-30"),
    });

    expect(result.sufficient).toBe(false);
    expect(result.insufficiencyReasons).toEqual(
      expect.arrayContaining(["COVERAGE_BELOW_MINIMUM", "GAP_EXCEEDS_MAXIMUM"]),
    );
    expect(result.dataQuality.flags).toEqual(expect.arrayContaining(["SPARSE_HISTORY", "LARGE_GAPS"]));
    expect(result.metadata.largestGapDays).toBeGreaterThan(PRICE_FORECAST_CONFIG.MAX_ACCEPTABLE_GAP_DAYS);
  });

  it("reports NO_USABLE_OBSERVATIONS when raw rows exist but every one is invalid", async () => {
    const rows: RawPriceRow[] = [
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: -1 },
      { mandiId: "m1", observedDate: day("2026-08-02"), modalPrice: null },
    ];
    const repo = makeRepo({ mandiHistory: rows, totalObservations: 40 });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "m1" },
      startDate: day("2026-08-01"),
      endDate: day("2026-08-02"),
    });

    expect(result.observations).toEqual([]);
    expect(result.insufficiencyReasons).toContain("NO_USABLE_OBSERVATIONS");
  });

  it("computes coverageRatio precisely for a known sparse window", async () => {
    // 10 observed days out of a 20-day window -> coverageRatio 0.5, right
    // at the configured minimum, so this alone should not trip
    // COVERAGE_BELOW_MINIMUM (strictly-less-than check).
    const rows = denseRows("m1", "2026-08-01", 10); // 08-01..08-10
    const repo = makeRepo({ mandiHistory: rows, totalObservations: PRICE_FORECAST_CONFIG.MIN_HISTORICAL_OBSERVATIONS + 10 });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "m1" },
      startDate: day("2026-08-01"),
      endDate: day("2026-08-20"),
    });

    expect(result.metadata.totalCalendarDays).toBe(20);
    expect(result.metadata.observedDays).toBe(10);
    expect(result.metadata.coverageRatio).toBe(0.5);
    expect(result.insufficiencyReasons).not.toContain("COVERAGE_BELOW_MINIMUM");
  });
});

describe("PriceHistoryPreparationService — bounded date windows", () => {
  it("defaults to DEFAULT_HISTORY_WINDOW_DAYS ending today when no dates are given", async () => {
    const repo = makeRepo();
    const service = new PriceHistoryPreparationService(repo as any);

    await service.prepare({ cropId: "crop-1", scope: { type: "MANDI", mandiId: "m1" } });

    const [, , windowArg] = repo.mandiHistory.mock.calls[0];
    const spanDays = Math.round((windowArg.end.getTime() - windowArg.start.getTime()) / 86_400_000) + 1;
    expect(spanDays).toBe(PRICE_FORECAST_CONFIG.DEFAULT_HISTORY_WINDOW_DAYS);
  });

  it("clamps a caller-supplied window wider than MAX_HISTORY_WINDOW_DAYS instead of querying unbounded history", async () => {
    const repo = makeRepo();
    const service = new PriceHistoryPreparationService(repo as any);
    const end = day("2026-08-31");
    const farStart = new Date(end);
    farStart.setUTCFullYear(farStart.getUTCFullYear() - 10); // way more than MAX_HISTORY_WINDOW_DAYS

    await service.prepare({ cropId: "crop-1", scope: { type: "MANDI", mandiId: "m1" }, startDate: farStart, endDate: end });

    const [, , windowArg] = repo.mandiHistory.mock.calls[0];
    const spanDays = Math.round((windowArg.end.getTime() - windowArg.start.getTime()) / 86_400_000) + 1;
    expect(spanDays).toBe(PRICE_FORECAST_CONFIG.MAX_HISTORY_WINDOW_DAYS);
  });

  it("rejects an inverted window (startDate after endDate)", async () => {
    const repo = makeRepo();
    const service = new PriceHistoryPreparationService(repo as any);

    await expect(
      service.prepare({
        cropId: "crop-1",
        scope: { type: "MANDI", mandiId: "m1" },
        startDate: day("2026-08-10"),
        endDate: day("2026-08-01"),
      }),
    ).rejects.toThrow(/startDate must not be after endDate/);
  });

  it("uses a window within the maximum as-is, unmodified", async () => {
    const repo = makeRepo();
    const service = new PriceHistoryPreparationService(repo as any);

    await service.prepare({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "m1" },
      startDate: day("2026-08-01"),
      endDate: day("2026-08-10"),
    });

    expect(repo.mandiHistory).toHaveBeenCalledWith("crop-1", "m1", { start: day("2026-08-01"), end: day("2026-08-10") });
  });
});

describe("PriceHistoryPreparationService — outlier flagging integration", () => {
  it("flags a statistical outlier as metadata without excluding it from the series", async () => {
    const rows = denseRows("m1", "2026-08-01", 10, 2000); // 2000..2009
    rows.push({ mandiId: "m1", observedDate: day("2026-08-11"), modalPrice: 50000 });
    const repo = makeRepo({ mandiHistory: rows, totalObservations: rows.length });
    const service = new PriceHistoryPreparationService(repo as any);

    const result = await service.prepare({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "m1" },
      startDate: day("2026-08-01"),
      endDate: day("2026-08-11"),
    });

    expect(result.observations).toHaveLength(11);
    const flaggedOne = result.observations.find((o) => o.date.toISOString().slice(0, 10) === "2026-08-11");
    expect(flaggedOne?.isOutlier).toBe(true);
    expect(flaggedOne?.price).toBe(50000);
    expect(result.metadata.outlierCount).toBe(1);
  });
});
