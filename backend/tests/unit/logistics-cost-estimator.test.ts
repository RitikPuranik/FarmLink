import { LogisticsCostEstimator } from "../../src/modules/logistics/logistics-cost-estimator";

const config = {
  baseCostInr: 500,
  ratePerKmInr: 18,
  minimumTripCostInr: 800,
  loadingCostInr: 200,
  unloadingCostInr: 200,
  tollEstimatePerKmInr: 1.5,
  refrigerationSurchargePercent: 15,
};

describe("LogisticsCostEstimator", () => {
  const estimator = new LogisticsCostEstimator(config);

  it("computes base + distance + loading/unloading + toll for a standard trip", () => {
    const result = estimator.estimate({ distanceKm: 100, requiresRefrigeration: false });
    // base 500 + distance 1800 + loading 200 + unloading 200 + toll 150 = 2850
    expect(result.baseCost).toBe(500);
    expect(result.distanceCost).toBe(1800);
    expect(result.loadingCost).toBe(200);
    expect(result.unloadingCost).toBe(200);
    expect(result.tollEstimate).toBe(150);
    expect(result.refrigerationSurcharge).toBe(0);
    expect(result.totalCost).toBe(2850);
    expect(result.currency).toBe("INR");
  });

  it("applies the minimum trip cost floor for very short distances", () => {
    const result = estimator.estimate({ distanceKm: 1, requiresRefrigeration: false });
    // base 500 + distance 18 + loading 200 + unloading 200 + toll 1.5 = 919.5, above floor
    expect(result.totalCost).toBeGreaterThanOrEqual(config.minimumTripCostInr);

    const tinyTrip = estimator.estimate({ distanceKm: 0, requiresRefrigeration: false });
    // base 500 + loading 200 + unloading 200 = 900, still above the 800 floor
    expect(tinyTrip.totalCost).toBe(900);
  });

  it("floors at the configured minimum trip cost even when every component is tiny", () => {
    const cheapEstimator = new LogisticsCostEstimator({ ...config, baseCostInr: 0, loadingCostInr: 0, unloadingCostInr: 0 });
    const result = cheapEstimator.estimate({ distanceKm: 0, requiresRefrigeration: false });
    expect(result.totalCost).toBe(config.minimumTripCostInr);
  });

  it("adds a refrigeration surcharge as a percentage of the pre-surcharge subtotal", () => {
    const withoutRefrigeration = estimator.estimate({ distanceKm: 100, requiresRefrigeration: false });
    const withRefrigeration = estimator.estimate({ distanceKm: 100, requiresRefrigeration: true });
    expect(withRefrigeration.refrigerationSurcharge).toBeCloseTo(withoutRefrigeration.subtotal * 0.15, 2);
    expect(withRefrigeration.totalCost).toBeGreaterThan(withoutRefrigeration.totalCost);
  });

  it("omits loading/unloading when includeLoadingUnloading is false", () => {
    const result = estimator.estimate({ distanceKm: 100, requiresRefrigeration: false, includeLoadingUnloading: false });
    expect(result.loadingCost).toBe(0);
    expect(result.unloadingCost).toBe(0);
  });

  it("never returns a negative cost for a negative distance input", () => {
    const result = estimator.estimate({ distanceKm: -50, requiresRefrigeration: false });
    expect(result.distanceCost).toBe(0);
    expect(result.tollEstimate).toBe(0);
  });

  it("is deterministic", () => {
    const a = estimator.estimate({ distanceKm: 237.5, requiresRefrigeration: true });
    const b = estimator.estimate({ distanceKm: 237.5, requiresRefrigeration: true });
    expect(a).toEqual(b);
  });
});
