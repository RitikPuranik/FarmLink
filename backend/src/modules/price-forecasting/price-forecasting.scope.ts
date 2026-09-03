import { PriceForecastScopeType } from "@prisma/client";
import { ForecastScope } from "./price-forecasting.types";

// Sentinel for "no district" inside a REGIONAL scope key — chosen because
// it can never collide with a real district name (District.name is
// human-entered free text with no reserved characters convention, but a
// bare "*" is not a plausible district name in the seeded reference data).
const REGIONAL_NO_DISTRICT = "*";

/**
 * Builds the deterministic, NULL-free string PriceForecast.scopeKey stores
 * and the unique index is keyed on. See that column's comment in
 * schema.prisma for why a plain nullable mandiId/regionState/
 * regionDistrict cannot enforce idempotency by itself.
 *
 * Same scope in -> same key out, always — this function has no side
 * effects and does no I/O, so it is safe to call before *and* after
 * persistence to check "does an equivalent forecast already exist".
 */
export function buildScopeKey(scope: ForecastScope): string {
  switch (scope.type) {
    case "MANDI":
      return `MANDI:${scope.mandiId}`;
    case "REGIONAL":
      return `REGIONAL:${scope.state}:${scope.district ?? REGIONAL_NO_DISTRICT}`;
    case "CROP_WIDE":
      return "CROP_WIDE";
  }
}

/** The Prisma enum value a given scope maps to. */
export function scopeTypeOf(scope: ForecastScope): PriceForecastScopeType {
  return scope.type;
}

/**
 * The inverse of the scopeType + mandiId/regionState/regionDistrict columns
 * a PriceForecast row is stored with — used by the repository to rebuild a
 * `ForecastScope` from a fetched row without leaking those raw columns past
 * the repository boundary. Throws on a row whose columns don't match its
 * own scopeType, which would indicate corrupted data rather than a normal
 * runtime condition.
 */
export function scopeFromColumns(row: {
  scopeType: PriceForecastScopeType;
  mandiId: string | null;
  regionState: string | null;
  regionDistrict: string | null;
}): ForecastScope {
  switch (row.scopeType) {
    case "MANDI":
      if (!row.mandiId) throw new Error("MANDI-scoped forecast row is missing mandiId.");
      return { type: "MANDI", mandiId: row.mandiId };
    case "REGIONAL":
      if (!row.regionState) throw new Error("REGIONAL-scoped forecast row is missing regionState.");
      return { type: "REGIONAL", state: row.regionState, district: row.regionDistrict ?? undefined };
    case "CROP_WIDE":
      return { type: "CROP_WIDE" };
    default:
      throw new Error(`Unknown PriceForecastScopeType: ${String(row.scopeType)}`);
  }
}

/** The scopeType/mandiId/regionState/regionDistrict columns to persist for a given scope. */
export function scopeToColumns(scope: ForecastScope): {
  scopeType: PriceForecastScopeType;
  mandiId: string | null;
  regionState: string | null;
  regionDistrict: string | null;
} {
  switch (scope.type) {
    case "MANDI":
      return { scopeType: "MANDI", mandiId: scope.mandiId, regionState: null, regionDistrict: null };
    case "REGIONAL":
      return {
        scopeType: "REGIONAL",
        mandiId: null,
        regionState: scope.state,
        regionDistrict: scope.district ?? null,
      };
    case "CROP_WIDE":
      return { scopeType: "CROP_WIDE", mandiId: null, regionState: null, regionDistrict: null };
  }
}
