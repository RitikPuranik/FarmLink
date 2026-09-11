import { haversineDistanceKm, HaversineRouteDistanceProvider } from "../../src/modules/logistics/route-distance.provider";

describe("haversineDistanceKm", () => {
  it("is zero for the same point", () => {
    expect(haversineDistanceKm({ latitude: 23.25, longitude: 77.41 }, { latitude: 23.25, longitude: 77.41 })).toBeCloseTo(0, 5);
  });

  it("matches the known great-circle distance between Delhi and Mumbai (~1150km)", () => {
    const delhi = { latitude: 28.6139, longitude: 77.209 };
    const mumbai = { latitude: 19.076, longitude: 72.8777 };
    const distance = haversineDistanceKm(delhi, mumbai);
    expect(distance).toBeGreaterThan(1100);
    expect(distance).toBeLessThan(1200);
  });

  it("is symmetric", () => {
    const a = { latitude: 23.25, longitude: 77.41 };
    const b = { latitude: 21.15, longitude: 79.09 };
    expect(haversineDistanceKm(a, b)).toBeCloseTo(haversineDistanceKm(b, a), 8);
  });
});

describe("HaversineRouteDistanceProvider", () => {
  const provider = new HaversineRouteDistanceProvider({ roadDistanceMultiplier: 1.25, averageSpeedKmph: 40 });

  it("scales the straight-line distance by the configured road-distance multiplier", async () => {
    const origin = { latitude: 23.25, longitude: 77.41 };
    const destination = { latitude: 21.15, longitude: 79.09 };
    const straightLine = haversineDistanceKm(origin, destination);
    const distance = await provider.calculateDistance(origin, destination);
    expect(distance).toBeCloseTo(straightLine * 1.25, 5);
  });

  it("derives duration from distance and the configured average speed", async () => {
    const duration = await provider.calculateDuration(80);
    expect(duration).toBe(120); // 80km at 40kmph = 2h = 120min
  });

  it("estimateRoute always marks the result as estimated", async () => {
    const result = await provider.estimateRoute({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 });
    expect(result.isEstimated).toBe(true);
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.durationMinutes).toBeGreaterThan(0);
  });

  it("is deterministic: the same input always produces the same output", async () => {
    const origin = { latitude: 12.9716, longitude: 77.5946 };
    const destination = { latitude: 13.0827, longitude: 80.2707 };
    const first = await provider.estimateRoute(origin, destination);
    const second = await provider.estimateRoute(origin, destination);
    expect(first).toEqual(second);
  });

  it("returns zero duration rather than dividing by zero when average speed is misconfigured to 0", async () => {
    const zeroSpeedProvider = new HaversineRouteDistanceProvider({ roadDistanceMultiplier: 1.25, averageSpeedKmph: 0 });
    expect(await zeroSpeedProvider.calculateDuration(100)).toBe(0);
  });
});
