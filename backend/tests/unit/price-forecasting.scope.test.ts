import {
  buildScopeKey,
  scopeFromColumns,
  scopeToColumns,
} from "../../src/modules/price-forecasting/price-forecasting.scope";
import { ForecastScope } from "../../src/modules/price-forecasting/price-forecasting.types";

describe("price forecasting scope encoding (Module 7 Part 1)", () => {
  it("builds a distinct, deterministic key per scope type", () => {
    const mandi: ForecastScope = { type: "MANDI", mandiId: "mandi-1" };
    const regional: ForecastScope = { type: "REGIONAL", state: "Maharashtra", district: "Pune" };
    const regionalNoDistrict: ForecastScope = { type: "REGIONAL", state: "Maharashtra" };
    const cropWide: ForecastScope = { type: "CROP_WIDE" };

    expect(buildScopeKey(mandi)).toBe("MANDI:mandi-1");
    expect(buildScopeKey(regional)).toBe("REGIONAL:Maharashtra:Pune");
    expect(buildScopeKey(regionalNoDistrict)).toBe("REGIONAL:Maharashtra:*");
    expect(buildScopeKey(cropWide)).toBe("CROP_WIDE");

    const keys = [buildScopeKey(mandi), buildScopeKey(regional), buildScopeKey(regionalNoDistrict), buildScopeKey(cropWide)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is deterministic — the same scope always produces the same key", () => {
    const a: ForecastScope = { type: "MANDI", mandiId: "mandi-42" };
    const b: ForecastScope = { type: "MANDI", mandiId: "mandi-42" };
    expect(buildScopeKey(a)).toBe(buildScopeKey(b));
  });

  it("two different CROP_WIDE-scoped forecasts collapse to the identical key (the case a nullable mandiId alone cannot prevent)", () => {
    const first: ForecastScope = { type: "CROP_WIDE" };
    const second: ForecastScope = { type: "CROP_WIDE" };
    expect(buildScopeKey(first)).toEqual(buildScopeKey(second));
  });

  it("round-trips scope -> columns -> scope for every scope type", () => {
    const scopes: ForecastScope[] = [
      { type: "MANDI", mandiId: "mandi-1" },
      { type: "REGIONAL", state: "Maharashtra", district: "Pune" },
      { type: "REGIONAL", state: "Maharashtra" },
      { type: "CROP_WIDE" },
    ];

    for (const scope of scopes) {
      const columns = scopeToColumns(scope);
      const roundTripped = scopeFromColumns(columns);
      expect(roundTripped).toEqual(scope.type === "REGIONAL" && !scope.district ? { ...scope, district: undefined } : scope);
    }
  });

  it("scopeToColumns nulls out the fields that don't apply to the given scope type", () => {
    expect(scopeToColumns({ type: "MANDI", mandiId: "mandi-1" })).toEqual({
      scopeType: "MANDI",
      mandiId: "mandi-1",
      regionState: null,
      regionDistrict: null,
    });
    expect(scopeToColumns({ type: "CROP_WIDE" })).toEqual({
      scopeType: "CROP_WIDE",
      mandiId: null,
      regionState: null,
      regionDistrict: null,
    });
  });

  it("scopeFromColumns throws on internally inconsistent rows rather than guessing", () => {
    expect(() =>
      scopeFromColumns({ scopeType: "MANDI", mandiId: null, regionState: null, regionDistrict: null }),
    ).toThrow();
    expect(() =>
      scopeFromColumns({ scopeType: "REGIONAL", mandiId: null, regionState: null, regionDistrict: null }),
    ).toThrow();
  });
});
