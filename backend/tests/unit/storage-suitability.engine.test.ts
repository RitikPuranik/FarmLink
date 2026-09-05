import {
  compareBooleanRequirement,
  compareRange,
  compareStorageType,
  evaluateStorageSuitability,
  insufficientCropRequirementsResult,
  insufficientWarehouseConditionDataResult,
} from "../../src/modules/warehouse-intelligence/storage-suitability.engine";
import { CropStorageRequirementInput, StorageConditionsInput } from "../../src/modules/warehouse-intelligence/storage-suitability.types";

function requirement(overrides: Partial<CropStorageRequirementInput> = {}): CropStorageRequirementInput {
  return {
    preferredTemperatureMin: null,
    preferredTemperatureMax: null,
    preferredHumidityMin: null,
    preferredHumidityMax: null,
    requiresVentilation: null,
    requiresColdStorage: null,
    requiresControlledAtmosphere: null,
    requiresPestControl: null,
    requiresMoistureControl: null,
    compatibleStorageTypes: [],
    maximumRecommendedStorageDays: null,
    ...overrides,
  };
}

function conditions(overrides: Partial<StorageConditionsInput> = {}): StorageConditionsInput {
  return {
    storageType: "AMBIENT",
    temperatureControlled: false,
    minTemperature: null,
    maxTemperature: null,
    humidityControlled: false,
    minHumidity: null,
    maxHumidity: null,
    ventilationAvailable: null,
    coldStorageAvailable: null,
    controlledAtmosphereAvailable: null,
    pestControlAvailable: null,
    moistureControlAvailable: null,
    ...overrides,
  };
}

describe("compareRange", () => {
  it("returns NOT_REQUIRED when the crop never configured a preferred range at all", () => {
    expect(compareRange(0, 10, null, null)).toBe("NOT_REQUIRED");
  });

  it("returns UNKNOWN when the crop has a configured range but the warehouse's range is not known", () => {
    expect(compareRange(null, null, 2, 8)).toBe("UNKNOWN");
  });

  it("returns FULL_MATCH when the warehouse range fully contains the crop's preferred range", () => {
    expect(compareRange(0, 10, 2, 8)).toBe("FULL_MATCH");
    expect(compareRange(2, 8, 2, 8)).toBe("FULL_MATCH");
  });

  it("returns PARTIAL_MATCH when the ranges overlap but the warehouse doesn't fully cover the crop's range", () => {
    expect(compareRange(0, 5, 2, 8)).toBe("PARTIAL_MATCH");
  });

  it("returns NO_MATCH when the ranges do not overlap at all", () => {
    expect(compareRange(20, 25, 0, 5)).toBe("NO_MATCH");
  });

  it("returns UNKNOWN for an internally inverted range on either side (never guesses)", () => {
    expect(compareRange(10, 0, 2, 8)).toBe("UNKNOWN");
    expect(compareRange(0, 10, 8, 2)).toBe("UNKNOWN");
  });
});

describe("compareBooleanRequirement", () => {
  it("follows the exact build-spec truth table", () => {
    expect(compareBooleanRequirement(true, true)).toBe("SATISFIED");
    expect(compareBooleanRequirement(true, false)).toBe("UNSATISFIED");
    expect(compareBooleanRequirement(true, null)).toBe("UNKNOWN");
    expect(compareBooleanRequirement(false, true)).toBe("NOT_REQUIRED");
    expect(compareBooleanRequirement(null, false)).toBe("NOT_REQUIRED");
  });

  it("never penalizes a warehouse for a capability the crop didn't ask for", () => {
    expect(compareBooleanRequirement(null, null)).toBe("NOT_REQUIRED");
    expect(compareBooleanRequirement(false, null)).toBe("NOT_REQUIRED");
  });
});

describe("compareStorageType", () => {
  it("is NOT_REQUIRED when no storage-type restriction was configured", () => {
    expect(compareStorageType("AMBIENT", [])).toBe("NOT_REQUIRED");
  });

  it("is COMPATIBLE/INCOMPATIBLE based on membership in the configured list", () => {
    expect(compareStorageType("COLD_STORAGE", ["COLD_STORAGE", "CONTROLLED_ATMOSPHERE"])).toBe("COMPATIBLE");
    expect(compareStorageType("AMBIENT", ["COLD_STORAGE"])).toBe("INCOMPATIBLE");
  });
});

describe("evaluateStorageSuitability", () => {
  it("is SUITABLE when every applicable requirement is satisfied", () => {
    const result = evaluateStorageSuitability(
      requirement({
        preferredTemperatureMin: 2,
        preferredTemperatureMax: 8,
        requiresColdStorage: true,
        compatibleStorageTypes: ["COLD_STORAGE"],
      }),
      conditions({
        storageType: "COLD_STORAGE",
        temperatureControlled: true,
        minTemperature: 0,
        maxTemperature: 10,
        coldStorageAvailable: true,
      }),
    );
    expect(result.status).toBe("SUITABLE");
    expect(result.confidence).toBe(1);
    expect(result.unmetRequirements).toEqual([]);
    expect(result.unknownRequirements).toEqual([]);
  });

  it("is UNSUITABLE when a critical requirement is explicitly unmet (storage type incompatible)", () => {
    const result = evaluateStorageSuitability(
      requirement({ compatibleStorageTypes: ["COLD_STORAGE"] }),
      conditions({ storageType: "AMBIENT" }),
    );
    expect(result.status).toBe("UNSUITABLE");
    expect(result.unmetRequirements).toContain("STORAGE_TYPE");
  });

  it("is UNSUITABLE when required cold storage is explicitly unavailable", () => {
    const result = evaluateStorageSuitability(
      requirement({ requiresColdStorage: true }),
      conditions({ coldStorageAvailable: false }),
    );
    expect(result.status).toBe("UNSUITABLE");
    expect(result.unmetRequirements).toEqual(["COLD_STORAGE"]);
  });

  it("is UNSUITABLE when the temperature ranges are explicitly incompatible", () => {
    const result = evaluateStorageSuitability(
      requirement({ preferredTemperatureMin: 2, preferredTemperatureMax: 8 }),
      conditions({ temperatureControlled: true, minTemperature: 20, maxTemperature: 25 }),
    );
    expect(result.status).toBe("UNSUITABLE");
    expect(result.unmetRequirements).toEqual(["TEMPERATURE_RANGE"]);
  });

  it("is UNKNOWN (never UNSUITABLE) when a critical factor's data is missing", () => {
    const result = evaluateStorageSuitability(
      requirement({ requiresColdStorage: true }),
      conditions({ coldStorageAvailable: null }),
    );
    expect(result.status).toBe("UNKNOWN");
    expect(result.confidence).toBeNull();
    expect(result.unknownRequirements).toEqual(["COLD_STORAGE"]);
    expect(result.unmetRequirements).toEqual([]);
  });

  it("is CONDITIONALLY_SUITABLE when only a non-critical requirement is unmet or unknown", () => {
    const unmet = evaluateStorageSuitability(
      requirement({ requiresVentilation: true }),
      conditions({ ventilationAvailable: false }),
    );
    expect(unmet.status).toBe("CONDITIONALLY_SUITABLE");

    const unknown = evaluateStorageSuitability(
      requirement({ requiresPestControl: true }),
      conditions({ pestControlAvailable: null }),
    );
    expect(unknown.status).toBe("CONDITIONALLY_SUITABLE");
  });

  it("never penalizes a warehouse for a capability the crop doesn't require", () => {
    const result = evaluateStorageSuitability(requirement({}), conditions({ ventilationAvailable: false }));
    expect(result.status).toBe("SUITABLE");
    expect(result.omittedRequirements).toContain("VENTILATION");
  });

  it("mixes satisfied, unmet, and unknown requirements deterministically", () => {
    const result = evaluateStorageSuitability(
      requirement({
        requiresColdStorage: true,
        requiresVentilation: true,
        requiresPestControl: true,
      }),
      conditions({
        coldStorageAvailable: true, // satisfied, critical
        ventilationAvailable: false, // unmet, non-critical
        pestControlAvailable: null, // unknown, non-critical
      }),
    );
    expect(result.status).toBe("CONDITIONALLY_SUITABLE");
    expect(result.satisfiedRequirements).toContain("COLD_STORAGE");
    expect(result.unmetRequirements).toContain("VENTILATION");
    expect(result.unknownRequirements).toContain("PEST_CONTROL");
  });

  it("never lets an unconfigured temperature/humidity preference drag the whole result to UNKNOWN", () => {
    // Regression test: a crop with no preferred temperature/humidity range
    // configured must not be treated as "critical data missing" — those
    // factors are OMITTED, not UNKNOWN, so an otherwise-fully-known,
    // fully-satisfied result must still be SUITABLE.
    const result = evaluateStorageSuitability(
      requirement({ requiresColdStorage: true, compatibleStorageTypes: ["COLD_STORAGE"] }),
      conditions({ storageType: "COLD_STORAGE", coldStorageAvailable: true }),
    );
    expect(result.status).toBe("SUITABLE");
    expect(result.confidence).toBe(1);
    expect(result.omittedRequirements).toEqual(expect.arrayContaining(["TEMPERATURE_RANGE", "HUMIDITY_RANGE"]));
  });

  it("is deterministic: identical inputs always produce an identical result", () => {
    const req = requirement({ requiresColdStorage: true, preferredTemperatureMin: 2, preferredTemperatureMax: 8 });
    const cond = conditions({ coldStorageAvailable: true, temperatureControlled: true, minTemperature: 0, maxTemperature: 10 });
    const a = evaluateStorageSuitability(req, cond);
    const b = evaluateStorageSuitability(req, cond);
    expect(a).toEqual(b);
  });

  it("computes confidence as the fraction of applicable factors with known data", () => {
    const result = evaluateStorageSuitability(
      requirement({ requiresColdStorage: true, requiresVentilation: true }),
      conditions({ coldStorageAvailable: true, ventilationAvailable: null }),
    );
    // 2 applicable factors (coldStorage, ventilation), 1 known -> 0.5
    expect(result.status).toBe("CONDITIONALLY_SUITABLE");
    expect(result.confidence).toBe(0.5);
  });
});

describe("insufficientCropRequirementsResult / insufficientWarehouseConditionDataResult", () => {
  it("are always UNKNOWN with null confidence and the correct explanation code", () => {
    const crop = insufficientCropRequirementsResult();
    expect(crop.status).toBe("UNKNOWN");
    expect(crop.confidence).toBeNull();
    expect(crop.explanationCodes).toEqual(["INSUFFICIENT_CROP_STORAGE_REQUIREMENTS"]);

    const warehouse = insufficientWarehouseConditionDataResult();
    expect(warehouse.status).toBe("UNKNOWN");
    expect(warehouse.confidence).toBeNull();
    expect(warehouse.explanationCodes).toEqual(["INSUFFICIENT_WAREHOUSE_CONDITION_DATA"]);
  });
});
