// Module 7 Part 3 — pure math for the deterministic baseline forecasting
// algorithm. Nothing in this file does I/O, reads configuration, or knows
// about PreparedPriceHistory/PriceForecast at all — every function takes
// plain numbers (or arrays of them) and returns plain numbers, the same
// "keep transformations pure and independently testable" rule Part 2's
// price-history.aggregation.ts follows. price-forecasting.engine.ts is the
// only caller — it supplies PRICE_FORECAST_CONFIG values as ordinary
// function arguments rather than this file reaching for config itself.
//
// Per the build spec's rounding rule (section 14): nothing here rounds.
// Full precision is kept through every calculation; price-forecasting.engine.ts
// rounds once, at the point it builds the persisted ForecastOutput/metadata.

// ── Weighted moving average ─────────────────────────────────────────────

/**
 * Rank-weighted average of a price series, oldest first. The oldest price
 * gets weight 1, the next weight 2, ... the newest gets weight n — so
 * "recent observations receive greater weight" (build spec section 5)
 * without needing to know actual day-gaps between points, which makes
 * this safe to use directly on an irregularly-spaced series (Part 2 never
 * fills gaps, so a "daily" series can have missing days).
 *
 * Zero-safe: an empty input returns 0 rather than dividing by zero. The
 * engine is expected never to call this with no observations (Part 1/2's
 * sufficiency checks should already have blocked that), but a pure
 * function should not throw on a degenerate input a caller could
 * construct by mistake.
 */
export function weightedMovingAverage(pricesOldestToNewest: number[]): number {
  const n = pricesOldestToNewest.length;
  if (n === 0) return 0;

  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < n; i++) {
    const weight = i + 1; // oldest = 1 ... newest = n, i.e. already normalized by construction
    weightedSum += pricesOldestToNewest[i] * weight;
    weightTotal += weight;
  }
  // weightTotal === n*(n+1)/2, which is >= 1 whenever n >= 1 — never zero here.
  return weightedSum / weightTotal;
}

// ── Trend: ordinary least squares linear regression ────────────────────

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
}

/**
 * Ordinary least squares fit over (x, y) pairs. Callers pass `x` as a
 * day-offset from the window's first observation (not an array index) so
 * the fitted slope is genuinely "price change per calendar day" even
 * across an irregularly-spaced series — build spec section 6's "actual
 * day offset" option.
 *
 * Degenerate inputs never throw: fewer than two points, or every point
 * sharing the same `x` (a zero-variance denominator), have no meaningful
 * slope, so both return `slope: 0` with a sensible intercept instead of
 * NaN/Infinity.
 */
export function linearRegression(points: { x: number; y: number }[]): LinearRegressionResult {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: points[0].y };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    // Every x identical (e.g. duplicate day-offsets) — no slope information.
    return { slope: 0, intercept: sumY / n };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * Classifies a daily trend slope as UP / DOWN / FLAT, relative to the
 * baseline price rather than as a raw currency amount — a ₹0.50/day slope
 * is noise on a ₹5,000 baseline but meaningful on a ₹20 one.
 * `flatThresholdRatio` is the daily-slope-as-fraction-of-baseline cutoff
 * below which the trend is reported FLAT, keeping tiny numerical noise
 * from being reported as a directional signal (build spec section 6).
 *
 * A non-positive baseline (should not occur — Part 2 only ever admits
 * positive modal prices) is treated as FLAT rather than dividing by zero
 * or a negative number.
 */
export function trendDirection(
  dailySlope: number,
  baselinePrice: number,
  flatThresholdRatio: number,
): "UP" | "DOWN" | "FLAT" {
  if (baselinePrice <= 0) return "FLAT";
  const relativeDailySlope = dailySlope / baselinePrice;
  if (relativeDailySlope > flatThresholdRatio) return "UP";
  if (relativeDailySlope < -flatThresholdRatio) return "DOWN";
  return "FLAT";
}

// ── Dispersion (uncertainty basis) ──────────────────────────────────────

/**
 * Population standard deviation of a value series — the same formula
 * `market-intelligence/analytics.ts`'s `volatility()` uses internally,
 * kept here as its own pure, directly-testable function rather than
 * re-deriving it inline. Zero-safe for 0 or 1 values (no variance to
 * speak of), returning 0 rather than NaN.
 */
export function standardDeviation(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

// ── Conservative trend projection safeguards (build spec section 7) ────

/**
 * How much a trend's daily slope is discounted as the forecast horizon
 * grows — 1.0 at horizon 0, approaching (but never reaching) 0 as horizon
 * grows, via a simple half-life curve: at `horizonDays === halfLifeDays`
 * the factor is exactly 0.5. Reused for both trend-projection damping and
 * confidence horizon-decay (different half-life values, same shape) —
 * see price-forecasting.engine.ts.
 *
 * `halfLifeDays <= 0` is a configuration error, not a runtime condition
 * to divide-by-zero on — treated as "no damping" (factor 1) rather than
 * throwing.
 */
export function trendDampingFactor(horizonDays: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 1;
  return 1 / (1 + horizonDays / halfLifeDays);
}

/**
 * Caps a raw daily trend slope to at most `maxDailyAdjustmentRatio` of the
 * baseline price per day — the first of the two independent safeguards
 * `projectForecast` applies (the second is the total-movement cap on the
 * projected adjustment itself). Applied *before* horizon damping, so a
 * single very steep day-to-day slope can never dominate the projection
 * regardless of how short the horizon is.
 */
export function clampDailySlope(dailySlope: number, baselinePrice: number, maxDailyAdjustmentRatio: number): number {
  const cap = Math.abs(baselinePrice) * maxDailyAdjustmentRatio;
  if (dailySlope > cap) return cap;
  if (dailySlope < -cap) return -cap;
  return dailySlope;
}

export interface TrendProjectionConfig {
  /** See clampDailySlope. */
  maxDailyTrendAdjustmentRatio: number;
  /** See trendDampingFactor. */
  trendDampingHalfLifeDays: number;
  /** Hard ceiling on the total trend-driven movement away from the
   *  baseline, as a fraction of the baseline price — applied after
   *  damping, regardless of horizon. */
  maxProjectionPercent: number;
}

export interface TrendProjectionResult {
  trendAdjustment: number;
  predictedPrice: number;
}

/**
 * Combines the baseline (weighted moving average) with a conservatively
 * projected trend to produce a point prediction:
 *
 *   forecast = weightedMovingAverage + (dampedTrendSlope × horizon)
 *
 * as the build spec (section 7) describes, with three safeguards against
 * unrealistic extrapolation, applied in order:
 *   1. the raw daily slope is capped (clampDailySlope)
 *   2. the capped slope is damped by how long the horizon is
 *      (trendDampingFactor) before being multiplied out over the horizon
 *   3. the resulting total adjustment is capped to maxProjectionPercent of
 *      the baseline, regardless of horizon or how steep the damped slope
 *      still is
 *
 * `predictedPrice` is never allowed to go non-positive; `trendAdjustment`
 * is always reported as `predictedPrice - baselinePrice` (recomputed
 * *after* that floor), so the two fields stay internally consistent even
 * in the (extreme, floor-triggering) edge case.
 */
export function projectForecast(
  baselinePrice: number,
  dailySlope: number,
  horizonDays: number,
  config: TrendProjectionConfig,
): TrendProjectionResult {
  const cappedDailySlope = clampDailySlope(dailySlope, baselinePrice, config.maxDailyTrendAdjustmentRatio);
  const damping = trendDampingFactor(horizonDays, config.trendDampingHalfLifeDays);
  const rawAdjustment = cappedDailySlope * damping * horizonDays;

  const maxAdjustment = Math.abs(baselinePrice) * config.maxProjectionPercent;
  const boundedAdjustment = Math.min(Math.max(rawAdjustment, -maxAdjustment), maxAdjustment);

  const predictedPrice = Math.max(baselinePrice + boundedAdjustment, 0);
  const trendAdjustment = predictedPrice - baselinePrice;

  return { trendAdjustment, predictedPrice };
}

// ── Uncertainty range (build spec section 8) ────────────────────────────

export interface UncertaintyRangeConfig {
  /** Multiplies the horizon-scaled dispersion to produce the interval
   *  half-width. */
  uncertaintyMultiplier: number;
  /** Floor on the half-width, as a fraction of the predicted price, so a
   *  run of unusually stable recent prices never produces a suspiciously
   *  narrow (falsely precise) interval. */
  minUncertaintyRatio: number;
}

export interface UncertaintyRangeResult {
  lowerBound: number;
  upperBound: number;
}

/**
 * Derives a deterministic uncertainty range from historical price
 * dispersion, scaled by the forecast horizon. Horizon scaling uses
 * √horizonDays — the standard random-walk convention that variance grows
 * linearly with time (so standard deviation, and therefore this interval,
 * grows with its square root) — which is explainable without claiming a
 * precise statistical confidence level the baseline model can't actually
 * support (build spec: "do not claim statistical certainty that isn't
 * supported").
 *
 * `lowerBound` is always clamped at 0, and the half-width is always >= 0,
 * so `lowerBound <= predictedPrice <= upperBound` holds by construction.
 */
export function computeUncertaintyRange(
  predictedPrice: number,
  dispersion: number,
  horizonDays: number,
  config: UncertaintyRangeConfig,
): UncertaintyRangeResult {
  const horizonScaledDispersion = dispersion * Math.sqrt(Math.max(horizonDays, 1));
  const minWidth = Math.abs(predictedPrice) * config.minUncertaintyRatio;
  const halfWidth = Math.max(horizonScaledDispersion * config.uncertaintyMultiplier, minWidth);

  return {
    lowerBound: Math.max(predictedPrice - halfWidth, 0),
    upperBound: predictedPrice + halfWidth,
  };
}
