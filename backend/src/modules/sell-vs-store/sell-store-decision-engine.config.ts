import { DecisionFactor } from "./sell-store-decision-engine.types";

/**
 * Centralized configuration for the deterministic Sell vs Store decision
 * engine.  All thresholds and weights live here — no magic numbers are
 * scattered through the service layer.
 *
 * WEIGHTS
 * -------
 * Only *directional* factors carry weight (evidence toward SELL_NOW or
 * STORE).  FRESHNESS and market confidence are *reliability* modifiers
 * that reduce overall confidence but never push directional scores.
 *
 * When a factor's underlying data is unavailable, its weight is removed
 * and the remaining weights are re-normalised to sum to 100.
 */
export const DECISION_ENGINE_CONFIG = {
  // ── Sufficiency gates ──────────────────────────────────────────────
  /** Market freshness values that block any scoring attempt. */
  INSUFFICIENT_FRESHNESS: "OUTDATED" as const,

  /** Minimum computed confidence required to issue a SELL_NOW or STORE
   *  recommendation.  Below this → INSUFFICIENT_DATA. */
  MIN_CONFIDENCE_THRESHOLD: 0.3,

  // ── Directional scoring ────────────────────────────────────────────
  /** Margin (on the 0-100 scale) at or below which the directional
   *  scores are considered a tie → INSUFFICIENT_DATA. */
  DECISION_MARGIN: 10,

  /** Base weights for directional factors.  When a factor is omitted its
   *  weight is redistributed proportionally among the remaining active
   *  factors. */
  WEIGHTS: {
    MARKET_TREND: 40,
    VOLATILITY: 30,
    STORAGE_RISK: 15,
    QUALITY_CONSTRAINTS: 15,
  } as Record<DecisionFactor, number>,

  // ── Per-factor score tables ────────────────────────────────────────
  /** Directional evidence produced by the market trend.
   *  Values use the Module 6 simplified trend vocabulary already
   *  collapsed into UP / DOWN / STABLE by the Part 2 resolver. */
  TREND_SCORES: {
    DOWN:   { sell: 100, store: 0   },
    STABLE: { sell: 50,  store: 50  },
    UP:     { sell: 0,   store: 100 },
  } as Record<string, { sell: number; store: number }>,

  /** Directional evidence produced by volatility.  The raw numeric
   *  score from Part 2 is classified using Module 6 thresholds
   *  (MARKET_CONFIG.volatilityMedium / volatilityHigh). */
  VOLATILITY_SCORES: {
    HIGH:   { sell: 100, store: 0   },
    MEDIUM: { sell: 50,  store: 50  },
    LOW:    { sell: 0,   store: 100 },
  } as Record<string, { sell: number; store: number }>,

  /** Directional evidence from storage spoilage risk (0-1 scale).
   *  Thresholds classify the risk level. */
  STORAGE_RISK_THRESHOLDS: {
    HIGH: 0.7,
    MEDIUM: 0.3,
  },
  STORAGE_RISK_SCORES: {
    HIGH:   { sell: 100, store: 0   },
    MEDIUM: { sell: 60,  store: 40  },
    LOW:    { sell: 0,   store: 100 },
  } as Record<string, { sell: number; store: number }>,

  // ── Confidence modifiers (reliability, NOT directional) ────────────
  /** Multiplier applied to confidence based on market freshness. */
  FRESHNESS_CONFIDENCE: {
    FRESH:    1.0,
    RECENT:   0.85,
    STALE:    0.55,
    OUTDATED: 0.0,   // gate — should never reach scoring
  } as Record<string, number>,

  /** Multiplier applied to confidence based on resolved market
   *  confidence from Part 2 (0-1 numeric, mapped from Module 6
   *  RecommendationConfidence). */
  MARKET_CONFIDENCE_FLOOR: 0.1,
} as const;
