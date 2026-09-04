import {
  assertGeneratedForecastIsSane,
  classifyConfidenceLevel,
  FORECAST_DISCLAIMER,
  FORECAST_LIMITATIONS,
  toForecastResponseDTO,
} from "../../src/modules/price-forecasting/price-forecasting.dto";
import { PRICE_FORECAST_CONFIG } from "../../src/modules/price-forecasting/price-forecasting.config";
import { PersistedForecast } from "../../src/modules/price-forecasting/price-forecasting.types";

const CROP = { id: "crop-1", name: "Wheat" };
const MANDI = { publicId: "mandi-pub-1", name: "Sample Mandi", state: "Madhya Pradesh", district: "Bhopal" };

function baseForecast(overrides: Partial<PersistedForecast> = {}): PersistedForecast {
  return {
    id: "internal-1",
    publicId: "forecast-pub-1",
    cropId: "crop-1",
    scope: { type: "CROP_WIDE" },
    targetDate: new Date("2026-09-11T00:00:00.000Z"),
    horizonDays: 7,
    status: "COMPLETED",
    output: { predictedPrice: 2100, lowerBound: 2000, upperBound: 2200 },
    confidence: { score: 0.65, sampleCount: 14 },
    model: {
      modelProvider: "FARMLINK_BASELINE_ENGINE",
      modelVersion: "WEIGHTED_MOVING_AVERAGE_TREND_V1",
      inputDataStartDate: new Date("2026-08-01T00:00:00.000Z"),
      inputDataEndDate: new Date("2026-09-04T00:00:00.000Z"),
      generatedAt: new Date("2026-09-04T10:00:00.000Z"),
      expiresAt: new Date("2026-09-05T10:00:00.000Z"),
      metadata: {
        algorithm: "WEIGHTED_MOVING_AVERAGE_TREND_V1",
        historicalObservationCount: 14,
        historyStartDate: "2026-08-21",
        historyEndDate: "2026-09-03",
        baselinePrice: 2050,
        trendSlope: 3,
        trendDirection: "UP",
        trendAdjustment: 50,
        uncertaintyMethod: "HISTORICAL_STD_DEV_SQRT_HORIZON",
        outlierCount: 0,
        outlierPolicy: "EXCLUDED",
        coverageRatio: 0.93,
      },
    },
    createdAt: new Date("2026-09-04T10:00:00.000Z"),
    updatedAt: new Date("2026-09-04T10:00:00.000Z"),
    ...overrides,
  };
}

describe("classifyConfidenceLevel", () => {
  it("classifies below MIN_CONFIDENCE_THRESHOLD as LOW", () => {
    expect(classifyConfidenceLevel(PRICE_FORECAST_CONFIG.MIN_CONFIDENCE_THRESHOLD - 0.01)).toBe("LOW");
  });

  it("classifies between the two thresholds as MEDIUM", () => {
    expect(classifyConfidenceLevel(PRICE_FORECAST_CONFIG.MIN_CONFIDENCE_THRESHOLD)).toBe("MEDIUM");
    expect(classifyConfidenceLevel(PRICE_FORECAST_CONFIG.HIGH_CONFIDENCE_THRESHOLD - 0.01)).toBe("MEDIUM");
  });

  it("classifies at/above HIGH_CONFIDENCE_THRESHOLD as HIGH", () => {
    expect(classifyConfidenceLevel(PRICE_FORECAST_CONFIG.HIGH_CONFIDENCE_THRESHOLD)).toBe("HIGH");
    expect(classifyConfidenceLevel(1)).toBe("HIGH");
  });
});

describe("toForecastResponseDTO", () => {
  it("maps a COMPLETED forecast's prediction, confidence, and metadata", () => {
    const dto = toForecastResponseDTO(baseForecast(), CROP, null);

    expect(dto.forecastPublicId).toBe("forecast-pub-1");
    expect(dto.crop).toEqual(CROP);
    expect(dto.status).toBe("COMPLETED");
    expect(dto.prediction).toEqual({
      targetDate: "2026-09-11",
      predictedPrice: 2100,
      lowerBound: 2000,
      upperBound: 2200,
    });
    expect(dto.confidence).toEqual({ score: 0.65, level: "MEDIUM", sampleCount: 14 });
    expect(dto.metadata.modelVersion).toBe("WEIGHTED_MOVING_AVERAGE_TREND_V1");
    expect(dto.metadata.observationsUsed).toBe(14);
    expect(dto.metadata.coverageRatio).toBe(0.93);
    expect(dto.insufficiencyReasons).toEqual([]);
  });

  it("never fabricates a prediction or confidence for a non-COMPLETED forecast", () => {
    const forecast = baseForecast({
      status: "INSUFFICIENT_DATA",
      output: null,
      confidence: null,
      model: {
        ...baseForecast().model,
        metadata: { insufficiencyReasons: ["NO_HISTORICAL_DATA"] },
      },
    });

    const dto = toForecastResponseDTO(forecast, CROP, null);
    expect(dto.prediction).toBeNull();
    expect(dto.confidence).toBeNull();
    expect(dto.insufficiencyReasons).toEqual(["NO_HISTORICAL_DATA"]);
  });

  it("includes the disclaimer and limitations on every response regardless of status", () => {
    const completed = toForecastResponseDTO(baseForecast(), CROP, null);
    const insufficient = toForecastResponseDTO(baseForecast({ status: "INSUFFICIENT_DATA", output: null, confidence: null }), CROP, null);

    expect(completed.disclaimer).toBe(FORECAST_DISCLAIMER);
    expect(completed.limitations).toEqual(FORECAST_LIMITATIONS);
    expect(insufficient.disclaimer).toBe(FORECAST_DISCLAIMER);
    expect(insufficient.limitations).toEqual(FORECAST_LIMITATIONS);
  });

  it("embeds resolved mandi public info for a MANDI scope, never the internal id", () => {
    const forecast = baseForecast({ scope: { type: "MANDI", mandiId: "internal-mandi-id" } });
    const dto = toForecastResponseDTO(forecast, CROP, MANDI);

    expect(dto.scope).toEqual({ type: "MANDI", mandi: MANDI });
    expect(JSON.stringify(dto.scope)).not.toContain("internal-mandi-id");
  });

  it("maps a REGIONAL scope with a null district when none was given", () => {
    const forecast = baseForecast({ scope: { type: "REGIONAL", state: "Madhya Pradesh" } });
    const dto = toForecastResponseDTO(forecast, CROP, null);
    expect(dto.scope).toEqual({ type: "REGIONAL", state: "Madhya Pradesh", district: null });
  });
});

describe("assertGeneratedForecastIsSane", () => {
  it("does not throw for a healthy COMPLETED forecast", () => {
    expect(() => assertGeneratedForecastIsSane(baseForecast(), 7)).not.toThrow();
  });

  it("does nothing for non-COMPLETED forecasts (nothing to validate)", () => {
    const insufficient = baseForecast({ status: "INSUFFICIENT_DATA", output: null, confidence: null });
    expect(() => assertGeneratedForecastIsSane(insufficient, 7)).not.toThrow();
  });

  it("throws when predictedPrice is negative", () => {
    const bad = baseForecast({ output: { predictedPrice: -5, lowerBound: 0, upperBound: 10 } });
    expect(() => assertGeneratedForecastIsSane(bad, 7)).toThrow(/predictedPrice/);
  });

  it("throws when predictedPrice is not finite", () => {
    const bad = baseForecast({ output: { predictedPrice: Number.NaN, lowerBound: 0, upperBound: 10 } });
    expect(() => assertGeneratedForecastIsSane(bad, 7)).toThrow(/predictedPrice/);
  });

  it("throws when lowerBound exceeds upperBound", () => {
    const bad = baseForecast({ output: { predictedPrice: 100, lowerBound: 200, upperBound: 150 } });
    expect(() => assertGeneratedForecastIsSane(bad, 7)).toThrow(/lowerBound/);
  });

  it("throws when confidence score is out of [0,1] bounds", () => {
    const bad = baseForecast({ confidence: { score: 1.5, sampleCount: 10 } });
    expect(() => assertGeneratedForecastIsSane(bad, 7)).toThrow(/confidence/);
  });

  it("throws when the persisted horizon does not match the requested horizon", () => {
    const forecast = baseForecast({ horizonDays: 7 });
    expect(() => assertGeneratedForecastIsSane(forecast, 30)).toThrow(/horizon/);
  });

  it("throws when a COMPLETED forecast is missing output or confidence", () => {
    const bad = baseForecast({ output: null });
    expect(() => assertGeneratedForecastIsSane(bad, 7)).toThrow(/missing/);
  });
});
