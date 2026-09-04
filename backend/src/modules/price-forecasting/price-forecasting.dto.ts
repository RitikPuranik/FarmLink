import { freshness } from "../market-intelligence/analytics";
import { DataFreshness } from "../market-intelligence/market-intelligence.types";
import { PRICE_FORECAST_CONFIG } from "./price-forecasting.config";
import { BaselineForecastMetadata } from "./price-forecasting.engine.types";
import { PersistedForecast } from "./price-forecasting.types";

// ---------------------------------------------------------------------------
// Module 7 Part 5 — API response contract.
//
// Everything here is presentation-layer only: pure mapping from the
// existing `PersistedForecast` (Part 1) into a stable, client-facing DTO.
// No I/O, no Prisma types, no Decimal — those boundaries are already
// crossed by PriceForecastRepository (Part 1) before anything here runs.
// ---------------------------------------------------------------------------

/** Forecasts are analytical estimates, never a guarantee — surfaced on
 *  every response regardless of status, per the build spec's explicit
 *  "do not pretend forecasts are guaranteed" requirement. */
export const FORECAST_DISCLAIMER =
  "This forecast is an analytical estimate based on available historical market data. " +
  "It is not a guaranteed future price and should not be the sole basis for a financial decision.";

/** Fixed, centralized limitations shown alongside every forecast — not
 *  fabricated per-request, just a factual summary of what the underlying
 *  deterministic baseline model (Module 7 Part 3) does and does not do. */
export const FORECAST_LIMITATIONS: readonly string[] = [
  "Produced by a deterministic statistical baseline (weighted moving average + trend), not machine learning or AI.",
  "Reflects historical mandi price patterns only — it cannot anticipate sudden market shocks, policy changes, or unreported local conditions.",
  "Covers a single target date per forecast, not a full multi-day price curve.",
  "Accuracy depends on how much recent, consistent historical data was available for the requested crop and scope.",
];

export type ForecastConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

/**
 * Bands Part 3's raw 0-1 confidence score into LOW/MEDIUM/HIGH for
 * display — a presentation-layer convenience only, never a gate on
 * whether a forecast gets generated or persisted (that stays entirely
 * Part 3's own decision). Reuses the same threshold
 * (`MIN_CONFIDENCE_THRESHOLD`) Part 1 already defined for "usable by a
 * downstream consumer," plus one additional band
 * (`HIGH_CONFIDENCE_THRESHOLD`) for the MEDIUM/HIGH split.
 */
export function classifyConfidenceLevel(score: number): ForecastConfidenceLevel {
  if (score >= PRICE_FORECAST_CONFIG.HIGH_CONFIDENCE_THRESHOLD) return "HIGH";
  if (score >= PRICE_FORECAST_CONFIG.MIN_CONFIDENCE_THRESHOLD) return "MEDIUM";
  return "LOW";
}

/** Minimal, already-resolved mandi info for embedding in a MANDI-scoped
 *  DTO — the *public* identifier only, never `Mandi.id`. Resolved once by
 *  the service layer (batched for list results, to avoid N+1 lookups —
 *  see PriceForecastingService) and passed in already-resolved rather
 *  than looked up here, keeping this mapping function pure. */
export interface ForecastMandiDTO {
  publicId: string;
  name: string;
  state: string;
  district: string;
}

export type ForecastScopeDTO =
  | { type: "MANDI"; mandi: ForecastMandiDTO }
  | { type: "REGIONAL"; state: string; district: string | null }
  | { type: "CROP_WIDE" };

export interface ForecastPredictionDTO {
  targetDate: string;
  predictedPrice: number;
  lowerBound: number | null;
  upperBound: number | null;
}

export interface ForecastConfidenceDTO {
  score: number;
  level: ForecastConfidenceLevel;
  sampleCount: number;
}

export interface ForecastMetadataDTO {
  modelProvider: string;
  modelVersion: string;
  algorithm: string | null;
  observationsUsed: number | null;
  coverageRatio: number | null;
  /** Freshness of the historical data the forecast was generated from
   *  (Module 6's `freshness()` classification applied to the prepared
   *  history's last observed date), not of the forecast row itself. Null
   *  when the underlying metadata doesn't carry a history end date (e.g.
   *  an INSUFFICIENT_DATA or FAILED forecast). */
  historyFreshness: DataFreshness | null;
  historyStartDate: string | null;
  historyEndDate: string | null;
  inputDataStartDate: string | null;
  inputDataEndDate: string | null;
  generatedAt: string | null;
  expiresAt: string | null;
}

export interface ForecastResponseDTO {
  forecastPublicId: string;
  crop: { id: string; name: string };
  scope: ForecastScopeDTO;
  status: PersistedForecast["status"];
  horizonDays: number;
  targetDate: string;
  /** Null whenever `status !== "COMPLETED"` — never a fabricated
   *  prediction for a forecast that wasn't actually generated. */
  prediction: ForecastPredictionDTO | null;
  confidence: ForecastConfidenceDTO | null;
  metadata: ForecastMetadataDTO;
  /** Present (non-empty) only when `status === "INSUFFICIENT_DATA"`. */
  insufficiencyReasons: string[];
  limitations: readonly string[];
  disclaimer: string;
  createdAt: string;
  updatedAt: string;
}

/** Loosely-typed shape of what Part 3's engine actually writes into
 *  `ForecastModelMetadata.metadata`, plus what Part 1's repository writes
 *  for the non-COMPLETED terminal statuses
 *  (`markInsufficientData`/`failForecast`). A direct cast — never
 *  client-supplied, always written by this codebase's own services —
 *  mirrors how `sell-store-orchestration.service.ts` reads
 *  `decisionMetadata` off `SellStoreDecision`. */
type RawForecastMetadata = Partial<BaselineForecastMetadata> & {
  insufficiencyReasons?: string[];
  failureReasons?: string[];
};

function scopeDTO(forecast: PersistedForecast, mandi: ForecastMandiDTO | null): ForecastScopeDTO {
  const scope = forecast.scope;
  switch (scope.type) {
    case "MANDI":
      // Should never be null in practice — Mandi rows referenced by a
      // PriceForecast can never be deleted (`onDelete: Restrict`) — but a
      // defensive fallback keeps this mapper total rather than throwing
      // on a data-integrity surprise.
      return { type: "MANDI", mandi: mandi ?? { publicId: scope.mandiId, name: "Unknown mandi", state: "", district: "" } };
    case "REGIONAL":
      return { type: "REGIONAL", state: scope.state, district: scope.district ?? null };
    case "CROP_WIDE":
      return { type: "CROP_WIDE" };
  }
}

/**
 * Maps a `PersistedForecast` (Part 1) into the stable API response shape.
 * Pure — no I/O. `crop` and `mandi` are pre-resolved by the caller (see
 * `ForecastMandiDTO`'s own comment on why).
 */
export function toForecastResponseDTO(
  forecast: PersistedForecast,
  crop: { id: string; name: string },
  mandi: ForecastMandiDTO | null,
): ForecastResponseDTO {
  const raw = (forecast.model.metadata ?? {}) as RawForecastMetadata;

  const historyEndDate = raw.historyEndDate ?? null;
  const metadata: ForecastMetadataDTO = {
    modelProvider: forecast.model.modelProvider,
    modelVersion: forecast.model.modelVersion,
    algorithm: raw.algorithm ?? null,
    observationsUsed: raw.historicalObservationCount ?? null,
    coverageRatio: raw.coverageRatio ?? null,
    historyFreshness: historyEndDate ? freshness(new Date(historyEndDate)) : null,
    historyStartDate: raw.historyStartDate ?? null,
    historyEndDate,
    inputDataStartDate: forecast.model.inputDataStartDate ? forecast.model.inputDataStartDate.toISOString().slice(0, 10) : null,
    inputDataEndDate: forecast.model.inputDataEndDate ? forecast.model.inputDataEndDate.toISOString().slice(0, 10) : null,
    generatedAt: forecast.model.generatedAt ? forecast.model.generatedAt.toISOString() : null,
    expiresAt: forecast.model.expiresAt ? forecast.model.expiresAt.toISOString() : null,
  };

  return {
    forecastPublicId: forecast.publicId,
    crop,
    scope: scopeDTO(forecast, mandi),
    status: forecast.status,
    horizonDays: forecast.horizonDays,
    targetDate: forecast.targetDate.toISOString().slice(0, 10),
    prediction:
      forecast.status === "COMPLETED" && forecast.output
        ? {
            targetDate: forecast.targetDate.toISOString().slice(0, 10),
            predictedPrice: forecast.output.predictedPrice,
            lowerBound: forecast.output.lowerBound,
            upperBound: forecast.output.upperBound,
          }
        : null,
    confidence:
      forecast.status === "COMPLETED" && forecast.confidence
        ? {
            score: forecast.confidence.score,
            level: classifyConfidenceLevel(forecast.confidence.score),
            sampleCount: forecast.confidence.sampleCount,
          }
        : null,
    metadata,
    insufficiencyReasons: forecast.status === "INSUFFICIENT_DATA" ? raw.insufficiencyReasons ?? [] : [],
    limitations: FORECAST_LIMITATIONS,
    disclaimer: FORECAST_DISCLAIMER,
    createdAt: forecast.createdAt.toISOString(),
    updatedAt: forecast.updatedAt.toISOString(),
  };
}

/**
 * Defense-in-depth sanity check over a just-generated COMPLETED forecast
 * (build spec Part 4 step 9 — "validate algorithm output"). Part 3's own
 * pure math already makes every one of these conditions true by
 * construction (rounding, `Math.max(..., 0)` floors, clamped confidence),
 * so this should never actually fire — it exists to turn a genuine
 * algorithm regression into a loud, captured failure instead of a
 * silently-served bad prediction. Never called for INSUFFICIENT_DATA/
 * FAILED/GENERATING rows, which have no output to check.
 */
export function assertGeneratedForecastIsSane(forecast: PersistedForecast, requestedHorizonDays: number): void {
  if (forecast.status !== "COMPLETED") return;

  const output = forecast.output;
  const confidence = forecast.confidence;
  if (!output || !confidence) {
    throw new Error("A COMPLETED forecast is missing its output or confidence.");
  }
  if (!Number.isFinite(output.predictedPrice) || output.predictedPrice < 0) {
    throw new Error(`Generated forecast has an invalid predictedPrice: ${output.predictedPrice}.`);
  }
  if (output.lowerBound !== null && (!Number.isFinite(output.lowerBound) || output.lowerBound < 0)) {
    throw new Error(`Generated forecast has an invalid lowerBound: ${output.lowerBound}.`);
  }
  if (output.upperBound !== null && !Number.isFinite(output.upperBound)) {
    throw new Error(`Generated forecast has an invalid upperBound: ${output.upperBound}.`);
  }
  if (output.lowerBound !== null && output.upperBound !== null && output.lowerBound > output.upperBound) {
    throw new Error(`Generated forecast has lowerBound (${output.lowerBound}) greater than upperBound (${output.upperBound}).`);
  }
  if (!Number.isFinite(confidence.score) || confidence.score < 0 || confidence.score > 1) {
    throw new Error(`Generated forecast has an invalid confidence score: ${confidence.score}.`);
  }
  if (forecast.horizonDays !== requestedHorizonDays) {
    throw new Error(
      `Generated forecast horizon (${forecast.horizonDays}) does not match the requested horizon (${requestedHorizonDays}).`,
    );
  }
}
