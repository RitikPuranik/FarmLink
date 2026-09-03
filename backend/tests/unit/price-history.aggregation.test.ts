import {
  aggregateAcrossMandisByDate,
  assessDataQuality,
  collapseByMandiDay,
  computeGapAnalysis,
  diffDays,
  diffDaysInclusive,
  flagOutliers,
  flagOutliersIQR,
  flagOutliersMAD,
  isChronologicallySorted,
  isUsableModalPrice,
  partitionValidity,
  sortObservationsByDate,
  startOfDayUTC,
  toMandiObservations,
} from "../../src/modules/price-forecasting/price-history.aggregation";
import { ForecastScope } from "../../src/modules/price-forecasting/price-forecasting.types";
import { PreparedPriceObservation, RawPriceRow, ValidPriceRow } from "../../src/modules/price-forecasting/price-history.types";

const MANDI_SCOPE: ForecastScope = { type: "MANDI", mandiId: "mandi-1" };
const REGIONAL_SCOPE: ForecastScope = { type: "REGIONAL", state: "Maharashtra" };

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function observation(dateIso: string, price: number, overrides: Partial<PreparedPriceObservation> = {}): PreparedPriceObservation {
  return { date: day(dateIso), price, observationCount: 1, sourceScope: MANDI_SCOPE, isOutlier: false, ...overrides };
}

describe("price-history.aggregation — canonical price validity", () => {
  it("treats finite positive numbers as usable", () => {
    expect(isUsableModalPrice(2500)).toBe(true);
    expect(isUsableModalPrice(0.01)).toBe(true);
  });

  it("rejects zero, negative, NaN, null, and undefined", () => {
    expect(isUsableModalPrice(0)).toBe(false);
    expect(isUsableModalPrice(-5)).toBe(false);
    expect(isUsableModalPrice(NaN)).toBe(false);
    expect(isUsableModalPrice(null)).toBe(false);
    expect(isUsableModalPrice(undefined)).toBe(false);
  });

  it("partitionValidity separates missing, invalid/negative, and usable rows without fabricating a fallback", () => {
    const rows: RawPriceRow[] = [
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2500 },
      { mandiId: "m1", observedDate: day("2026-08-02"), modalPrice: null },
      { mandiId: "m1", observedDate: day("2026-08-03"), modalPrice: -10 },
      { mandiId: "m1", observedDate: day("2026-08-04"), modalPrice: 0 },
    ];
    const result = partitionValidity(rows);
    expect(result.valid).toEqual([{ mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2500 }]);
    expect(result.missingCount).toBe(1);
    expect(result.invalidNegativeCount).toBe(2);
  });
});

describe("price-history.aggregation — sorting", () => {
  it("isChronologicallySorted detects already-sorted raw rows", () => {
    const rows = [{ observedDate: day("2026-08-01") }, { observedDate: day("2026-08-02") }];
    expect(isChronologicallySorted(rows)).toBe(true);
  });

  it("isChronologicallySorted detects out-of-order raw rows", () => {
    const rows = [{ observedDate: day("2026-08-05") }, { observedDate: day("2026-08-01") }];
    expect(isChronologicallySorted(rows)).toBe(false);
  });

  it("sortObservationsByDate returns ascending order without mutating the input", () => {
    const input = [observation("2026-08-03", 100), observation("2026-08-01", 90), observation("2026-08-02", 95)];
    const sorted = sortObservationsByDate(input);
    expect(sorted.map((o) => o.price)).toEqual([90, 95, 100]);
    // input untouched (pure function)
    expect(input.map((o) => o.price)).toEqual([100, 90, 95]);
  });
});

describe("price-history.aggregation — daily aggregation (MANDI scope)", () => {
  it("collapses multiple same-day source records for one mandi into a median canonical price", () => {
    const rows: ValidPriceRow[] = [
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2000 },
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2200 },
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2400 },
    ];
    const { entries, duplicateGroupCount } = collapseByMandiDay(rows);
    expect(entries).toEqual([{ mandiId: "m1", date: day("2026-08-01"), price: 2200, sourceRecordCount: 3 }]);
    expect(duplicateGroupCount).toBe(1);
  });

  it("keeps distinct dates separate and reports zero duplicates when every date has one record", () => {
    const rows: ValidPriceRow[] = [
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2000 },
      { mandiId: "m1", observedDate: day("2026-08-02"), modalPrice: 2100 },
    ];
    const { entries, duplicateGroupCount } = collapseByMandiDay(rows);
    expect(entries).toHaveLength(2);
    expect(duplicateGroupCount).toBe(0);
  });

  it("toMandiObservations maps one-per-date entries 1:1, carrying sourceRecordCount as observationCount", () => {
    const { entries } = collapseByMandiDay([
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2000 },
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2100 },
    ]);
    const observations = toMandiObservations(entries, MANDI_SCOPE);
    expect(observations).toEqual([
      { date: day("2026-08-01"), price: 2050, observationCount: 2, sourceScope: MANDI_SCOPE, isOutlier: false },
    ]);
  });
});

describe("price-history.aggregation — daily aggregation (REGIONAL/CROP_WIDE scope)", () => {
  it("aggregates across mandis by date using the daily median, with observationCount = reporting-mandi count", () => {
    const { entries } = collapseByMandiDay([
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2000 },
      { mandiId: "m2", observedDate: day("2026-08-01"), modalPrice: 2200 },
      { mandiId: "m3", observedDate: day("2026-08-01"), modalPrice: 9000 }, // outlier-ish, but median resists it
    ]);
    const observations = aggregateAcrossMandisByDate(entries, REGIONAL_SCOPE);
    expect(observations).toHaveLength(1);
    expect(observations[0].price).toBe(2200); // median of [2000, 2200, 9000]
    expect(observations[0].observationCount).toBe(3);
  });

  it("does not let one mandi's multiple source records outweigh other mandis in the regional median", () => {
    const { entries } = collapseByMandiDay([
      // m1 reports the same day twice via two sources — should collapse to
      // ONE m1 entry before the cross-mandi median, not count twice.
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 1000 },
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 1000 },
      { mandiId: "m2", observedDate: day("2026-08-01"), modalPrice: 5000 },
    ]);
    const observations = aggregateAcrossMandisByDate(entries, REGIONAL_SCOPE);
    // Median of the two per-mandi canonical prices [1000, 5000] = 3000,
    // not median of the three raw rows [1000, 1000, 5000] = 1000.
    expect(observations[0].price).toBe(3000);
    expect(observations[0].observationCount).toBe(2);
  });

  it("keeps separate calendar dates as separate observations", () => {
    const { entries } = collapseByMandiDay([
      { mandiId: "m1", observedDate: day("2026-08-01"), modalPrice: 2000 },
      { mandiId: "m2", observedDate: day("2026-08-02"), modalPrice: 2100 },
    ]);
    const observations = aggregateAcrossMandisByDate(entries, REGIONAL_SCOPE);
    expect(observations.map((o) => o.date.toISOString().slice(0, 10)).sort()).toEqual(["2026-08-01", "2026-08-02"]);
  });
});

describe("price-history.aggregation — date helpers", () => {
  it("diffDays / diffDaysInclusive compute whole calendar-day spans in UTC", () => {
    expect(diffDays(day("2026-08-01"), day("2026-08-05"))).toBe(4);
    expect(diffDaysInclusive(day("2026-08-01"), day("2026-08-05"))).toBe(5);
    expect(diffDaysInclusive(day("2026-08-01"), day("2026-08-01"))).toBe(1);
  });

  it("startOfDayUTC normalizes any time-of-day to UTC midnight", () => {
    const withTime = new Date("2026-08-01T15:42:00.000Z");
    expect(startOfDayUTC(withTime).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("price-history.aggregation — gap analysis", () => {
  it("reports full coverage with no gaps when every day in the window is observed", () => {
    const observations = [observation("2026-08-01", 100), observation("2026-08-02", 101), observation("2026-08-03", 102)];
    const gaps = computeGapAnalysis(observations, day("2026-08-01"), day("2026-08-03"));
    expect(gaps).toEqual({
      firstObservationDate: day("2026-08-01"),
      lastObservationDate: day("2026-08-03"),
      totalCalendarDays: 3,
      observedDays: 3,
      missingDays: 0,
      coverageRatio: 1,
      largestGapDays: 0,
    });
  });

  it("computes coverageRatio and missingDays for a sparse series", () => {
    const observations = [observation("2026-08-01", 100), observation("2026-08-10", 110)];
    const gaps = computeGapAnalysis(observations, day("2026-08-01"), day("2026-08-10"));
    expect(gaps.totalCalendarDays).toBe(10);
    expect(gaps.observedDays).toBe(2);
    expect(gaps.missingDays).toBe(8);
    expect(gaps.coverageRatio).toBe(0.2);
  });

  it("finds the largest internal gap between observations", () => {
    // 08-01, then a 5-day gap (08-02..08-06 missing), then 08-07, 08-08.
    const observations = [observation("2026-08-01", 100), observation("2026-08-07", 105), observation("2026-08-08", 106)];
    const gaps = computeGapAnalysis(observations, day("2026-08-01"), day("2026-08-08"));
    expect(gaps.largestGapDays).toBe(5);
  });

  it("counts a leading gap (window starts before the first observation) as the largest gap when it's biggest", () => {
    const observations = [observation("2026-08-10", 100), observation("2026-08-11", 101)];
    const gaps = computeGapAnalysis(observations, day("2026-08-01"), day("2026-08-11"));
    // 9 missing days (08-01..08-09) before the first observation.
    expect(gaps.largestGapDays).toBe(9);
  });

  it("counts a trailing gap (history stops before windowEnd) as the largest gap when it's biggest", () => {
    const observations = [observation("2026-08-01", 100), observation("2026-08-02", 101)];
    const gaps = computeGapAnalysis(observations, day("2026-08-01"), day("2026-08-20"));
    // 18 missing days (08-03..08-20) after the last observation.
    expect(gaps.largestGapDays).toBe(18);
  });

  it("treats an entirely empty series as one large gap spanning the whole window", () => {
    const gaps = computeGapAnalysis([], day("2026-08-01"), day("2026-08-10"));
    expect(gaps).toEqual({
      firstObservationDate: null,
      lastObservationDate: null,
      totalCalendarDays: 10,
      observedDays: 0,
      missingDays: 10,
      coverageRatio: 0,
      largestGapDays: 10,
    });
  });

  it("is deterministic — the same input always produces the same output", () => {
    const observations = [observation("2026-08-01", 100), observation("2026-08-05", 104)];
    const first = computeGapAnalysis(observations, day("2026-08-01"), day("2026-08-05"));
    const second = computeGapAnalysis(observations, day("2026-08-01"), day("2026-08-05"));
    expect(first).toEqual(second);
  });
});

describe("price-history.aggregation — outlier flagging (metadata only)", () => {
  const normalSeries = [90, 92, 91, 93, 89, 94, 90].map((price, i) => observation(`2026-08-0${i + 1}`, price));

  it("does not flag anything below the minimum sample size, regardless of spread", () => {
    const tiny = [observation("2026-08-01", 10), observation("2026-08-02", 10000)];
    const flagged = flagOutliersIQR(tiny);
    expect(flagged.every((o) => o.isOutlier === false)).toBe(true);
  });

  it("IQR method flags a clear extreme value without altering its price", () => {
    const withOutlier = [...normalSeries, observation("2026-08-08", 5000)];
    const flagged = flagOutliersIQR(withOutlier);
    const outlier = flagged.find((o) => o.date.getTime() === day("2026-08-08").getTime())!;
    expect(outlier.isOutlier).toBe(true);
    expect(outlier.price).toBe(5000); // never modified
    expect(flagged.filter((o) => o.isOutlier)).toHaveLength(1);
  });

  it("MAD method flags a clear extreme value without altering its price", () => {
    const withOutlier = [...normalSeries, observation("2026-08-08", 5000)];
    const flagged = flagOutliersMAD(withOutlier);
    const outlier = flagged.find((o) => o.date.getTime() === day("2026-08-08").getTime())!;
    expect(outlier.isOutlier).toBe(true);
    expect(outlier.price).toBe(5000);
  });

  it("flagOutliers dispatches to the requested method", () => {
    const withOutlier = [...normalSeries, observation("2026-08-08", 5000)];
    expect(flagOutliers(withOutlier, "IQR").some((o) => o.isOutlier)).toBe(true);
    expect(flagOutliers(withOutlier, "MAD").some((o) => o.isOutlier)).toBe(true);
  });

  it("never removes an observation — array length is unchanged before and after flagging", () => {
    const withOutlier = [...normalSeries, observation("2026-08-08", 5000)];
    expect(flagOutliersIQR(withOutlier)).toHaveLength(withOutlier.length);
  });

  it("does not flag anything in a uniform series (zero MAD)", () => {
    const uniform = Array.from({ length: 6 }, (_, i) => observation(`2026-08-0${i + 1}`, 100));
    expect(flagOutliersMAD(uniform).every((o) => !o.isOutlier)).toBe(true);
  });
});

describe("price-history.aggregation — data quality assessment", () => {
  it("flags NO_OBSERVATIONS when there are no usable observations", () => {
    const gapMetadata = computeGapAnalysis([], day("2026-08-01"), day("2026-08-10"));
    const flags = assessDataQuality({
      rawRecordCount: 0,
      missingCount: 0,
      invalidNegativeCount: 0,
      duplicateGroupCount: 0,
      usableObservationCount: 0,
      sourceRecordsWereSorted: true,
      gapMetadata,
    });
    expect(flags).toContain("NO_OBSERVATIONS");
  });

  it("flags every applicable data quality concern at once, not just the first", () => {
    const gapMetadata = computeGapAnalysis(
      [observation("2026-08-01", 100)],
      day("2026-08-01"),
      day("2026-09-01"),
    );
    const flags = assessDataQuality({
      rawRecordCount: 5,
      missingCount: 1,
      invalidNegativeCount: 1,
      duplicateGroupCount: 2,
      usableObservationCount: 1,
      sourceRecordsWereSorted: false,
      gapMetadata,
    });
    expect(flags).toEqual(
      expect.arrayContaining([
        "DUPLICATE_SOURCE_RECORDS",
        "MISSING_PRICE_VALUES",
        "INVALID_NEGATIVE_PRICES",
        "UNSORTED_SOURCE_RECORDS",
        "SPARSE_HISTORY",
        "LARGE_GAPS",
        "INSUFFICIENT_OBSERVATIONS",
      ]),
    );
    expect(flags).not.toContain("NO_OBSERVATIONS");
  });

  it("reports a clean bill of health for a well-covered, sorted, deduplicated series", () => {
    const observations = Array.from({ length: 20 }, (_, i) => observation(`2026-08-${String(i + 1).padStart(2, "0")}`, 100 + i));
    const gapMetadata = computeGapAnalysis(observations, day("2026-08-01"), day("2026-08-20"));
    const flags = assessDataQuality({
      rawRecordCount: 20,
      missingCount: 0,
      invalidNegativeCount: 0,
      duplicateGroupCount: 0,
      usableObservationCount: 20,
      sourceRecordsWereSorted: true,
      gapMetadata,
    });
    expect(flags).toEqual([]);
  });
});
