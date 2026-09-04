import {
  aggregateStorageUnitsToKg,
  calculateUtilizationPercentage,
  canAccommodateQuantity,
  capacityStatus,
  resolveCropCompatibility,
  toKg,
} from "../../src/modules/warehouse-intelligence/warehouse-capacity";

describe("toKg (Module 9 Part 2)", () => {
  it("converts QTL and TONNE to the KG base unit using the shared fpo/unit-conversion factors", () => {
    expect(toKg(1, "QTL")).toBe(100);
    expect(toKg(1, "TONNE")).toBe(1000);
    expect(toKg(50, "KG")).toBe(50);
  });
});

describe("aggregateStorageUnitsToKg", () => {
  it("returns null (not zero) when there are no active storage units at all", () => {
    expect(aggregateStorageUnitsToKg([])).toBeNull();
    expect(
      aggregateStorageUnitsToKg([{ totalCapacity: 100, availableCapacity: 50, capacityUnit: "KG", isActive: false }]),
    ).toBeNull();
  });

  it("sums only active units, converting each to KG first", () => {
    const result = aggregateStorageUnitsToKg([
      { totalCapacity: 10, availableCapacity: 4, capacityUnit: "TONNE", isActive: true }, // 10,000 / 4,000 kg
      { totalCapacity: 5, availableCapacity: 5, capacityUnit: "QTL", isActive: true }, // 500 / 500 kg
      { totalCapacity: 999, availableCapacity: 999, capacityUnit: "KG", isActive: false }, // excluded
    ]);

    expect(result).toEqual({ totalKg: 10500, availableKg: 4500, unitCount: 2 });
  });

  it("handles a zero-capacity active unit without throwing or dropping it", () => {
    const result = aggregateStorageUnitsToKg([{ totalCapacity: 0, availableCapacity: 0, capacityUnit: "KG", isActive: true }]);
    expect(result).toEqual({ totalKg: 0, availableKg: 0, unitCount: 1 });
  });

  it("skips a unit with non-finite capacity values rather than corrupting the sum", () => {
    const result = aggregateStorageUnitsToKg([
      { totalCapacity: Number.NaN, availableCapacity: 10, capacityUnit: "KG", isActive: true },
      { totalCapacity: 100, availableCapacity: 100, capacityUnit: "KG", isActive: true },
    ]);
    expect(result).toEqual({ totalKg: 100, availableKg: 100, unitCount: 2 });
  });
});

describe("calculateUtilizationPercentage", () => {
  it("returns null for a missing, zero, or negative total (undefined utilization, not 0%)", () => {
    expect(calculateUtilizationPercentage(null, 50)).toBeNull();
    expect(calculateUtilizationPercentage(0, 0)).toBeNull();
    expect(calculateUtilizationPercentage(-10, 5)).toBeNull();
  });

  it("returns null when availableKg is non-finite", () => {
    expect(calculateUtilizationPercentage(100, null)).toBeNull();
    expect(calculateUtilizationPercentage(100, Number.NaN)).toBeNull();
  });

  it("computes occupied/total as a percentage for a partially occupied warehouse", () => {
    expect(calculateUtilizationPercentage(1000, 250)).toBe(75);
  });

  it("returns 0 for an empty warehouse and 100 for a full one", () => {
    expect(calculateUtilizationPercentage(1000, 1000)).toBe(0);
    expect(calculateUtilizationPercentage(1000, 0)).toBe(100);
  });

  it("clamps to [0, 100] rather than reporting an impossible percentage for a data error", () => {
    expect(calculateUtilizationPercentage(100, 150)).toBe(0); // "available" exceeds total: never negative occupancy
  });
});

describe("capacityStatus", () => {
  it("is UNAVAILABLE when no capacity is configured at all", () => {
    expect(capacityStatus(null, null)).toBe("UNAVAILABLE");
  });

  it("is UNAVAILABLE for a zero or negative total", () => {
    expect(capacityStatus(0, 0)).toBe("UNAVAILABLE");
    expect(capacityStatus(-5, 0)).toBe("UNAVAILABLE");
  });

  it("is FULL when available capacity is exactly zero", () => {
    expect(capacityStatus(1000, 0)).toBe("FULL");
  });

  it("is AVAILABLE for a lightly occupied warehouse", () => {
    expect(capacityStatus(1000, 900)).toBe("AVAILABLE"); // 10% utilized
  });

  it("is LIMITED at/above the configured utilization threshold while capacity remains", () => {
    expect(capacityStatus(1000, 200)).toBe("LIMITED"); // 80% utilized, default threshold
    expect(capacityStatus(1000, 199)).toBe("LIMITED"); // 80.1%
  });

  it("respects a custom threshold argument instead of hardcoding 80", () => {
    expect(capacityStatus(1000, 400, 50)).toBe("LIMITED"); // 60% >= 50% threshold
    expect(capacityStatus(1000, 600, 50)).toBe("AVAILABLE"); // 40% < 50% threshold
  });

  it("handles an exact-fit boundary (available just above zero) as AVAILABLE or LIMITED, never FULL", () => {
    expect(capacityStatus(1000, 1)).not.toBe("FULL");
  });
});

describe("canAccommodateQuantity", () => {
  it("returns false when capacity is unknown/null", () => {
    expect(canAccommodateQuantity(null, 10)).toBe(false);
  });

  it("returns false for a non-positive or non-finite requested quantity", () => {
    expect(canAccommodateQuantity(1000, 0)).toBe(false);
    expect(canAccommodateQuantity(1000, -5)).toBe(false);
    expect(canAccommodateQuantity(1000, Number.NaN)).toBe(false);
  });

  it("treats an exact-fit request as accommodable", () => {
    expect(canAccommodateQuantity(500, 500)).toBe(true);
  });

  it("returns false when the requested quantity exceeds available capacity", () => {
    expect(canAccommodateQuantity(499, 500)).toBe(false);
  });

  it("returns true with capacity to spare", () => {
    expect(canAccommodateQuantity(1000, 500)).toBe(true);
  });
});

describe("resolveCropCompatibility", () => {
  it("is UNKNOWN when no capability row exists for this crop at all", () => {
    expect(resolveCropCompatibility([])).toBe("UNKNOWN");
  });

  it("is SUPPORTED for a warehouse-wide COMPATIBLE row", () => {
    expect(resolveCropCompatibility([{ storageUnitId: null, compatibility: "COMPATIBLE" }])).toBe("SUPPORTED");
  });

  it("is UNSUPPORTED for INCOMPATIBLE and for NOT_RECOMMENDED alike (both gate a hard fit check)", () => {
    expect(resolveCropCompatibility([{ storageUnitId: null, compatibility: "INCOMPATIBLE" }])).toBe("UNSUPPORTED");
    expect(resolveCropCompatibility([{ storageUnitId: null, compatibility: "NOT_RECOMMENDED" }])).toBe("UNSUPPORTED");
  });

  it("never upgrades an unknown/missing row to SUPPORTED", () => {
    expect(
      resolveCropCompatibility([{ storageUnitId: "other-unit", compatibility: "COMPATIBLE" }], "unit-1"),
    ).toBe("UNKNOWN");
  });

  it("prefers a storage-unit-scoped row over the warehouse-wide row for that unit", () => {
    const rows = [
      { storageUnitId: null, compatibility: "COMPATIBLE" as const },
      { storageUnitId: "unit-1", compatibility: "INCOMPATIBLE" as const },
    ];
    expect(resolveCropCompatibility(rows, "unit-1")).toBe("UNSUPPORTED");
    expect(resolveCropCompatibility(rows)).toBe("SUPPORTED"); // no unit requested -> warehouse-wide row applies
  });
});
