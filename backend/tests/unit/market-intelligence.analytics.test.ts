import { average, haversineKm, median, percentChange, trend, volatility } from "../../src/modules/market-intelligence/analytics";

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
});
