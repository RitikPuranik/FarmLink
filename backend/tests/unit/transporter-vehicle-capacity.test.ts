import { TransporterDomainError } from "../../src/common/errors";
import { toCapacityDisplay, validateAndNormalizeCapacity } from "../../src/modules/transporters/vehicle-capacity";

describe("validateAndNormalizeCapacity", () => {
  it("normalizes KG to KG (identity)", () => {
    expect(validateAndNormalizeCapacity({ value: 5000, unit: "KG" })).toBe(5000);
  });

  it("normalizes QTL to KG", () => {
    expect(validateAndNormalizeCapacity({ value: 50, unit: "QTL" })).toBe(5000);
  });

  it("normalizes TONNE to KG", () => {
    expect(validateAndNormalizeCapacity({ value: 5, unit: "TONNE" })).toBe(5000);
  });

  it("rejects zero capacity", () => {
    expect(() => validateAndNormalizeCapacity({ value: 0, unit: "KG" })).toThrow(TransporterDomainError);
  });

  it("rejects negative capacity", () => {
    expect(() => validateAndNormalizeCapacity({ value: -100, unit: "KG" })).toThrow(TransporterDomainError);
  });

  it("rejects NaN", () => {
    expect(() => validateAndNormalizeCapacity({ value: NaN, unit: "KG" })).toThrow(TransporterDomainError);
  });

  it("rejects Infinity", () => {
    expect(() => validateAndNormalizeCapacity({ value: Infinity, unit: "KG" })).toThrow(TransporterDomainError);
  });

  it("rejects an unsupported unit", () => {
    expect(() =>
      validateAndNormalizeCapacity({ value: 100, unit: "LB" as unknown as "KG" }),
    ).toThrow(TransporterDomainError);
  });

  it("throws with the INVALID_VEHICLE_CAPACITY code", () => {
    try {
      validateAndNormalizeCapacity({ value: -1, unit: "KG" });
      fail("expected to throw");
    } catch (err) {
      expect((err as TransporterDomainError).code).toBe("INVALID_VEHICLE_CAPACITY");
    }
  });
});

describe("toCapacityDisplay", () => {
  it("round-trips KG -> QTL -> KG without drift", () => {
    const capacityKg = 5000;
    const display = toCapacityDisplay(capacityKg, "QTL");
    expect(display).toEqual({ value: 50, unit: "QTL" });
  });

  it("round-trips KG -> TONNE", () => {
    expect(toCapacityDisplay(5000, "TONNE")).toEqual({ value: 5, unit: "TONNE" });
  });

  it("round-trips KG -> KG (identity)", () => {
    expect(toCapacityDisplay(1234, "KG")).toEqual({ value: 1234, unit: "KG" });
  });
});
