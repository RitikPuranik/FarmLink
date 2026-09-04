import {
  clampDailySlope,
  computeUncertaintyRange,
  linearRegression,
  projectForecast,
  standardDeviation,
  trendDampingFactor,
  trendDirection,
  weightedMovingAverage,
} from "../../src/modules/price-forecasting/price-forecasting.math";

describe("weightedMovingAverage", () => {
  it("favors recent values over a simple average", () => {
    // Simple average of [100, 100, 200] is 133.33 — the weighted version
    // should sit strictly above that because the trailing 200 carries the
    // heaviest weight.
    const values = [100, 100, 200];
    const simpleAverage = values.reduce((a, b) => a + b, 0) / values.length;
    const wma = weightedMovingAverage(values);
    expect(wma).toBeGreaterThan(simpleAverage);
  });

  it("returns the constant value for a flat series (normalized weights)", () => {
    expect(weightedMovingAverage([2000, 2000, 2000, 2000])).toBeCloseTo(2000, 10);
  });

  it("matches a hand-computed weighted average for a known series", () => {
    // weights 1,2,3 over [10, 20, 30] -> (10*1 + 20*2 + 30*3) / 6 = 140/6
    expect(weightedMovingAverage([10, 20, 30])).toBeCloseTo(140 / 6, 10);
  });

  it("is zero-safe for an empty series", () => {
    expect(weightedMovingAverage([])).toBe(0);
  });

  it("handles a single observation without dividing by zero", () => {
    expect(weightedMovingAverage([1500])).toBe(1500);
  });
});

describe("linearRegression", () => {
  it("detects an upward trend", () => {
    const points = [0, 1, 2, 3, 4].map((x) => ({ x, y: 100 + x * 10 }));
    const { slope } = linearRegression(points);
    expect(slope).toBeCloseTo(10, 6);
  });

  it("detects a downward trend", () => {
    const points = [0, 1, 2, 3, 4].map((x) => ({ x, y: 100 - x * 5 }));
    const { slope } = linearRegression(points);
    expect(slope).toBeCloseTo(-5, 6);
  });

  it("detects a flat trend", () => {
    const points = [0, 1, 2, 3, 4].map((x) => ({ x, y: 100 }));
    const { slope } = linearRegression(points);
    expect(slope).toBeCloseTo(0, 6);
  });

  it("fits a reasonable slope sign through noisy but generally-increasing data", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 1, y: 98 },
      { x: 2, y: 105 },
      { x: 3, y: 103 },
      { x: 4, y: 112 },
      { x: 5, y: 109 },
      { x: 6, y: 118 },
    ];
    const { slope } = linearRegression(points);
    expect(slope).toBeGreaterThan(0);
  });

  it("is zero-safe for zero or one points", () => {
    expect(linearRegression([]).slope).toBe(0);
    expect(linearRegression([{ x: 0, y: 50 }])).toEqual({ slope: 0, intercept: 50 });
  });

  it("is zero-safe when every x is identical (degenerate denominator)", () => {
    const points = [
      { x: 5, y: 10 },
      { x: 5, y: 20 },
      { x: 5, y: 30 },
    ];
    const { slope, intercept } = linearRegression(points);
    expect(slope).toBe(0);
    expect(intercept).toBeCloseTo(20, 10);
  });
});

describe("trendDirection", () => {
  const threshold = 0.001; // 0.1% of baseline per day

  it("classifies UP when the relative daily slope clears the threshold", () => {
    expect(trendDirection(5, 1000, threshold)).toBe("UP"); // 0.5%/day
  });

  it("classifies DOWN when the relative daily slope clears the negative threshold", () => {
    expect(trendDirection(-5, 1000, threshold)).toBe("DOWN");
  });

  it("classifies FLAT for noise just inside the threshold", () => {
    expect(trendDirection(0.5, 1000, threshold)).toBe("FLAT"); // 0.05%/day
  });

  it("classifies FLAT right at the threshold boundary (strict inequality)", () => {
    expect(trendDirection(1, 1000, threshold)).toBe("FLAT"); // exactly 0.1%/day
  });

  it("treats a non-positive baseline as FLAT rather than dividing by zero", () => {
    expect(trendDirection(5, 0, threshold)).toBe("FLAT");
    expect(trendDirection(5, -10, threshold)).toBe("FLAT");
  });
});

describe("standardDeviation", () => {
  it("is zero for a constant series", () => {
    expect(standardDeviation([100, 100, 100])).toBe(0);
  });

  it("is zero-safe for empty and single-value series", () => {
    expect(standardDeviation([])).toBe(0);
    expect(standardDeviation([42])).toBe(0);
  });

  it("computes the population standard deviation for a known series", () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] has a population std dev of 2.
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6);
  });
});

describe("trendDampingFactor", () => {
  it("is 1 at horizon 0 (no damping)", () => {
    expect(trendDampingFactor(0, 7)).toBe(1);
  });

  it("is exactly 0.5 when horizon equals the half-life", () => {
    expect(trendDampingFactor(7, 7)).toBeCloseTo(0.5, 10);
  });

  it("strictly decreases as the horizon grows", () => {
    const f1 = trendDampingFactor(1, 7);
    const f7 = trendDampingFactor(7, 7);
    const f30 = trendDampingFactor(30, 7);
    expect(f1).toBeGreaterThan(f7);
    expect(f7).toBeGreaterThan(f30);
    expect(f30).toBeGreaterThan(0);
  });

  it("treats a non-positive half-life as no damping rather than dividing by zero", () => {
    expect(trendDampingFactor(10, 0)).toBe(1);
    expect(trendDampingFactor(10, -3)).toBe(1);
  });
});

describe("clampDailySlope", () => {
  it("passes a slope through unchanged when within the cap", () => {
    expect(clampDailySlope(5, 1000, 0.01)).toBe(5); // cap is 10
  });

  it("caps a slope that exceeds the positive bound", () => {
    expect(clampDailySlope(50, 1000, 0.01)).toBe(10);
  });

  it("caps a slope that exceeds the negative bound", () => {
    expect(clampDailySlope(-50, 1000, 0.01)).toBe(-10);
  });
});

describe("projectForecast", () => {
  const config = { maxDailyTrendAdjustmentRatio: 0.01, trendDampingHalfLifeDays: 7, maxProjectionPercent: 0.25 };

  it("returns the baseline unchanged for a zero slope", () => {
    const { trendAdjustment, predictedPrice } = projectForecast(2000, 0, 7, config);
    expect(trendAdjustment).toBe(0);
    expect(predictedPrice).toBe(2000);
  });

  it("projects a positive adjustment for a positive slope", () => {
    const { trendAdjustment, predictedPrice } = projectForecast(2000, 3, 7, config);
    expect(trendAdjustment).toBeGreaterThan(0);
    expect(predictedPrice).toBeGreaterThan(2000);
  });

  it("projects a negative adjustment for a negative slope", () => {
    const { trendAdjustment, predictedPrice } = projectForecast(2000, -3, 7, config);
    expect(trendAdjustment).toBeLessThan(0);
    expect(predictedPrice).toBeLessThan(2000);
  });

  it("damping reduces the per-day contribution of the trend as horizon grows", () => {
    // Compare the adjustment-per-horizon-day at a short vs a long horizon
    // for the same (uncapped-by-total-percent) slope — damping should
    // make the longer horizon's per-day contribution smaller.
    const short = projectForecast(5000, 2, 1, config);
    const long = projectForecast(5000, 2, 60, config);
    const shortPerDay = short.trendAdjustment / 1;
    const longPerDay = long.trendAdjustment / 60;
    expect(longPerDay).toBeLessThan(shortPerDay);
  });

  it("never lets the total projection exceed maxProjectionPercent of the baseline", () => {
    // A large, uncapped-by-daily-cap slope over a long horizon would
    // otherwise blow past any reasonable bound — the total-movement cap
    // must hold regardless.
    const { trendAdjustment, predictedPrice } = projectForecast(1000, 1000, 30, config);
    const maxAllowed = 1000 * config.maxProjectionPercent;
    expect(Math.abs(trendAdjustment)).toBeLessThanOrEqual(maxAllowed + 1e-9);
    expect(predictedPrice).toBeLessThanOrEqual(1000 + maxAllowed + 1e-9);
  });

  it("never projects a non-positive price, and keeps trendAdjustment consistent with the floor", () => {
    const { trendAdjustment, predictedPrice } = projectForecast(100, -1000, 30, config);
    expect(predictedPrice).toBeGreaterThanOrEqual(0);
    expect(predictedPrice).toBe(100 + trendAdjustment);
  });
});

describe("computeUncertaintyRange", () => {
  const config = { uncertaintyMultiplier: 1.5, minUncertaintyRatio: 0.02 };

  it("produces a valid interval containing the predicted price", () => {
    const { lowerBound, upperBound } = computeUncertaintyRange(2000, 50, 7, config);
    expect(lowerBound).toBeLessThanOrEqual(2000);
    expect(upperBound).toBeGreaterThanOrEqual(2000);
  });

  it("widens as the forecast horizon grows, holding dispersion constant", () => {
    const short = computeUncertaintyRange(2000, 50, 1, config);
    const long = computeUncertaintyRange(2000, 50, 30, config);
    const shortWidth = short.upperBound - short.lowerBound;
    const longWidth = long.upperBound - long.lowerBound;
    expect(longWidth).toBeGreaterThan(shortWidth);
  });

  it("widens for higher dispersion and narrows for lower dispersion", () => {
    const highVol = computeUncertaintyRange(2000, 200, 7, config);
    const lowVol = computeUncertaintyRange(2000, 10, 7, config);
    const highWidth = highVol.upperBound - highVol.lowerBound;
    const lowWidth = lowVol.upperBound - lowVol.lowerBound;
    expect(highWidth).toBeGreaterThan(lowWidth);
  });

  it("never lets the lower bound go negative even with extreme dispersion", () => {
    const { lowerBound } = computeUncertaintyRange(100, 100000, 30, config);
    expect(lowerBound).toBe(0);
  });

  it("applies the minimum-width floor when dispersion is (near) zero", () => {
    const { lowerBound, upperBound } = computeUncertaintyRange(2000, 0, 7, config);
    const width = upperBound - lowerBound;
    expect(width).toBeCloseTo(2000 * config.minUncertaintyRatio * 2, 6);
  });
});
