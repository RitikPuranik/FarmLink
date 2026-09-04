import { ForecastConfidence, ForecastOutput } from "./price-forecasting.types";
import { PreparationInsufficiencyReason } from "./price-history.types";

// ---------------------------------------------------------------------------
// Module 7 Part 3 — Deterministic Baseline Price Forecast Engine.
//
// Everything here is the *engine's own* output contract — separate from
// (and never redefining) price-forecasting.types.ts's ForecastOutput /
// ForecastConfidence / ForecastModelMetadata, which the engine populates.
// See price-forecasting.engine.ts for the pure algorithm that produces
// this, and price-forecast-generation.service.ts for the orchestration
// layer that persists it via the existing PriceForecastRepository.
// ---------------------------------------------------------------------------

/**
 * (modelProvider, modelVersion) persisted on every forecast this engine
 * produces — together with (cropId, scopeKey, targetDate) this is exactly
 * PriceForecastRepository's idempotency key
 * (`@@unique([cropId, scopeKey, targetDate, modelVersion])`). A distinct,
 * versioned algorithm string — rather than a bare "v1" — so a future,
 * more advanced model can be introduced under its own modelVersion
 * without colliding with or silently overwriting this baseline's
 * forecasts.
 */
export const BASELINE_MODEL_PROVIDER = "FARMLINK_BASELINE_ENGINE";
export const BASELINE_MODEL_VERSION = "WEIGHTED_MOVING_AVERAGE_TREND_V1";

/** How the (capped, damped) recent-window regression slope classifies —
 *  see `PRICE_FORECAST_CONFIG.TREND_FLAT_THRESHOLD_RATIO` for the
 *  noise-vs-signal cutoff `trendDirection()` (price-forecasting.math.ts)
 *  applies. */
export type TrendDirection = "UP" | "DOWN" | "FLAT";

/**
 * Whether Part 2's statistically-flagged outliers (`isOutlier` metadata)
 * were excluded from this forecast's calculations, or — because too few
 * non-outlier observations remained — included as a safe fallback. See
 * the module doc's "Part 3 — outlier policy" section for the full
 * rationale; never a signal that any observation was deleted or mutated
 * (Part 2's data is read-only to this part too).
 */
export type OutlierPolicyOutcome = "EXCLUDED" | "INCLUDED_FALLBACK";

/**
 * Every configuration value that actually shaped this specific forecast,
 * captured at generation time — so a forecast stays explainable later
 * even if `PRICE_FORECAST_CONFIG`'s defaults are subsequently retuned
 * (build spec section 12: "explainable later without recomputing the
 * algorithm").
 */
export interface BaselineForecastConfigurationSnapshot {
  movingAverageWindowSize: number;
  minObservationsForTrend: number;
  trendFlatThresholdRatio: number;
  maxDailyTrendAdjustmentRatio: number;
  trendDampingHalfLifeDays: number;
  maxProjectionPercent: number;
  uncertaintyMultiplier: number;
  uncertaintyHorizonScaling: "SQRT_HORIZON_DAYS";
  minUncertaintyRatio: number;
  confidenceHorizonDecayHalfLifeDays: number;
}

/**
 * Explainability metadata persisted verbatim into
 * `ForecastModelMetadata.metadata` (a sanitized `Json` column, never raw
 * provider payloads or PII per that field's own contract) — enough to
 * understand *why* a forecast came out the way it did without
 * recomputing the algorithm or re-reading `MandiPrice` (build spec
 * section 12). Dates are ISO calendar-day strings, not `Date` objects —
 * that is what a `Json` column actually round-trips, and this module
 * never relies on implicit Date-to-JSON coercion.
 */
export interface BaselineForecastMetadata {
  algorithm: typeof BASELINE_MODEL_VERSION;
  historicalObservationCount: number;
  historyStartDate: string;
  historyEndDate: string;
  baselinePrice: number;
  trendSlope: number;
  trendDirection: TrendDirection;
  trendAdjustment: number;
  uncertaintyMethod: "HISTORICAL_STD_DEV_SQRT_HORIZON";
  outlierCount: number;
  outlierPolicy: OutlierPolicyOutcome;
  /** Part 2's own coverage ratio for the *requested* history window
   *  (`PreparedPriceHistory.metadata.coverageRatio`), carried through
   *  verbatim rather than recomputed — surfaced so a consumer (Part 5's
   *  API layer) can report data-coverage without re-reading `MandiPrice`.
   *  Added alongside the rest of this metadata (not a new calculation —
   *  the confidence computation already used this value internally, this
   *  just also persists it). */
  coverageRatio: number;
  configuration: BaselineForecastConfigurationSnapshot;
}

/** A forecast the engine successfully generated. */
export interface BaselineForecastGenerated {
  outcome: "GENERATED";
  output: ForecastOutput;
  confidence: ForecastConfidence;
  modelMetadata: BaselineForecastMetadata;
}

/**
 * The engine declined to generate a forecast — a normal, structured
 * domain outcome, never an exception (build spec section 9:
 * "INSUFFICIENT_DATA is a valid domain outcome"). `reasons` is always
 * Part 1/2's own `PreparationInsufficiencyReason` list — this part adds
 * no new insufficiency reasons of its own, it only acts on the ones
 * `PreparedPriceHistory.sufficient`/`insufficiencyReasons` already
 * computed.
 */
export interface BaselineForecastInsufficientData {
  outcome: "INSUFFICIENT_DATA";
  reasons: PreparationInsufficiencyReason[];
}

export type BaselineForecastResult = BaselineForecastGenerated | BaselineForecastInsufficientData;
