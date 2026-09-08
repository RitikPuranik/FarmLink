import { normalizeRegistrationNumber, validateRegistrationNumber } from "../../src/modules/transporters/vehicle-registration";

describe("normalizeRegistrationNumber", () => {
  it("uppercases the input", () => {
    expect(normalizeRegistrationNumber("mh12ab1234")).toBe("MH12AB1234");
  });

  it("removes hyphens", () => {
    expect(normalizeRegistrationNumber("MH-12-AB-1234")).toBe("MH12AB1234");
  });

  it("removes whitespace", () => {
    expect(normalizeRegistrationNumber("MH 12 AB 1234")).toBe("MH12AB1234");
  });

  it("treats different formatting of the same plate as identical", () => {
    const variants = ["MH12AB1234", "MH-12-AB-1234", "mh12ab1234", "MH 12 AB 1234", "  mh-12 ab-1234  "];
    const normalized = variants.map(normalizeRegistrationNumber);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("MH12AB1234");
  });

  it("is idempotent", () => {
    const once = normalizeRegistrationNumber("MH-12-AB-1234");
    const twice = normalizeRegistrationNumber(once);
    expect(twice).toBe(once);
  });

  it("is deterministic across repeated calls", () => {
    const results = new Set(Array.from({ length: 5 }, () => normalizeRegistrationNumber("mh-12-ab-1234")));
    expect(results.size).toBe(1);
  });
});

describe("validateRegistrationNumber", () => {
  it("accepts a plausible plate", () => {
    const result = validateRegistrationNumber("MH-12-AB-1234");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("MH12AB1234");
  });

  it("rejects a too-short value", () => {
    expect(validateRegistrationNumber("AB1").valid).toBe(false);
  });

  it("rejects a too-long value", () => {
    expect(validateRegistrationNumber("ABCDEFGHIJKLMNOP1234").valid).toBe(false);
  });

  it("rejects values with disallowed characters", () => {
    expect(validateRegistrationNumber("MH12@B1234").valid).toBe(false);
  });
});
