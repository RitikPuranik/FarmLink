import { normalizeExternalWarehouseRecord } from "../../src/modules/warehouse-intelligence/warehouse-normalization.service";
import { ExternalWarehouseRecord } from "../../src/modules/warehouse-intelligence/providers/warehouse-data-provider";

function baseRecord(overrides: Partial<ExternalWarehouseRecord> = {}): ExternalWarehouseRecord {
  return {
    externalId: "ext-1",
    source: { providerId: "government-wdra", providerType: "GOVERNMENT" },
    name: "  ABC Cold Storage  ",
    location: {
      address: "Plot 12, MIDC",
      village: null,
      district: "Nashik",
      state: "Maharashtra",
      pincode: "422001",
      latitude: 20.0,
      longitude: 73.7,
    },
    contact: { phone: "9999999999", email: null },
    storage: {
      totalCapacity: "1,000",
      availableCapacity: "400",
      capacityUnit: "TONNE",
      storageType: "cold storage",
      temperatureControlled: true,
      minimumTemperature: "2",
      maximumTemperature: "6",
    },
    metadata: { registryId: "WDRA-1" },
    sourceUpdatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("normalizeExternalWarehouseRecord", () => {
  it("trims strings and converts capacity to KG using the canonical unit table", () => {
    const result = normalizeExternalWarehouseRecord(baseRecord());
    expect(result.name).toBe("ABC Cold Storage");
    expect(result.capacity).toEqual({ totalKg: 1_000_000, availableKg: 400_000 });
    expect(result.storageType).toBe("COLD_STORAGE");
    expect(result.warnings).toHaveLength(0);
  });

  it("never invents capacity when the source supplied none at all", () => {
    const result = normalizeExternalWarehouseRecord(baseRecord({ storage: undefined }));
    expect(result.capacity).toBeNull();
    expect(result.warnings).toHaveLength(0);
  });

  it("drops (never guesses) capacity for an unsupported unit, with a warning", () => {
    const result = normalizeExternalWarehouseRecord(
      baseRecord({ storage: { totalCapacity: "500", availableCapacity: null, capacityUnit: "BAGS" } }),
    );
    expect(result.capacity).toEqual({ totalKg: null, availableKg: null });
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "capacityUnit", code: "UNSUPPORTED_CAPACITY_UNIT" })]),
    );
  });

  it("drops an unparseable numeric capacity value with a warning instead of throwing", () => {
    const result = normalizeExternalWarehouseRecord(
      baseRecord({ storage: { totalCapacity: "not-a-number", availableCapacity: null, capacityUnit: "KG" } }),
    );
    expect(result.capacity?.totalKg).toBeNull();
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "totalCapacity", code: "UNPARSEABLE_NUMBER" })]),
    );
  });

  it("returns null (never a guessed type) for an unrecognized storage type hint", () => {
    const result = normalizeExternalWarehouseRecord(baseRecord({ storage: { ...baseRecord().storage!, storageType: "banana shed" } }));
    expect(result.storageType).toBeNull();
  });

  it("leaves missing optional fields as null rather than defaulting them", () => {
    const result = normalizeExternalWarehouseRecord(
      baseRecord({
        location: { address: null, village: null, district: "Nashik", state: "Maharashtra", pincode: null, latitude: null, longitude: null },
        contact: undefined,
      }),
    );
    expect(result.location.latitude).toBeNull();
    expect(result.location.longitude).toBeNull();
    expect(result.location.pincode).toBeNull();
    expect(result.contact).toEqual({ phone: null, email: null });
  });

  it("preserves source metadata and sourceUpdatedAt", () => {
    const result = normalizeExternalWarehouseRecord(baseRecord());
    expect(result.metadata).toEqual({ registryId: "WDRA-1" });
    expect(result.sourceUpdatedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  describe("status normalization (WDRA Active/Inactive/Suspended mapping)", () => {
    it.each([
      ["Active", "ACTIVE"],
      ["active", "ACTIVE"],
      ["  ACTIVE  ", "ACTIVE"],
      ["Inactive", "INACTIVE"],
      ["INACTIVE", "INACTIVE"],
      ["Suspended", "SUSPENDED"],
      ["suspended", "SUSPENDED"],
    ])("maps %s -> %s, handling case/whitespace safely", (raw, expected) => {
      const result = normalizeExternalWarehouseRecord(baseRecord({ status: raw }));
      expect(result.status).toBe(expected);
    });

    it("returns null (never guessed) and warns for an unrecognized status", () => {
      const result = normalizeExternalWarehouseRecord(baseRecord({ status: "Under Review" }));
      expect(result.status).toBeNull();
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "status", code: "UNRECOGNIZED_STATUS" })]),
      );
    });

    it("returns null without a warning when no status was supplied at all", () => {
      const result = normalizeExternalWarehouseRecord(baseRecord({ status: undefined }));
      expect(result.status).toBeNull();
      expect(result.warnings.some((w) => w.field === "status")).toBe(false);
    });
  });
});
