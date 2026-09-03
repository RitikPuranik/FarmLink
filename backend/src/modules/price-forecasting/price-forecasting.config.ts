/**
 * Centralized configuration for price forecasting. No forecasting
 * algorithm reads these yet (Part 1 is foundation-only) — this exists now
 * so future parts never hardcode these numbers inline, the same rationale
 * as sell-store-decision-engine.config.ts.
 *
 * Values are deliberately conservative defaults, not tuned against real
 * data yet.
 */
export const PRICE_FORECAST_CONFIG = {
  // ── Data sufficiency ───────────────────────────────────────────────
  /** Fewest historical MandiPrice observations required before a forecast
   *  can be attempted at all, regardless of scope. */
  MIN_HISTORICAL_OBSERVATIONS: 30,

  /** Below this many observations *within the requested input window*,
   *  data is considered too sparse to trust even if
   *  MIN_HISTORICAL_OBSERVATIONS is technically met overall. */
  MIN_OBSERVATIONS_IN_WINDOW: 14,

  // ── Horizon ─────────────────────────────────────────────────────────
  /** Default forecast horizon when a caller doesn't specify one. */
  DEFAULT_HORIZON_DAYS: 7,

  /** Longest horizon this module will ever accept a forecast request for.
   *  Requests beyond this must be rejected before any generation attempt
   *  (build spec: "requested horizon exceeds configured limits"). */
  MAX_HORIZON_DAYS: 30,

  // ── Freshness ───────────────────────────────────────────────────────
  /** How long a COMPLETED forecast is considered valid/"fresh" after
   *  generation, in hours. Used to compute PriceForecast.expiresAt and by
   *  PriceForecastRepository.findLatestValid to exclude stale rows. */
  FRESHNESS_DURATION_HOURS: 24,

  // ── Confidence ──────────────────────────────────────────────────────
  /** Minimum confidence score (0-1) a forecast must carry to be treated as
   *  usable by any future downstream consumer (e.g. Sell vs Store). Below
   *  this, a forecast should still be persisted (for audit purposes) but
   *  never surfaced as an actionable prediction. */
  MIN_CONFIDENCE_THRESHOLD: 0.3,

  // ── Historical data preparation (Module 7 Part 2) ─────────────────────
  /** Default lookback window, in calendar days (inclusive of the end
   *  date), PriceHistoryPreparationService fetches when a caller doesn't
   *  supply an explicit startDate. */
  DEFAULT_HISTORY_WINDOW_DAYS: 180,

  /** Hard ceiling on how far back a single historical query may reach,
   *  regardless of what a caller requests — enforced before any query is
   *  issued, so this module never "load[s] all historical prices forever"
   *  (build spec, performance section). A wider caller-supplied window is
   *  clamped to this many days, not rejected. */
  MAX_HISTORY_WINDOW_DAYS: 730,

  /** Below this ratio of observed-to-calendar days within the requested
   *  window, a prepared history is flagged both as SPARSE_HISTORY (data
   *  quality metadata) and COVERAGE_BELOW_MINIMUM (insufficiency reason). */
  MIN_COVERAGE_RATIO: 0.5,

  /** Longest consecutive run of calendar days with no observation this
   *  module will tolerate before flagging LARGE_GAPS / GAP_EXCEEDS_MAXIMUM.
   *  Gaps are always reported, never filled or interpolated. */
  MAX_ACCEPTABLE_GAP_DAYS: 21,

  /** Master toggle for statistical outlier flagging. Outliers are always
   *  metadata-only (PreparedPriceObservation.isOutlier) — this never
   *  removes, modifies, or excludes a MandiPrice-derived observation. */
  OUTLIER_DETECTION_ENABLED: true,

  /** Which conservative method flags outliers when the toggle above is on.
   *  "IQR" = Tukey fences on the interquartile range; "MAD" = median
   *  absolute deviation (modified z-score). */
  OUTLIER_METHOD: "IQR" as "IQR" | "MAD",

  /** Tukey fence multiplier for the IQR method — 1.5 is the conventional
   *  "mild outlier" threshold. */
  OUTLIER_IQR_MULTIPLIER: 1.5,

  /** Modified z-score threshold for the MAD method — 3.5 is the commonly
   *  cited conservative threshold (Iglewicz & Hoaglin, 1993). */
  OUTLIER_MAD_THRESHOLD: 3.5,

  /** Outlier detection needs enough points for quartiles/MAD to be
   *  meaningful — below this many observations, every point is left
   *  unflagged rather than risk false positives on a handful of prices. */
  OUTLIER_MIN_SAMPLE_SIZE: 5,
} as const;
