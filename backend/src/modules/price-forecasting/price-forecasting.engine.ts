import { round } from "../market-intelligence/analytics";
import { PRICE_FORECAST_CONFIG } from "./price-forecasting.config";
import { diffDays } from "./price-history.aggregation";
import { ForecastHorizon } from "./price-forecasting.types";
import { PreparedPriceHistory, PreparedPriceObservation } from "./price-history.types";
import {
  computeUncertaintyRange,
  linearRegression,
  projectForecast,
  standardDeviation,
  trendDampingFactor,
  trendDirection,
  weightedMovingAverage,
} from "./price-forecasting.math";
import {
  BASELINE_MODEL_VERSION,
  BaselineForecastMetadata,
  BaselineForecastResult,
} from "./price-forecasting.engine.types";

/**
 * Module 7 Part 3 — pure, deterministic baseline forecast engine.
 *
 * Input:  PreparedPriceHistory (Part 2's output) + a forecast horizon
 * Output: BaselineForecastResult (either a generated forecast or a
 *         structured INSUFFICIENT_DATA outcome)
 *
 * Design principles (mirrors DecisionEngineService's own, Module 8):
 * 1. Identical inputs always produce identical outputs — no randomness,
 *    no clock reads, no I/O of any kind.
 * 2. Every calculation is a call into a pure function from
 *    price-forecasting.math.ts; this class's own job is to select the
 *    right observations, thread them through those functions in order,
 *    and shape the result — no math happens inline here that isn't
 *    already covered by an independently-tested math.ts function.
 * 3. Insufficient/degenerate input never throws — it returns a
 *    structured INSUFFICIENT_DATA outcome instead (build spec section 9).
 *
 * This is NOT machine learning, an LLM, or a statistical forecasting
 * library (ARIMA/Prophet/etc) — see the module doc for the full list of
 * what is explicitly out of scope.
 */
export class BaselineForecastEngine {
  generate(history: PreparedPriceHistory, horizonDays: ForecastHorizon): BaselineForecastResult {
    const cfg = PRICE_FORECAST_CONFIG;

    // ── 1. Sufficiency gate ──────────────────────────────────────────
    // Reused verbatim from Part 1/2 (checkDataSufficiency, called inside
    // PriceHistoryPreparationService.prepare) — this engine adds no
    // insufficiency reasons of its own, it only acts on what Part 1/2
    // already decided. The observations-empty check is defense-in-depth:
    // `sufficient: true` should already guarantee a non-empty series, but
    // a pure function should not trust that blindly.
    if (!history.sufficient || history.observations.length === 0) {
      return {
        outcome: "INSUFFICIENT_DATA",
        reasons: history.insufficiencyReasons.length ? history.insufficiencyReasons : ["NO_HISTORICAL_DATA"],
      };
    }

    // ── 2. Outlier policy ────────────────────────────────────────────
    // Prefer excluding Part 2's statistically-flagged outliers from
    // every calculation this engine performs (baseline, trend,
    // dispersion) — but only when enough non-outlier observations remain
    // to still fit a meaningful trend; otherwise fall back to the full
    // valid series rather than starve the model of data (build spec
    // section 10). No observation is ever removed from `history` itself
    // — this only decides which subset *this forecast* is computed from.
    const nonOutliers = history.observations.filter((o) => !o.isOutlier);
    const excludeOutliers = nonOutliers.length >= cfg.MIN_OBSERVATIONS_FOR_TREND;
    const usable: PreparedPriceObservation[] = excludeOutliers ? nonOutliers : history.observations;

    if (usable.length === 0) {
      // Only reachable if every observation is flagged an outlier *and*
      // the fallback branch above was somehow also empty — i.e. never,
      // given history.observations.length > 0 was already checked above.
      // Kept as a structured outcome rather than an assumption.
      return { outcome: "INSUFFICIENT_DATA", reasons: ["NO_USABLE_OBSERVATIONS"] };
    }

    // ── 3. Step 1 — most recent window of usable observations ────────
    // Shared basis for the weighted moving average (Step 2) and the
    // trend regression (Step 3) — the build spec describes both as
    // operating on the same "most recent observations" (section 2).
    const windowSize = Math.min(cfg.MOVING_AVERAGE_WINDOW_SIZE, usable.length);
    const recentWindow = usable.slice(usable.length - windowSize);
    const prices = recentWindow.map((o) => o.price);

    // ── 4. Step 2 — weighted moving average baseline ──────────────────
    const baselinePrice = weightedMovingAverage(prices);

    // ── 5. Step 3 — trend slope (only when meaningful) ────────────────
    let dailySlope = 0;
    if (recentWindow.length >= cfg.MIN_OBSERVATIONS_FOR_TREND) {
      const firstDate = recentWindow[0].date;
      const regressionPoints = recentWindow.map((o) => ({ x: diffDays(firstDate, o.date), y: o.price }));
      dailySlope = linearRegression(regressionPoints).slope;
    }
    const direction = trendDirection(dailySlope, baselinePrice, cfg.TREND_FLAT_THRESHOLD_RATIO);

    // ── 6. Steps 4/5 — conservative, damped, capped trend projection ─
    const { trendAdjustment, predictedPrice } = projectForecast(baselinePrice, dailySlope, horizonDays, {
      maxDailyTrendAdjustmentRatio: cfg.MAX_DAILY_TREND_ADJUSTMENT_RATIO,
      trendDampingHalfLifeDays: cfg.TREND_DAMPING_HALF_LIFE_DAYS,
      maxProjectionPercent: cfg.MAX_PROJECTION_PERCENT,
    });

    // ── 7. Uncertainty range ──────────────────────────────────────────
    // Dispersion of the *same* recent window the baseline/trend were
    // built from — a forecast's stated uncertainty reflects the same
    // evidence its point prediction used, rather than a different
    // (possibly inconsistent) lookback.
    const dispersion = standardDeviation(prices);
    const { lowerBound, upperBound } = computeUncertaintyRange(predictedPrice, dispersion, horizonDays, {
      uncertaintyMultiplier: cfg.UNCERTAINTY_MULTIPLIER,
      minUncertaintyRatio: cfg.MIN_UNCERTAINTY_RATIO,
    });

    // ── 8. Confidence ──────────────────────────────────────────────────
    // Bounded 0-1, deterministic, and built from three independent
    // signals: how much of the configured window was actually available
    // (windowCompleteness), how complete the underlying prepared history
    // itself was against the window it requested (coverageRatio, Part
    // 2), and how far out the horizon reaches (horizonDecay — reuses
    // trendDampingFactor's shape with its own half-life, see
    // CONFIDENCE_HORIZON_DECAY_HALF_LIFE_DAYS). This is a heuristic
    // reliability score, not a calibrated statistical probability — the
    // same caveat ForecastConfidence's own comment documents.
    const windowCompleteness = Math.min(1, recentWindow.length / cfg.MOVING_AVERAGE_WINDOW_SIZE);
    const horizonDecay = trendDampingFactor(horizonDays, cfg.CONFIDENCE_HORIZON_DECAY_HALF_LIFE_DAYS);
    const confidenceScoreRaw = windowCompleteness * history.metadata.coverageRatio * horizonDecay;

    // ── 9. Round only at the output/persistence boundary ──────────────
    // (build spec section 14 — every calculation above stayed at full
    // precision).
    const modelMetadata: BaselineForecastMetadata = {
      algorithm: BASELINE_MODEL_VERSION,
      historicalObservationCount: recentWindow.length,
      historyStartDate: isoDate(recentWindow[0].date),
      historyEndDate: isoDate(recentWindow[recentWindow.length - 1].date),
      baselinePrice: round(baselinePrice),
      trendSlope: round(dailySlope, 4),
      trendDirection: direction,
      trendAdjustment: round(trendAdjustment),
      uncertaintyMethod: "HISTORICAL_STD_DEV_SQRT_HORIZON",
      outlierCount: history.metadata.outlierCount,
      outlierPolicy: excludeOutliers ? "EXCLUDED" : "INCLUDED_FALLBACK",
      coverageRatio: history.metadata.coverageRatio,
      configuration: {
        movingAverageWindowSize: cfg.MOVING_AVERAGE_WINDOW_SIZE,
        minObservationsForTrend: cfg.MIN_OBSERVATIONS_FOR_TREND,
        trendFlatThresholdRatio: cfg.TREND_FLAT_THRESHOLD_RATIO,
        maxDailyTrendAdjustmentRatio: cfg.MAX_DAILY_TREND_ADJUSTMENT_RATIO,
        trendDampingHalfLifeDays: cfg.TREND_DAMPING_HALF_LIFE_DAYS,
        maxProjectionPercent: cfg.MAX_PROJECTION_PERCENT,
        uncertaintyMultiplier: cfg.UNCERTAINTY_MULTIPLIER,
        uncertaintyHorizonScaling: "SQRT_HORIZON_DAYS",
        minUncertaintyRatio: cfg.MIN_UNCERTAINTY_RATIO,
        confidenceHorizonDecayHalfLifeDays: cfg.CONFIDENCE_HORIZON_DECAY_HALF_LIFE_DAYS,
      },
    };

    return {
      outcome: "GENERATED",
      output: {
        predictedPrice: round(predictedPrice),
        lowerBound: round(lowerBound),
        upperBound: round(upperBound),
      },
      confidence: {
        score: round(Math.min(1, Math.max(0, confidenceScoreRaw)), 4),
        sampleCount: recentWindow.length,
      },
      modelMetadata,
    };
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
