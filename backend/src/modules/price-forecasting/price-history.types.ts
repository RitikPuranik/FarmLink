import { ForecastHorizon, ForecastScope } from "./price-forecasting.types";
import { InsufficiencyReason } from "./price-forecasting.sufficiency";

// ---------------------------------------------------------------------------
// Module 7 Part 2 — Historical Data Preparation.
//
// Everything here describes *inputs to a future forecasting algorithm*,
// never the algorithm itself. MandiPrice remains the only place historical
// price observations live; nothing in this file is persisted anywhere —
// it is the application-contract shape PriceHistoryPreparationService
// returns after transforming raw MandiPrice rows.
// ---------------------------------------------------------------------------

/** Which MandiPrice column a prepared observation's price is derived from.
 *  Modal price is the only canonical source this part uses — see the
 *  "canonical price value" section of price-history.aggregation.ts for why
 *  no min/max fallback is implemented. A distinct (single-member today)
 *  type rather than a bare literal so a future part can extend it without
 *  every call site needing to know the string by heart. */
export type CanonicalPriceSource = "MODAL_PRICE";

/** A raw MandiPrice row as fetched from the repository, already narrowed to
 *  the columns this module needs and with Decimal converted to `number`
 *  (the same Decimal-at-the-DB-boundary-only convention `MarketIntelligenceRepository`
 *  uses). `modalPrice` stays nullable here — even though the Prisma column
 *  is non-nullable today — so partitionValidity() has something real to
 *  guard against if that ever changes, instead of silently trusting it. */
export interface RawPriceRow {
  mandiId: string;
  observedDate: Date;
  modalPrice: number | null;
}

/** A RawPriceRow that has passed partitionValidity() — modalPrice is a
 *  finite, positive number, guaranteed by construction rather than by
 *  convention. */
export interface ValidPriceRow {
  mandiId: string;
  observedDate: Date;
  modalPrice: number;
}

/** One mandi's canonical price for one calendar day, after collapsing any
 *  same-day multi-source MandiPrice rows for that mandi (see
 *  collapseByMandiDay). This is the shared intermediate shape both the
 *  MANDI-scope path (used directly) and the REGIONAL/CROP_WIDE-scope path
 *  (aggregated further, across mandis) build on. */
export interface MandiDayPrice {
  mandiId: string;
  date: Date;
  price: number;
  /** How many raw MandiPrice rows (distinct `source` values) fed this
   *  mandi-day price — 1 in the common case, >1 only when multiple source
   *  records legitimately exist for the same mandi + crop + day. */
  sourceRecordCount: number;
}

/** One point of the normalized, deterministic historical time series a
 *  future forecasting algorithm will consume. Conceptually the
 *  `PreparedPriceObservation` from the build spec. */
export interface PreparedPriceObservation {
  date: Date;
  price: number;
  /** How many underlying MandiPrice rows contributed to this date's price:
   *  source-record count for MANDI scope, reporting-mandi count for
   *  REGIONAL/CROP_WIDE scope (see price-history.aggregation.ts). Higher
   *  counts are weaker evidence of a single noisy reading. */
  observationCount: number;
  sourceScope: ForecastScope;
  /** Statistical-outlier flag only — see the outlier-policy section of the
   *  module doc. Never causes an observation to be dropped or modified. */
  isOutlier: boolean;
}

/** Deterministic gap/coverage metadata over the *requested* window
 *  (windowStart..windowEnd passed to PriceHistoryPreparationService.prepare),
 *  not just the span between the first and last observation — coverage
 *  relative to what was asked for is what a future part needs to judge
 *  forecasting confidence. */
export interface PriceHistoryGapMetadata {
  firstObservationDate: Date | null;
  lastObservationDate: Date | null;
  /** Inclusive calendar-day span of the requested window. */
  totalCalendarDays: number;
  /** Count of distinct calendar days with a prepared observation — always
   *  equal to `observations.length` since aggregation guarantees at most
   *  one observation per date. */
  observedDays: number;
  missingDays: number;
  /** observedDays / totalCalendarDays, rounded to 4 decimal places.
   *  0 when totalCalendarDays is 0. */
  coverageRatio: number;
  /** Longest run of consecutive calendar days with no observation,
   *  considering the window boundaries as well as gaps between
   *  observations (e.g. history that stops well before windowEnd counts
   *  as a gap too). 0 when there are no missing days at all. */
  largestGapDays: number;
}

/** Reasons a prepared history is not (yet) usable for forecasting. Extends
 *  (does not duplicate) Module 7 Part 1's InsufficiencyReason — see
 *  checkDataSufficiency() in price-forecasting.sufficiency.ts, which this
 *  module calls directly rather than re-implementing. */
export type PreparationInsufficiencyReason =
  | InsufficiencyReason
  | "NO_USABLE_OBSERVATIONS"
  | "COVERAGE_BELOW_MINIMUM"
  | "GAP_EXCEEDS_MAXIMUM";

/** Data-quality signals detected while preparing the series — informational
 *  metadata, distinct from (and not a gate on) `sufficient`/
 *  `insufficiencyReasons` above, though some flags and reasons describe
 *  related underlying facts from two different angles. */
export type DataQualityFlag =
  | "NO_OBSERVATIONS"
  | "DUPLICATE_SOURCE_RECORDS"
  | "MISSING_PRICE_VALUES"
  | "INVALID_NEGATIVE_PRICES"
  | "UNSORTED_SOURCE_RECORDS"
  | "SPARSE_HISTORY"
  | "LARGE_GAPS"
  | "INSUFFICIENT_OBSERVATIONS";

export interface PriceHistoryDataQuality {
  flags: DataQualityFlag[];
  /** Raw MandiPrice rows returned for the requested window, before any
   *  validity filtering or aggregation. */
  rawRecordCount: number;
  missingPriceCount: number;
  invalidNegativePriceCount: number;
  /** Number of (mandi, date) groups that required aggregating more than
   *  one source record into a single canonical price. */
  duplicateGroupCount: number;
  /** Whether the raw rows, as returned by the repository, already arrived
   *  in ascending observedDate order. Informational only — this module
   *  never relies on repository ordering; sortObservationsByDate() always
   *  re-sorts explicitly. */
  sourceRecordsWereSorted: boolean;
}

/** The complete result of preparing historical data for one crop + scope +
 *  window. Conceptually the `PreparedPriceHistory` from the build spec. */
export interface PreparedPriceHistory {
  cropId: string;
  scope: ForecastScope;
  canonicalPriceSource: CanonicalPriceSource;
  windowStartDate: Date;
  windowEndDate: Date;
  observations: PreparedPriceObservation[];
  metadata: PriceHistoryGapMetadata & { outlierCount: number };
  dataQuality: PriceHistoryDataQuality;
  sufficient: boolean;
  insufficiencyReasons: PreparationInsufficiencyReason[];
}

/** What a caller asks PriceHistoryPreparationService.prepare() for. Mirrors
 *  ForecastInput's scope/crop shape from Part 1 without requiring a full
 *  ForecastInput (preparation runs independently of — and earlier than —
 *  an actual forecast attempt). */
export interface PriceHistoryRequest {
  cropId: string;
  scope: ForecastScope;
  /** Defaults to `PRICE_FORECAST_CONFIG.DEFAULT_HISTORY_WINDOW_DAYS` before
   *  `endDate` when omitted. Always clamped so the resolved window never
   *  exceeds `PRICE_FORECAST_CONFIG.MAX_HISTORY_WINDOW_DAYS`. */
  startDate?: Date;
  /** Defaults to "today" (UTC) when omitted. */
  endDate?: Date;
  /** Forwarded to checkDataSufficiency()'s horizon check. Defaults to
   *  `PRICE_FORECAST_CONFIG.DEFAULT_HORIZON_DAYS` — preparation itself has
   *  no horizon of its own, but Part 1's sufficiency contract needs one. */
  horizonDays?: ForecastHorizon;
}

/** The date window a repository query is bounded to. */
export interface HistoryWindow {
  start: Date;
  end: Date;
}
