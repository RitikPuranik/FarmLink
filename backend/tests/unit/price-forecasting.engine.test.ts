import { BaselineForecastEngine } from "../../src/modules/price-forecasting/price-forecasting.engine";
import { BASELINE_MODEL_VERSION } from "../../src/modules/price-forecasting/price-forecasting.engine.types";
import { PRICE_FORECAST_CONFIG } from "../../src/modules/price-forecasting/price-forecasting.config";
import { ForecastScope } from "../../src/modules/price-forecasting/price-forecasting.types";
import { PreparedPriceHistory, PreparedPriceObservation } from "../../src/modules/price-forecasting/price-history.types";

const MANDI_SCOPE: ForecastScope = { type: "MANDI", mandiId: "mandi-1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function observation(dateIso: string, price: number, isOutlier = false): PreparedPriceObservation {
  return { date: day(dateIso), price, observationCount: 1, sourceScope: MANDI_SCOPE, isOutlier };
}

/** A sufficient, otherwise-realistic PreparedPriceHistory fixture — tests
 *  override `observations` (and, where needed, `metadata`/`sufficient`/
 *  `insufficiencyReasons`) rather than reconstructing the whole shape
 *  each time. */
function historyFixture(overrides: Partial<PreparedPriceHistory> = {}): PreparedPriceHistory {
  const observations = overrides.observations ?? denseObservations("2026-08-01", 20, 2000);
  return {
    cropId: "crop-1",
    scope: MANDI_SCOPE,
    canonicalPriceSource: "MODAL_PRICE",
    windowStartDate: day("2026-08-01"),
    windowEndDate: day("2026-08-20"),
    observations,
    metadata: {
      firstObservationDate: observations[0]?.date ?? null,
      lastObservationDate: observations[observations.length - 1]?.date ?? null,
      totalCalendarDays: 20,
      observedDays: observations.length,
      missingDays: 0,
      coverageRatio: 1,
      largestGapDays: 0,
      outlierCount: observations.filter((o) => o.isOutlier).length,
    },
    dataQuality: {
      flags: [],
      rawRecordCount: observations.length,
      missingPriceCount: 0,
      invalidNegativePriceCount: 0,
      duplicateGroupCount: 0,
      sourceRecordsWereSorted: true,
    },
    sufficient: true,
    insufficiencyReasons: [],
    ...overrides,
  };
}

function denseObservations(startIso: string, count: number, startPrice: number, dailyDelta = 0): PreparedPriceObservation[] {
  const start = day(startIso);
  const out: PreparedPriceObservation[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(observation(d.toISOString().slice(0, 10), startPrice + dailyDelta * i));
  }
  return out;
}

function noisyObservations(startIso: string, prices: number[]): PreparedPriceObservation[] {
  const start = day(startIso);
  return prices.map((price, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return observation(d.toISOString().slice(0, 10), price);
  });
}

describe("BaselineForecastEngine — sufficient history", () => {
  it("produces a GENERATED forecast for a healthy, sufficient history", () => {
    const engine = new BaselineForecastEngine();
    const result = engine.generate(historyFixture(), 7);

    expect(result.outcome).toBe("GENERATED");
    if (result.outcome !== "GENERATED") return;
    expect(result.output.predictedPrice).toBeGreaterThan(0);
    expect(result.output.lowerBound).not.toBeNull();
    expect(result.output.upperBound).not.toBeNull();
    expect(result.modelMetadata.algorithm).toBe(BASELINE_MODEL_VERSION);
  });

  it("is deterministic — identical input always produces identical output", () => {
    const engine = new BaselineForecastEngine();
    const history = historyFixture();
    const first = engine.generate(history, 7);
    const second = engine.generate(history, 7);
    expect(first).toEqual(second);
  });
});

describe("BaselineForecastEngine — trend direction", () => {
  it("projects upward for a rising price series", () => {
    const engine = new BaselineForecastEngine();
    const history = historyFixture({ observations: denseObservations("2026-08-01", 20, 2000, 15) });
    const result = engine.generate(history, 7);

    expect(result.outcome).toBe("GENERATED");
    if (result.outcome !== "GENERATED") return;
    expect(result.modelMetadata.trendDirection).toBe("UP");
    expect(result.output.predictedPrice).toBeGreaterThan(result.modelMetadata.baselinePrice);
  });

  it("projects downward for a falling price series", () => {
    const engine = new BaselineForecastEngine();
    const history = historyFixture({ observations: denseObservations("2026-08-01", 20, 3000, -15) });
    const result = engine.generate(history, 7);

    expect(result.outcome).toBe("GENERATED");
    if (result.outcome !== "GENERATED") return;
    expect(result.modelMetadata.trendDirection).toBe("DOWN");
    expect(result.output.predictedPrice).toBeLessThan(result.modelMetadata.baselinePrice);
  });

  it("reports FLAT and near-zero trend adjustment for a constant price series", () => {
    const engine = new BaselineForecastEngine();
    const history = historyFixture({ observations: denseObservations("2026-08-01", 20, 2000, 0) });
    const result = engine.generate(history, 7);

    expect(result.outcome).toBe("GENERATED");
    if (result.outcome !== "GENERATED") return;
    expect(result.modelMetadata.trendDirection).toBe("FLAT");
    expect(result.output.predictedPrice).toBeCloseTo(2000, 0);
  });
});

describe("BaselineForecastEngine — uncertainty vs. volatility", () => {
  it("produces a wider interval for a highly volatile series than a stable one", () => {
    const engine = new BaselineForecastEngine();

    const stable = historyFixture({ observations: denseObservations("2026-08-01", 20, 2000, 0) });
    const volatile = historyFixture({
      observations: noisyObservations(
        "2026-08-01",
        [1800, 2400, 1700, 2500, 1900, 2600, 1750, 2450, 1850, 2550, 1950, 2300, 1800, 2400, 1700, 2500, 1900, 2600, 1750, 2450],
      ),
    });

    const stableResult = engine.generate(stable, 7);
    const volatileResult = engine.generate(volatile, 7);
    expect(stableResult.outcome).toBe("GENERATED");
    expect(volatileResult.outcome).toBe("GENERATED");
    if (stableResult.outcome !== "GENERATED" || volatileResult.outcome !== "GENERATED") return;

    const stableWidth = stableResult.output.upperBound! - stableResult.output.lowerBound!;
    const volatileWidth = volatileResult.output.upperBound! - volatileResult.output.lowerBound!;
    expect(volatileWidth).toBeGreaterThan(stableWidth);
  });
});

describe("BaselineForecastEngine — insufficiency handling", () => {
  it("returns INSUFFICIENT_DATA when the prepared history itself is insufficient", () => {
    const engine = new BaselineForecastEngine();
    const history = historyFixture({
      observations: [],
      sufficient: false,
      insufficiencyReasons: ["NO_HISTORICAL_DATA"],
    });

    const result = engine.generate(history, 7);
    expect(result.outcome).toBe("INSUFFICIENT_DATA");
    if (result.outcome !== "INSUFFICIENT_DATA") return;
    expect(result.reasons).toContain("NO_HISTORICAL_DATA");
  });

  it("returns INSUFFICIENT_DATA for a sparse history flagged by Part 2", () => {
    const engine = new BaselineForecastEngine();
    const history = historyFixture({
      sufficient: false,
      insufficiencyReasons: ["SPARSE_DATA_IN_WINDOW", "COVERAGE_BELOW_MINIMUM"],
    });

    const result = engine.generate(history, 7);
    expect(result.outcome).toBe("INSUFFICIENT_DATA");
    if (result.outcome !== "INSUFFICIENT_DATA") return;
    expect(result.reasons).toEqual(expect.arrayContaining(["SPARSE_DATA_IN_WINDOW", "COVERAGE_BELOW_MINIMUM"]));
  });

  it("returns INSUFFICIENT_DATA when gaps exceed the configured maximum", () => {
    const engine = new BaselineForecastEngine();
    const history = historyFixture({
      sufficient: false,
      insufficiencyReasons: ["GAP_EXCEEDS_MAXIMUM"],
    });

    const result = engine.generate(history, 7);
    expect(result.outcome).toBe("INSUFFICIENT_DATA");
    if (result.outcome !== "INSUFFICIENT_DATA") return;
    expect(result.reasons).toContain("GAP_EXCEEDS_MAXIMUM");
  });

  it("returns INSUFFICIENT_DATA when the requested horizon exceeds the configured maximum", () => {
    const engine = new BaselineForecastEngine();
    const history = historyFixture({
      sufficient: false,
      insufficiencyReasons: ["HORIZON_EXCEEDS_LIMIT"],
    });

    const result = engine.generate(history, PRICE_FORECAST_CONFIG.MAX_HORIZON_DAYS + 10);
    expect(result.outcome).toBe("INSUFFICIENT_DATA");
    if (result.outcome !== "INSUFFICIENT_DATA") return;
    expect(result.reasons).toContain("HORIZON_EXCEEDS_LIMIT");
  });
});

describe("BaselineForecastEngine — outlier policy", () => {
  it("excludes flagged outliers from the calculation when enough non-outlier observations remain", () => {
    const engine = new BaselineForecastEngine();
    // 19 stable observations + 1 wild outlier — plenty of non-outlier
    // points remain (>= MIN_OBSERVATIONS_FOR_TREND), so the policy should
    // exclude the outlier rather than let it distort the baseline.
    const observations = denseObservations("2026-08-01", 19, 2000, 0);
    observations.push(observation("2026-08-20", 100000, true));
    const history = historyFixture({ observations, metadata: { ...historyFixture().metadata, outlierCount: 1 } });

    const result = engine.generate(history, 7);
    expect(result.outcome).toBe("GENERATED");
    if (result.outcome !== "GENERATED") return;
    expect(result.modelMetadata.outlierPolicy).toBe("EXCLUDED");
    // The baseline should stay close to 2000, not be dragged toward the
    // 100000 outlier.
    expect(result.modelMetadata.baselinePrice).toBeLessThan(3000);
  });

  it("falls back to including outliers when too few non-outlier observations remain", () => {
    const engine = new BaselineForecastEngine();
    // Only 2 usable points once outliers are stripped — below
    // MIN_OBSERVATIONS_FOR_TREND (5) — so the policy must fall back to
    // the full valid set rather than starve the model of data.
    const observations = [
      observation("2026-08-01", 2000, false),
      observation("2026-08-02", 2050, false),
      observation("2026-08-03", 9000, true),
      observation("2026-08-04", 9100, true),
      observation("2026-08-05", 9200, true),
      observation("2026-08-06", 9300, true),
    ];
    const history = historyFixture({ observations, metadata: { ...historyFixture().metadata, outlierCount: 4 } });

    const result = engine.generate(history, 7);
    expect(result.outcome).toBe("GENERATED");
    if (result.outcome !== "GENERATED") return;
    expect(result.modelMetadata.outlierPolicy).toBe("INCLUDED_FALLBACK");
    expect(result.modelMetadata.historicalObservationCount).toBe(observations.length);
  });

  it("never mutates the source observations regardless of policy branch", () => {
    const engine = new BaselineForecastEngine();
    const observations = denseObservations("2026-08-01", 19, 2000, 0);
    observations.push(observation("2026-08-20", 100000, true));
    const history = historyFixture({ observations });
    const snapshotBefore = JSON.parse(JSON.stringify(observations));

    engine.generate(history, 7);

    expect(JSON.parse(JSON.stringify(observations))).toEqual(snapshotBefore);
  });
});

describe("BaselineForecastEngine — metadata correctness", () => {
  it("reports explainability metadata consistent with the computed output", () => {
    const engine = new BaselineForecastEngine();
    const history = historyFixture();
    const result = engine.generate(history, 7);

    expect(result.outcome).toBe("GENERATED");
    if (result.outcome !== "GENERATED") return;

    const meta = result.modelMetadata;
    expect(meta.algorithm).toBe(BASELINE_MODEL_VERSION);
    expect(meta.historicalObservationCount).toBeGreaterThan(0);
    expect(meta.historyStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.historyEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.uncertaintyMethod).toBe("HISTORICAL_STD_DEV_SQRT_HORIZON");
    expect(meta.coverageRatio).toBe(history.metadata.coverageRatio);
    expect(["UP", "DOWN", "FLAT"]).toContain(meta.trendDirection);
    expect(["EXCLUDED", "INCLUDED_FALLBACK"]).toContain(meta.outlierPolicy);
    // predictedPrice = baseline + trendAdjustment must hold (both rounded
    // the same way at the output boundary).
    expect(result.output.predictedPrice).toBeCloseTo(meta.baselinePrice + meta.trendAdjustment, 2);
    expect(meta.configuration.movingAverageWindowSize).toBe(PRICE_FORECAST_CONFIG.MOVING_AVERAGE_WINDOW_SIZE);
  });

  it("caps historicalObservationCount at the configured moving average window size", () => {
    const engine = new BaselineForecastEngine();
    const history = historyFixture({ observations: denseObservations("2026-06-01", 90, 2000, 1) });
    const result = engine.generate(history, 7);

    expect(result.outcome).toBe("GENERATED");
    if (result.outcome !== "GENERATED") return;
    expect(result.modelMetadata.historicalObservationCount).toBe(PRICE_FORECAST_CONFIG.MOVING_AVERAGE_WINDOW_SIZE);
  });

  it("confidence score is bounded between 0 and 1", () => {
    const engine = new BaselineForecastEngine();
    const result = engine.generate(historyFixture(), 30);
    expect(result.outcome).toBe("GENERATED");
    if (result.outcome !== "GENERATED") return;
    expect(result.confidence.score).toBeGreaterThanOrEqual(0);
    expect(result.confidence.score).toBeLessThanOrEqual(1);
  });
});
