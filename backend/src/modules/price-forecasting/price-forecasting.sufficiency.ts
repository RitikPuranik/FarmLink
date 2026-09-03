import { PRICE_FORECAST_CONFIG } from "./price-forecasting.config";
import { ForecastHorizon } from "./price-forecasting.types";

// Structured reasons a forecast must report INSUFFICIENT_DATA instead of
// silently generating a low-quality (or fake) prediction — build spec:
// "Do not silently generate fake predictions."
export type InsufficiencyReason =
  | "NO_HISTORICAL_DATA"
  | "INSUFFICIENT_TOTAL_OBSERVATIONS"
  | "SPARSE_DATA_IN_WINDOW"
  | "HORIZON_EXCEEDS_LIMIT";

export interface DataSufficiencyInput {
  /** Total historical MandiPrice observations available for this crop
   *  (+ mandi, if scope is MANDI), with no date bound. */
  totalObservations: number;
  /** Historical MandiPrice observations that fall inside the specific
   *  input window a forecast run intends to use. */
  observationsInWindow: number;
  horizonDays: ForecastHorizon;
}

export interface DataSufficiencyResult {
  sufficient: boolean;
  reasons: InsufficiencyReason[];
}

/**
 * Pure domain-level check for whether a forecast may be attempted at all.
 * Does no I/O — callers resolve `totalObservations`/`observationsInWindow`
 * (e.g. via MandiPrice queries) and pass the counts in. Every reason a
 * forecast could be blocked is returned, not just the first one, so a
 * caller/UI can report the complete picture in one pass.
 */
export function checkDataSufficiency(input: DataSufficiencyInput): DataSufficiencyResult {
  const reasons: InsufficiencyReason[] = [];

  if (input.totalObservations <= 0) {
    reasons.push("NO_HISTORICAL_DATA");
  } else if (input.totalObservations < PRICE_FORECAST_CONFIG.MIN_HISTORICAL_OBSERVATIONS) {
    reasons.push("INSUFFICIENT_TOTAL_OBSERVATIONS");
  }

  // Sparseness within the window is checked independently of the total
  // count above — a crop can clear MIN_HISTORICAL_OBSERVATIONS overall
  // while still being too sparse in the specific window a forecast run
  // needs (e.g. a long history with a recent gap).
  if (
    input.totalObservations > 0 &&
    input.observationsInWindow < PRICE_FORECAST_CONFIG.MIN_OBSERVATIONS_IN_WINDOW
  ) {
    reasons.push("SPARSE_DATA_IN_WINDOW");
  }

  if (input.horizonDays > PRICE_FORECAST_CONFIG.MAX_HORIZON_DAYS) {
    reasons.push("HORIZON_EXCEEDS_LIMIT");
  }

  return { sufficient: reasons.length === 0, reasons };
}
