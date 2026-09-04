import { PriceForecastGenerationService } from "../../src/modules/price-forecasting/price-forecast-generation.service";
import { BASELINE_MODEL_PROVIDER, BASELINE_MODEL_VERSION } from "../../src/modules/price-forecasting/price-forecasting.engine.types";
import { ForecastScope } from "../../src/modules/price-forecasting/price-forecasting.types";
import { PreparedPriceHistory } from "../../src/modules/price-forecasting/price-history.types";

const MANDI_SCOPE: ForecastScope = { type: "MANDI", mandiId: "mandi-1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function makeHistory(overrides: Partial<PreparedPriceHistory> = {}): PreparedPriceHistory {
  return {
    cropId: "crop-1",
    scope: MANDI_SCOPE,
    canonicalPriceSource: "MODAL_PRICE",
    windowStartDate: day("2026-08-01"),
    windowEndDate: day("2026-08-20"),
    observations: [],
    metadata: {
      firstObservationDate: null,
      lastObservationDate: null,
      totalCalendarDays: 20,
      observedDays: 0,
      missingDays: 20,
      coverageRatio: 0,
      largestGapDays: 20,
      outlierCount: 0,
    },
    dataQuality: {
      flags: [],
      rawRecordCount: 0,
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

function makePreparation(history: PreparedPriceHistory = makeHistory()) {
  return { prepare: jest.fn().mockResolvedValue(history) };
}

function makeEngine(result: any) {
  return { generate: jest.fn().mockReturnValue(result) };
}

function makeRepository(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    createOrGetGeneratingForecast: jest.fn().mockResolvedValue({ id: "forecast-1", status: "GENERATING" }),
    completeForecast: jest.fn().mockResolvedValue({ id: "forecast-1", status: "COMPLETED" }),
    failForecast: jest.fn().mockResolvedValue({ id: "forecast-1", status: "FAILED" }),
    markInsufficientData: jest.fn().mockResolvedValue({ id: "forecast-1", status: "INSUFFICIENT_DATA" }),
    ...overrides,
  };
}

const GENERATED_RESULT = {
  outcome: "GENERATED" as const,
  output: { predictedPrice: 2100, lowerBound: 2000, upperBound: 2200 },
  confidence: { score: 0.7, sampleCount: 14 },
  modelMetadata: {
    algorithm: BASELINE_MODEL_VERSION,
    historicalObservationCount: 14,
    historyStartDate: "2026-08-01",
    historyEndDate: "2026-08-14",
    baselinePrice: 2050,
    trendSlope: 3,
    trendDirection: "UP" as const,
    trendAdjustment: 50,
    uncertaintyMethod: "HISTORICAL_STD_DEV_SQRT_HORIZON" as const,
    outlierCount: 0,
    outlierPolicy: "EXCLUDED" as const,
    configuration: {
      movingAverageWindowSize: 14,
      minObservationsForTrend: 5,
      trendFlatThresholdRatio: 0.0005,
      maxDailyTrendAdjustmentRatio: 0.01,
      trendDampingHalfLifeDays: 7,
      maxProjectionPercent: 0.25,
      uncertaintyMultiplier: 1.5,
      uncertaintyHorizonScaling: "SQRT_HORIZON_DAYS" as const,
      minUncertaintyRatio: 0.02,
      confidenceHorizonDecayHalfLifeDays: 14,
    },
  },
};

const INSUFFICIENT_RESULT = { outcome: "INSUFFICIENT_DATA" as const, reasons: ["NO_HISTORICAL_DATA" as const] };

describe("PriceForecastGenerationService — repository lifecycle", () => {
  it("creates a GENERATING record, prepares history, generates, and completes the forecast", async () => {
    const history = makeHistory();
    const preparation = makePreparation(history);
    const engine = makeEngine(GENERATED_RESULT);
    const repository = makeRepository();

    const service = new PriceForecastGenerationService(preparation as any, engine as any, repository as any);
    await service.generateForecast({ cropId: "crop-1", scope: MANDI_SCOPE, targetDate: day("2026-08-21"), horizonDays: 7 });

    expect(repository.createOrGetGeneratingForecast).toHaveBeenCalledWith({
      cropId: "crop-1",
      scope: MANDI_SCOPE,
      targetDate: day("2026-08-21"),
      horizonDays: 7,
      modelProvider: BASELINE_MODEL_PROVIDER,
      modelVersion: BASELINE_MODEL_VERSION,
    });
    expect(preparation.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ cropId: "crop-1", scope: MANDI_SCOPE, horizonDays: 7 }),
    );
    expect(engine.generate).toHaveBeenCalledWith(history, 7);
    expect(repository.completeForecast).toHaveBeenCalledWith(
      "forecast-1",
      expect.objectContaining({
        output: GENERATED_RESULT.output,
        confidence: GENERATED_RESULT.confidence,
        model: expect.objectContaining({
          modelProvider: BASELINE_MODEL_PROVIDER,
          modelVersion: BASELINE_MODEL_VERSION,
          inputDataStartDate: history.windowStartDate,
          inputDataEndDate: history.windowEndDate,
          metadata: GENERATED_RESULT.modelMetadata,
        }),
      }),
    );
    expect(repository.markInsufficientData).not.toHaveBeenCalled();
    expect(repository.failForecast).not.toHaveBeenCalled();
  });

  it("marks the forecast INSUFFICIENT_DATA (not FAILED) when the engine declines to generate", async () => {
    const preparation = makePreparation();
    const engine = makeEngine(INSUFFICIENT_RESULT);
    const repository = makeRepository();

    const service = new PriceForecastGenerationService(preparation as any, engine as any, repository as any);
    await service.generateForecast({ cropId: "crop-1", scope: MANDI_SCOPE, targetDate: day("2026-08-21") });

    expect(repository.markInsufficientData).toHaveBeenCalledWith("forecast-1", ["NO_HISTORICAL_DATA"]);
    expect(repository.completeForecast).not.toHaveBeenCalled();
    expect(repository.failForecast).not.toHaveBeenCalled();
  });

  it("marks the forecast FAILED on an unexpected error and rethrows", async () => {
    const preparation = { prepare: jest.fn().mockRejectedValue(new Error("db connection lost")) };
    const engine = makeEngine(GENERATED_RESULT);
    const repository = makeRepository();

    const service = new PriceForecastGenerationService(preparation as any, engine as any, repository as any);

    await expect(
      service.generateForecast({ cropId: "crop-1", scope: MANDI_SCOPE, targetDate: day("2026-08-21") }),
    ).rejects.toThrow("db connection lost");

    expect(repository.failForecast).toHaveBeenCalledWith("forecast-1", ["db connection lost"]);
    expect(repository.completeForecast).not.toHaveBeenCalled();
    expect(repository.markInsufficientData).not.toHaveBeenCalled();
  });

  it("defaults horizonDays to PRICE_FORECAST_CONFIG.DEFAULT_HORIZON_DAYS when omitted", async () => {
    const preparation = makePreparation();
    const engine = makeEngine(GENERATED_RESULT);
    const repository = makeRepository();

    const service = new PriceForecastGenerationService(preparation as any, engine as any, repository as any);
    await service.generateForecast({ cropId: "crop-1", scope: MANDI_SCOPE, targetDate: day("2026-08-21") });

    const createCallArgs = repository.createOrGetGeneratingForecast.mock.calls[0][0];
    expect(createCallArgs.horizonDays).toBe(7); // PRICE_FORECAST_CONFIG.DEFAULT_HORIZON_DAYS
  });
});

describe("PriceForecastGenerationService — idempotent generation behavior", () => {
  it("returns the existing forecast without re-preparing or re-generating when already COMPLETED", async () => {
    const preparation = makePreparation();
    const engine = makeEngine(GENERATED_RESULT);
    const repository = makeRepository({
      createOrGetGeneratingForecast: jest.fn().mockResolvedValue({ id: "forecast-1", status: "COMPLETED", output: GENERATED_RESULT.output }),
    });

    const service = new PriceForecastGenerationService(preparation as any, engine as any, repository as any);
    const result = await service.generateForecast({ cropId: "crop-1", scope: MANDI_SCOPE, targetDate: day("2026-08-21") });

    expect(result).toEqual({ id: "forecast-1", status: "COMPLETED", output: GENERATED_RESULT.output });
    expect(preparation.prepare).not.toHaveBeenCalled();
    expect(engine.generate).not.toHaveBeenCalled();
    expect(repository.completeForecast).not.toHaveBeenCalled();
  });

  it("returns the existing forecast as-is when already INSUFFICIENT_DATA", async () => {
    const preparation = makePreparation();
    const engine = makeEngine(GENERATED_RESULT);
    const repository = makeRepository({
      createOrGetGeneratingForecast: jest.fn().mockResolvedValue({ id: "forecast-1", status: "INSUFFICIENT_DATA" }),
    });

    const service = new PriceForecastGenerationService(preparation as any, engine as any, repository as any);
    const result = await service.generateForecast({ cropId: "crop-1", scope: MANDI_SCOPE, targetDate: day("2026-08-21") });

    expect(result).toEqual({ id: "forecast-1", status: "INSUFFICIENT_DATA" });
    expect(preparation.prepare).not.toHaveBeenCalled();
    expect(engine.generate).not.toHaveBeenCalled();
  });

  it("repeated calls for the same input never invoke completeForecast more than once", async () => {
    const preparation = makePreparation();
    const engine = makeEngine(GENERATED_RESULT);

    // Simulate the repository's own idempotent upsert: the first call
    // sees GENERATING, the second sees the now-COMPLETED row.
    const createOrGetGeneratingForecast = jest
      .fn()
      .mockResolvedValueOnce({ id: "forecast-1", status: "GENERATING" })
      .mockResolvedValueOnce({ id: "forecast-1", status: "COMPLETED" });
    const repository = makeRepository({ createOrGetGeneratingForecast });

    const service = new PriceForecastGenerationService(preparation as any, engine as any, repository as any);
    await service.generateForecast({ cropId: "crop-1", scope: MANDI_SCOPE, targetDate: day("2026-08-21") });
    await service.generateForecast({ cropId: "crop-1", scope: MANDI_SCOPE, targetDate: day("2026-08-21") });

    expect(repository.completeForecast).toHaveBeenCalledTimes(1);
  });
});
