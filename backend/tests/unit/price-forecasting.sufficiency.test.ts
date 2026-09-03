import { checkDataSufficiency } from "../../src/modules/price-forecasting/price-forecasting.sufficiency";
import { PRICE_FORECAST_CONFIG } from "../../src/modules/price-forecasting/price-forecasting.config";

describe("price forecasting data sufficiency contract (Module 7 Part 1)", () => {
  it("reports sufficient when all thresholds are cleared", () => {
    const result = checkDataSufficiency({
      totalObservations: PRICE_FORECAST_CONFIG.MIN_HISTORICAL_OBSERVATIONS + 10,
      observationsInWindow: PRICE_FORECAST_CONFIG.MIN_OBSERVATIONS_IN_WINDOW + 5,
      horizonDays: PRICE_FORECAST_CONFIG.DEFAULT_HORIZON_DAYS,
    });
    expect(result).toEqual({ sufficient: true, reasons: [] });
  });

  it("reports NO_HISTORICAL_DATA when a crop has no historical records at all", () => {
    const result = checkDataSufficiency({
      totalObservations: 0,
      observationsInWindow: 0,
      horizonDays: PRICE_FORECAST_CONFIG.DEFAULT_HORIZON_DAYS,
    });
    expect(result.sufficient).toBe(false);
    expect(result.reasons).toContain("NO_HISTORICAL_DATA");
    // A zero-observation crop should not additionally report sparseness —
    // that would be a redundant reason for the same underlying fact.
    expect(result.reasons).not.toContain("SPARSE_DATA_IN_WINDOW");
  });

  it("reports INSUFFICIENT_TOTAL_OBSERVATIONS when below the historical minimum", () => {
    const result = checkDataSufficiency({
      totalObservations: PRICE_FORECAST_CONFIG.MIN_HISTORICAL_OBSERVATIONS - 1,
      observationsInWindow: PRICE_FORECAST_CONFIG.MIN_OBSERVATIONS_IN_WINDOW,
      horizonDays: PRICE_FORECAST_CONFIG.DEFAULT_HORIZON_DAYS,
    });
    expect(result.sufficient).toBe(false);
    expect(result.reasons).toContain("INSUFFICIENT_TOTAL_OBSERVATIONS");
  });

  it("reports SPARSE_DATA_IN_WINDOW when total history is fine but the requested window is sparse", () => {
    const result = checkDataSufficiency({
      totalObservations: PRICE_FORECAST_CONFIG.MIN_HISTORICAL_OBSERVATIONS + 100,
      observationsInWindow: PRICE_FORECAST_CONFIG.MIN_OBSERVATIONS_IN_WINDOW - 1,
      horizonDays: PRICE_FORECAST_CONFIG.DEFAULT_HORIZON_DAYS,
    });
    expect(result.sufficient).toBe(false);
    expect(result.reasons).toEqual(["SPARSE_DATA_IN_WINDOW"]);
  });

  it("reports HORIZON_EXCEEDS_LIMIT when the requested horizon exceeds the configured max", () => {
    const result = checkDataSufficiency({
      totalObservations: PRICE_FORECAST_CONFIG.MIN_HISTORICAL_OBSERVATIONS + 10,
      observationsInWindow: PRICE_FORECAST_CONFIG.MIN_OBSERVATIONS_IN_WINDOW + 5,
      horizonDays: PRICE_FORECAST_CONFIG.MAX_HORIZON_DAYS + 1,
    });
    expect(result.sufficient).toBe(false);
    expect(result.reasons).toEqual(["HORIZON_EXCEEDS_LIMIT"]);
  });

  it("collects every applicable reason at once rather than stopping at the first", () => {
    const result = checkDataSufficiency({
      totalObservations: 0,
      observationsInWindow: 0,
      horizonDays: PRICE_FORECAST_CONFIG.MAX_HORIZON_DAYS + 5,
    });
    expect(result.sufficient).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["NO_HISTORICAL_DATA", "HORIZON_EXCEEDS_LIMIT"]),
    );
  });
});
