import { MARKET_CONFIG } from "../market-intelligence/market-intelligence.types";
import { DECISION_ENGINE_CONFIG } from "./sell-store-decision-engine.config";
import { DecisionEngineResult, DecisionFactor, InsufficiencyReason } from "./sell-store-decision-engine.types";
import { ResolvedDecisionInput } from "./sell-store-input-resolver.types";

/**
 * Pure, deterministic Sell vs Store decision engine.
 *
 * Input:  ResolvedDecisionInput  (produced by DecisionInputResolverService)
 * Output: DecisionEngineResult
 *
 * Design principles
 * -----------------
 * 1. Identical inputs always produce identical outputs.
 * 2. No external I/O — no database, no API, no randomness.
 * 3. Directional evidence (SELL_NOW vs STORE) is separated from data
 *    reliability / confidence.
 * 4. Missing data is never fabricated — unavailable factors are omitted
 *    and their weight is redistributed.
 * 5. Conservative: ties, low confidence, and unknown storage feasibility
 *    all resolve to INSUFFICIENT_DATA rather than guessing.
 */
export class DecisionEngineService {
  private readonly cfg = DECISION_ENGINE_CONFIG;

  /**
   * Evaluate a resolved input and produce a deterministic decision.
   */
  evaluate(input: ResolvedDecisionInput): DecisionEngineResult {
    const insufficiencyReasons: InsufficiencyReason[] = [];

    // ── 1. Sufficiency gates ───────────────────────────────────────
    if (!input.availability.market) {
      insufficiencyReasons.push("MISSING_MARKET_DATA");
      return this.insufficient(insufficiencyReasons);
    }

    if (input.snapshot.market.freshness === this.cfg.INSUFFICIENT_FRESHNESS) {
      insufficiencyReasons.push("STALE_MARKET_DATA");
      return this.insufficient(insufficiencyReasons);
    }

    // ── 2. Evaluate each directional factor ────────────────────────
    const factorsUsed: DecisionFactor[] = [];
    const omittedFactors: DecisionFactor[] = [];
    const contributions: Array<{ factor: DecisionFactor; sell: number; store: number }> = [];

    // MARKET_TREND
    const trendValue = input.snapshot.market.trend;
    if (trendValue !== null && this.cfg.TREND_SCORES[trendValue]) {
      const scores = this.cfg.TREND_SCORES[trendValue];
      contributions.push({ factor: "MARKET_TREND", sell: scores.sell, store: scores.store });
      factorsUsed.push("MARKET_TREND");
    } else {
      omittedFactors.push("MARKET_TREND");
    }

    // VOLATILITY
    const volValue = input.snapshot.market.volatility;
    if (volValue !== null) {
      const level = this.classifyVolatility(volValue);
      const scores = this.cfg.VOLATILITY_SCORES[level];
      contributions.push({ factor: "VOLATILITY", sell: scores.sell, store: scores.store });
      factorsUsed.push("VOLATILITY");
    } else {
      omittedFactors.push("VOLATILITY");
    }

    // STORAGE_RISK
    const spoilageRisk = input.snapshot.storage.spoilageRisk;
    if (spoilageRisk !== null) {
      const level = this.classifySpoilageRisk(spoilageRisk);
      const scores = this.cfg.STORAGE_RISK_SCORES[level];
      contributions.push({ factor: "STORAGE_RISK", sell: scores.sell, store: scores.store });
      factorsUsed.push("STORAGE_RISK");
    } else {
      omittedFactors.push("STORAGE_RISK");
    }

    // QUALITY_CONSTRAINTS
    // Quality grade affects scoring: lower grades evidence SELL_NOW
    // (perishability), higher grades may support STORE.
    const qualityGrade = input.snapshot.lot.qualityGrade;
    if (qualityGrade !== null) {
      const { sell, store } = this.scoreQualityGrade(qualityGrade);
      contributions.push({ factor: "QUALITY_CONSTRAINTS", sell, store });
      factorsUsed.push("QUALITY_CONSTRAINTS");
    } else {
      omittedFactors.push("QUALITY_CONSTRAINTS");
    }

    // ── 3. Require at least one directional factor ─────────────────
    if (factorsUsed.length === 0) {
      insufficiencyReasons.push("MISSING_MARKET_DATA");
      return this.insufficient(insufficiencyReasons);
    }

    // ── 4. Weighted scoring with dynamic rebalancing ───────────────
    const activeWeights = new Map<DecisionFactor, number>();
    let totalActiveWeight = 0;
    for (const c of contributions) {
      const baseWeight = this.cfg.WEIGHTS[c.factor];
      activeWeights.set(c.factor, baseWeight);
      totalActiveWeight += baseWeight;
    }

    let sellScore = 0;
    let storeScore = 0;
    for (const c of contributions) {
      const normalisedWeight = activeWeights.get(c.factor)! / totalActiveWeight;
      sellScore += c.sell * normalisedWeight;
      storeScore += c.store * normalisedWeight;
    }

    // Round to 2 decimal places for determinism
    sellScore = Math.round(sellScore * 100) / 100;
    storeScore = Math.round(storeScore * 100) / 100;

    // ── 5. Compute confidence (separate from directional scores) ───
    const confidence = this.computeConfidence(input, factorsUsed);

    // ── 6. Apply conservative decision rules ───────────────────────

    // 6a. Confidence too low → INSUFFICIENT_DATA
    if (confidence < this.cfg.MIN_CONFIDENCE_THRESHOLD) {
      insufficiencyReasons.push("LOW_CONFIDENCE");
      return this.result("INSUFFICIENT_DATA", sellScore, storeScore, confidence, factorsUsed, omittedFactors, insufficiencyReasons);
    }

    // 6b. Tie → INSUFFICIENT_DATA
    if (Math.abs(sellScore - storeScore) <= this.cfg.DECISION_MARGIN) {
      insufficiencyReasons.push("CONFLICTING_MARKET_SIGNALS");
      return this.result("INSUFFICIENT_DATA", sellScore, storeScore, confidence, factorsUsed, omittedFactors, insufficiencyReasons);
    }

    // 6c. Determine directional winner
    const winner = sellScore > storeScore ? "SELL_NOW" : "STORE";

    // 6d. Conservative storage rules
    if (winner === "STORE") {
      // Explicitly UNAVAILABLE → block STORE
      if (input.availability.storage === "UNAVAILABLE") {
        insufficiencyReasons.push("UNKNOWN_STORAGE_FEASIBILITY");
        // SELL_NOW is viable if it had meaningful directional evidence,
        // otherwise INSUFFICIENT_DATA
        return this.result("INSUFFICIENT_DATA", sellScore, storeScore, confidence, factorsUsed, omittedFactors, insufficiencyReasons);
      }

      // UNKNOWN storage feasibility → cannot recommend STORE
      if (input.availability.storage === "UNKNOWN") {
        insufficiencyReasons.push("UNKNOWN_STORAGE_FEASIBILITY");
        return this.result("INSUFFICIENT_DATA", sellScore, storeScore, confidence, factorsUsed, omittedFactors, insufficiencyReasons);
      }
    }

    return this.result(winner, sellScore, storeScore, confidence, factorsUsed, omittedFactors, insufficiencyReasons);
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Classify a numeric volatility score using Module 6 thresholds.
   * Reuses MARKET_CONFIG.volatilityMedium and volatilityHigh.
   */
  private classifyVolatility(score: number): "LOW" | "MEDIUM" | "HIGH" {
    if (score >= MARKET_CONFIG.volatilityHigh) return "HIGH";
    if (score >= MARKET_CONFIG.volatilityMedium) return "MEDIUM";
    return "LOW";
  }

  /**
   * Classify a numeric spoilage risk (0-1) into a risk level.
   */
  private classifySpoilageRisk(risk: number): "LOW" | "MEDIUM" | "HIGH" {
    if (risk >= this.cfg.STORAGE_RISK_THRESHOLDS.HIGH) return "HIGH";
    if (risk >= this.cfg.STORAGE_RISK_THRESHOLDS.MEDIUM) return "MEDIUM";
    return "LOW";
  }

  /**
   * Score a quality grade for directional evidence.
   * Lower grades (C, D) → evidence toward SELL_NOW (sell before further
   * degradation).  Higher grades (A) → evidence toward STORE (quality
   * can sustain storage).  B is neutral.
   */
  private scoreQualityGrade(grade: string): { sell: number; store: number } {
    switch (grade) {
      case "A":  return { sell: 10, store: 90 };
      case "B":  return { sell: 50, store: 50 };
      case "C":  return { sell: 80, store: 20 };
      case "D":  return { sell: 100, store: 0 };
      default:   return { sell: 50, store: 50 };
    }
  }

  /**
   * Compute overall confidence from reliability signals.
   *
   * Confidence is the product of four independent multipliers:
   *   1. Market freshness   (how recent is the market data)
   *   2. Market confidence   (Module 6 recommendation confidence, 0-1)
   *   3. Factor coverage     (fraction of directional factors evaluated)
   *   4. Data completeness   (fraction of all three data domains present)
   *
   * Result is clamped to [0, 1].
   */
  private computeConfidence(
    input: ResolvedDecisionInput,
    factorsUsed: DecisionFactor[],
  ): number {
    const allFactors: DecisionFactor[] = ["MARKET_TREND", "VOLATILITY", "STORAGE_RISK", "QUALITY_CONSTRAINTS"];

    // 1. Freshness modifier
    const freshnessKey = input.snapshot.market.freshness ?? "OUTDATED";
    const freshnessMod = this.cfg.FRESHNESS_CONFIDENCE[freshnessKey] ?? 0;

    // 2. Market confidence modifier (from Part 2 resolver, 0-1 numeric)
    const marketConfRaw = input.snapshot.market.confidence;
    const marketConfMod = marketConfRaw !== null
      ? Math.max(this.cfg.MARKET_CONFIDENCE_FLOOR, marketConfRaw)
      : this.cfg.MARKET_CONFIDENCE_FLOOR;

    // 3. Factor coverage (proportion of directional factors used)
    const coverageMod = factorsUsed.length / allFactors.length;

    // 4. Data completeness (how many of the three data domains are present)
    let domainsPresent = 0;
    if (input.availability.market) domainsPresent++;
    if (input.availability.quality) domainsPresent++;
    if (input.availability.storage === "AVAILABLE") domainsPresent++;
    const completenessMod = domainsPresent / 3;

    const raw = freshnessMod * marketConfMod * coverageMod * completenessMod;
    // Clamp to [0, 1] and round to 4 decimal places
    return Math.round(Math.min(1, Math.max(0, raw)) * 10000) / 10000;
  }

  // ── Result builders ────────────────────────────────────────────────

  private insufficient(reasons: InsufficiencyReason[]): DecisionEngineResult {
    return {
      result: "INSUFFICIENT_DATA",
      sellScore: null,
      storeScore: null,
      confidence: 0,
      factorsUsed: [],
      omittedFactors: ["MARKET_TREND", "VOLATILITY", "STORAGE_RISK", "QUALITY_CONSTRAINTS"],
      insufficiencyReasons: reasons,
    };
  }

  private result(
    result: "SELL_NOW" | "STORE" | "INSUFFICIENT_DATA",
    sellScore: number,
    storeScore: number,
    confidence: number,
    factorsUsed: DecisionFactor[],
    omittedFactors: DecisionFactor[],
    insufficiencyReasons: InsufficiencyReason[],
  ): DecisionEngineResult {
    return { result, sellScore, storeScore, confidence, factorsUsed, omittedFactors, insufficiencyReasons };
  }
}
