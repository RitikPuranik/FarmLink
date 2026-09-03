import { PriceForecastScopeType, PriceForecastStatus } from "@prisma/client";

// Re-exported so callers outside this module never need to import
// `@prisma/client` enums directly just to reference forecast status/scope —
// keeps the Prisma model as an implementation detail behind this module's
// own contracts (build spec: "do not expose Prisma models directly
// everywhere").
export { PriceForecastScopeType, PriceForecastStatus };

// ---------------------------------------------------------------------------
// ForecastScope — what a forecast is predicting a price *for*.
//
// A discriminated union rather than three optional fields (mandiId,
// regionState, regionDistrict) sitting loose on every type in this module —
// callers get exhaustive `switch (scope.type)` handling instead of having
// to remember which combination of nulls is valid. This mirrors the
// PriceForecast Prisma model's scopeType + mandiId/regionState/
// regionDistrict columns; ScopeKey.build()/parse() (scope.ts) is the single
// place that translates between the two shapes.
// ---------------------------------------------------------------------------
export type ForecastScope =
  | { type: "MANDI"; mandiId: string }
  | { type: "REGIONAL"; state: string; district?: string }
  | { type: "CROP_WIDE" };

// Number of days ahead a forecast targets. Kept as a distinct named type
// (rather than a bare `number`) so signatures like
// `ForecastInput.horizonDays` read as a domain concept, not an arbitrary
// integer — validated against PRICE_FORECAST_CONFIG.maxHorizonDays at the
// point a horizon is accepted, never inline.
export type ForecastHorizon = number;

// What a (future) forecasting run is asked to produce.
export interface ForecastInput {
  cropId: string;
  scope: ForecastScope;
  targetDate: Date;
  horizonDays: ForecastHorizon;
  // The historical window the run is expected to read from MandiPrice.
  // Populated by the caller resolving data availability, not by this
  // module — see ForecastModelMetadata for what actually got used.
  inputDataStartDate: Date;
  inputDataEndDate: Date;
}

// The predicted value itself, independent of how confident it is (see
// ForecastConfidence) or which model produced it (see
// ForecastModelMetadata). Decimal-precision monetary values are represented
// as `number` at this application-contract layer — the same boundary
// convention CropLot's unit-conversion service already uses (see that
// module's own comment) — and are only ever Decimal at the Prisma/DB layer.
export interface ForecastOutput {
  predictedPrice: number;
  lowerBound: number | null;
  upperBound: number | null;
}

// How much to trust ForecastOutput. Kept separate from ForecastOutput
// itself (never merged into one "predictedPrice + confidence" blob) for
// the same reason Module 5's QualityAssessment keeps qualityScore and
// confidenceScore apart: a prediction and how sure the system is about it
// are independent axes.
export interface ForecastConfidence {
  score: number; // 0-1
  sampleCount: number;
}

// Which model/provider/version produced a forecast, and from what data —
// this is what makes a forecast reproducible/auditable, and is exactly the
// set of columns PriceForecastRepository persists verbatim.
export interface ForecastModelMetadata {
  modelProvider: string;
  modelVersion: string;
  inputDataStartDate: Date;
  inputDataEndDate: Date;
  generatedAt: Date;
  expiresAt: Date | null;
  // Safe, technical-only metadata — never raw provider payloads or PII
  // (see PriceForecast.metadata's own comment in the Prisma schema).
  metadata?: Record<string, unknown>;
}

// A complete, persisted forecast as the rest of the application should see
// it — the application-contract shape PriceForecastRepository maps
// Prisma's `PriceForecast` rows into, so nothing outside the repository
// touches Decimal or Prisma types directly.
export interface PersistedForecast {
  id: string;
  publicId: string;
  cropId: string;
  scope: ForecastScope;
  targetDate: Date;
  horizonDays: ForecastHorizon;
  status: PriceForecastStatus;
  output: ForecastOutput | null;
  confidence: ForecastConfidence | null;
  model: ForecastModelMetadata;
  createdAt: Date;
  updatedAt: Date;
}
