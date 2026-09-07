import { validateNormalizedWarehouseRecord } from "../../src/modules/warehouse-intelligence/warehouse-validation.service";
import { NormalizedWarehouseRecord } from "../../src/modules/warehouse-intelligence/warehouse-normalization.service";

function baseRecord(overrides: Partial<NormalizedWarehouseRecord> = {}): NormalizedWarehouseRecord {
  return {
    externalId: "ext-1",
    source: { providerId: "government-wdra", providerType: "GOVERNMENT" },
    name: "ABC Cold Storage",
    location: {
      address: "Plot 12",
      village: null,
      district: "Nashik",
      state: "Maharashtra",
      pincode: "422001",
      latitude: 20.0,
      longitude: 73.7,
    },
    contact: { phone: null, email: null },
    capacity: { totalKg: 1000, availableKg: 400 },
    storageType: "COLD_STORAGE",
    temperatureControlled: true,
    minTemperatureC: 2,
    maxTemperatureC: 6,
    metadata: undefined,
    sourceUpdatedAt: null,
    warnings: [],
    ...overrides,
  };
}

describe("validateNormalizedWarehouseRecord", () => {
  it("returns VALID for a complete, consistent record", () => {
    const result = validateNormalizedWarehouseRecord(baseRecord());
    expect(result.level).toBe("VALID");
    expect(result.errors).toHaveLength(0);
  });

  it("returns PARTIAL (not INVALID) when only optional coordinates are missing", () => {
    const result = validateNormalizedWarehouseRecord(
      baseRecord({ location: { ...baseRecord().location, latitude: null, longitude: null } }),
    );
    expect(result.level).toBe("VALID");
  });

  it("carries normalization warnings through as PARTIAL, not INVALID", () => {
    const result = validateNormalizedWarehouseRecord(
      baseRecord({ warnings: [{ field: "capacityUnit", code: "UNSUPPORTED_CAPACITY_UNIT", message: "x" }] }),
    );
    expect(result.level).toBe("PARTIAL");
    expect(result.errors).toHaveLength(0);
  });

  it("rejects a record missing a name", () => {
    const result = validateNormalizedWarehouseRecord(baseRecord({ name: null }));
    expect(result.level).toBe("INVALID");
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_NAME" })]));
  });

  it("rejects a record missing state or district", () => {
    const result = validateNormalizedWarehouseRecord(baseRecord({ location: { ...baseRecord().location, district: null } }));
    expect(result.level).toBe("INVALID");
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_STATE_OR_DISTRICT" })]));
  });

  it("rejects out-of-range latitude/longitude", () => {
    const result = validateNormalizedWarehouseRecord(baseRecord({ location: { ...baseRecord().location, latitude: 200 } }));
    expect(result.level).toBe("INVALID");
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "INVALID_LATITUDE" })]));
  });

  it("rejects one coordinate present without the other", () => {
    const result = validateNormalizedWarehouseRecord(baseRecord({ location: { ...baseRecord().location, longitude: null } }));
    expect(result.level).toBe("INVALID");
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "INCOMPLETE_COORDINATES" })]));
  });

  it("does not reject an invalid pincode format outright, only warns", () => {
    const result = validateNormalizedWarehouseRecord(baseRecord({ location: { ...baseRecord().location, pincode: "abc" } }));
    expect(result.level).toBe("PARTIAL");
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "INVALID_PINCODE_FORMAT" })]));
  });

  it("rejects negative capacity", () => {
    const result = validateNormalizedWarehouseRecord(baseRecord({ capacity: { totalKg: -5, availableKg: null } }));
    expect(result.level).toBe("INVALID");
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "INVALID_CAPACITY" })]));
  });

  it("rejects NaN/Infinity capacity", () => {
    expect(validateNormalizedWarehouseRecord(baseRecord({ capacity: { totalKg: Number.NaN, availableKg: null } })).level).toBe("INVALID");
    expect(validateNormalizedWarehouseRecord(baseRecord({ capacity: { totalKg: Number.POSITIVE_INFINITY, availableKg: null } })).level).toBe(
      "INVALID",
    );
  });

  it("rejects available capacity exceeding total capacity", () => {
    const result = validateNormalizedWarehouseRecord(baseRecord({ capacity: { totalKg: 100, availableKg: 200 } }));
    expect(result.level).toBe("INVALID");
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "INVALID_CAPACITY" })]));
  });

  it("rejects minimum temperature exceeding maximum temperature", () => {
    const result = validateNormalizedWarehouseRecord(baseRecord({ minTemperatureC: 10, maxTemperatureC: 2 }));
    expect(result.level).toBe("INVALID");
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "INVALID_TEMPERATURE_RANGE" })]));
  });

  it("does not fabricate a temperature-range error when one side is missing", () => {
    const result = validateNormalizedWarehouseRecord(baseRecord({ minTemperatureC: null, maxTemperatureC: 6 }));
    expect(result.level).toBe("VALID");
  });
});
