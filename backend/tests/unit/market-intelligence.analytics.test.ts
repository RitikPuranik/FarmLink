import { average, confidence, freshness, haversineKm, median, percentChange, round, trend, volatility } from "../../src/modules/market-intelligence/analytics";

describe("market intelligence analytics", () => {
  it("calculates stable descriptive statistics without mutating input", () => {
    const values = [3000, 1000, 2000];
    expect(average(values)).toBe(2000);
    expect(median(values)).toBe(2000);
    expect(values).toEqual([3000, 1000, 2000]);
  });
  it("handles zero denominator safely and classifies trends", () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(trend(11)).toBe("STRONGLY_UP");
    expect(trend(-4)).toBe("DOWN");
  });
  it("computes volatility and nearby geographic distance", () => {
    expect(volatility([100, 100, 100])).toEqual({ score: 0, level: "LOW" });
    expect(haversineKm(23.25, 77.41, 23.26, 77.42)).toBeGreaterThan(0);
  });

  // --- Edge cases explicitly called out by the module 6 audit (6.7) ---

  it("average/median return null (not NaN/0) for an empty series", () => {
    expect(average([])).toBeNull();
    expect(median([])).toBeNull();
  });

  it("handles a single price point without dividing by zero", () => {
    expect(average([2000])).toBe(2000);
    expect(median([2000])).toBe(2000);
    // Volatility needs at least 3 points to be statistically meaningful —
    // one point must report UNAVAILABLE, never a fabricated 0.
    expect(volatility([2000])).toEqual({ score: null, level: "UNAVAILABLE" });
  });

  it("handles exactly two price points without dividing by zero", () => {
    expect(average([1000, 3000])).toBe(2000);
    expect(median([1000, 3000])).toBe(2000);
    // Still below the 3-point minimum for volatility.
    expect(volatility([1000, 3000])).toEqual({ score: null, level: "UNAVAILABLE" });
  });

  it("treats a legitimate all-zero price series as safely unavailable, not a crash", () => {
    // mean === 0 here; sd/mean would be a division by zero if computed —
    // the function must short-circuit instead of returning NaN/Infinity.
    const result = volatility([0, 0, 0, 0]);
    expect(result.score === null || Number.isFinite(result.score)).toBe(true);
    expect(Number.isNaN(result.score as number)).toBe(false);
  });

  it("percentChange never divides by zero and never returns NaN", () => {
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange(null, 100)).toBeNull();
    expect(percentChange(100, null)).toBeNull();
    const change = percentChange(150, 100);
    expect(change).toBe(50);
    expect(Number.isNaN(change as number)).toBe(false);
  });

  it("trend() never fabricates a direction when change is unavailable", () => {
    expect(trend(null)).toBe("STABLE");
  });

  it("classifies volatility bands against MARKET_CONFIG thresholds", () => {
    // High spread relative to mean should land in HIGH, a tight cluster in LOW.
    expect(volatility([100, 100, 100]).level).toBe("LOW");
    expect(volatility([50, 100, 200]).level).toBe("HIGH");
  });

  it("classifies freshness by age in hours (boundaries from MARKET_CONFIG)", () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
    expect(freshness(hoursAgo(1))).toBe("FRESH");
    expect(freshness(hoursAgo(48))).toBe("RECENT");
    expect(freshness(hoursAgo(100))).toBe("STALE");
    expect(freshness(hoursAgo(300))).toBe("OUTDATED");
  });

  it("confidence degrades with insufficient records or stale/outdated data, and is never HIGH by default", () => {
    expect(confidence(1, "FRESH", 0)).toBe("INSUFFICIENT_DATA"); // one data point
    expect(confidence(2, "FRESH", 0)).toBe("INSUFFICIENT_DATA"); // two data points
    expect(confidence(20, "OUTDATED", 0)).toBe("INSUFFICIENT_DATA"); // stale trumps record count
    expect(confidence(20, "FRESH", 0.05)).toBe("HIGH");
    expect(confidence(20, "FRESH", 0.5)).toBe("MEDIUM"); // high volatility caps confidence below HIGH
    expect(confidence(5, "RECENT", null)).toBe("LOW");
  });

  it("round() is a plain, deterministic rounding helper (no hidden precision loss)", () => {
    expect(round(12.345, 2)).toBe(12.35);
    expect(round(12.344, 2)).toBe(12.34);
  });
});

