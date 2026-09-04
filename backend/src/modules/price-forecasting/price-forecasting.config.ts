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
   *  never surfaced as an actionable prediction. Also the LOW/MEDIUM
   *  boundary the API layer's confidence-level classification uses (Part
   *  5) — see HIGH_CONFIDENCE_THRESHOLD for the MEDIUM/HIGH boundary. */
  MIN_CONFIDENCE_THRESHOLD: 0.3,

  /** Confidence score (0-1) at or above which the API layer classifies a
   *  forecast's confidence as HIGH rather than MEDIUM (Part 5) — purely a
   *  presentation-layer banding on top of the score Part 3 already
   *  computes, never a gate on generation itself. */
  HIGH_CONFIDENCE_THRESHOLD: 0.7,

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

  // ── Baseline forecasting algorithm (Module 7 Part 3) ────────────────
  /** How many of the most recent usable observations feed the weighted
   *  moving average baseline and the trend regression — the algorithm's
   *  Step 1/2/3 (see price-forecasting.engine.ts) all share this one
   *  window rather than each picking a different lookback. */
  MOVING_AVERAGE_WINDOW_SIZE: 14,

  /** Fewest observations *within the selected window* needed before a
   *  trend slope is fit at all — below this, trend is treated as
   *  FLAT/zero rather than fitting a regression line through noise. Also
   *  what the outlier policy below checks before deciding whether
   *  excluding flagged outliers still leaves enough points to trust. */
  MIN_OBSERVATIONS_FOR_TREND: 5,

  /** Daily trend slope, as a fraction of the baseline price, below which
   *  the trend is classified FLAT rather than UP/DOWN — keeps tiny
   *  numerical noise from being reported as a directional signal. */
  TREND_FLAT_THRESHOLD_RATIO: 0.0005,

  /** Hard cap on the *raw* daily trend slope, as a fraction of the
   *  baseline price, applied before horizon damping — the first of two
   *  independent safeguards (paired with MAX_PROJECTION_PERCENT) against
   *  unrealistic extrapolation from a single steep day-to-day move. */
  MAX_DAILY_TREND_ADJUSTMENT_RATIO: 0.01,

  /** Half-life (in days) of the damping applied to the trend's
   *  contribution as the forecast horizon grows — the longer the
   *  horizon, the more conservative the trend projection becomes (build
   *  spec section 7). At `horizonDays === this value`, the daily slope's
   *  effective contribution is discounted by half. */
  TREND_DAMPING_HALF_LIFE_DAYS: 7,

  /** Hard ceiling on how far the (capped, damped) trend projection may
   *  move the predicted price away from the baseline, as a fraction of
   *  the baseline price — applies regardless of horizon. */
  MAX_PROJECTION_PERCENT: 0.25,

  /** Multiplies the horizon-scaled historical dispersion (standard
   *  deviation of the same recent window the baseline/trend use) to
   *  produce the uncertainty half-width. */
  UNCERTAINTY_MULTIPLIER: 1.5,

  /** Floor on the uncertainty half-width, as a fraction of the predicted
   *  price, so a forecast never reports a suspiciously narrow (falsely
   *  precise) interval even after an unusually stable recent window. */
  MIN_UNCERTAINTY_RATIO: 0.02,

  /** Half-life (in days) of the horizon-based confidence decay — mirrors
   *  TREND_DAMPING_HALF_LIFE_DAYS's shape but kept as an independent
   *  knob, since "how fast the trend projection gets conservative" and
   *  "how fast confidence drops with horizon" are separate judgment
   *  calls. */
  CONFIDENCE_HORIZON_DECAY_HALF_LIFE_DAYS: 14,
} as const;
