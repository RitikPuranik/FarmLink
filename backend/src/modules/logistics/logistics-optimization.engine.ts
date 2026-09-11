import { LOGISTICS_ALGORITHM_VERSION } from "./logistics.config";
import type { OptimizationWeights } from "./logistics.config";

/**
 * Step 9 — LogisticsOptimizationEngine. Deliberately independent of any
 * HTTP controller and of Prisma (build spec: "Keep the optimization engine
 * independent from HTTP controllers"; DO NOT use an LLM here). Given the
 * same input array and weights, always produces the same ranking — no
 * randomness, no wall-clock-dependent tie-breaking.
 */

export interface OptimizationCandidate {
  quoteId: string;
  quotedAmount: number;
  estimatedDistanceKm: number;
  estimatedDurationMinutes: number;
  vehicleCapacityKg: number;
  reliabilityScore: number; // 0-100, see provider-reliability.ts
  reliabilitySource: "COMPUTED" | "DEFAULT";
}

export interface OptimizationContext {
  requiredCapacityKg: number;
}

export type RankingReason =
  | "LOWEST_TOTAL_COST"
  | "SHORTEST_DISTANCE"
  | "FASTEST_DELIVERY"
  | "GOOD_CAPACITY_FIT"
  | "HIGH_PROVIDER_RELIABILITY"
  | "RELIABILITY_UNVERIFIED";

export interface ComponentScores {
  priceScore: number;
  distanceScore: number;
  timeScore: number;
  capacityFitScore: number;
  reliabilityScore: number;
}

export interface RankedOption {
  rank: number;
  quoteId: string;
  score: number;
  componentScores: ComponentScores;
  reasons: RankingReason[];
}

export interface OptimizationResult {
  algorithmVersion: string;
  weights: OptimizationWeights;
  rankings: RankedOption[];
  recommendedQuoteId: string | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Normalizes a set of raw values to a 0-100 scale where `betterIsLower`
 * controls direction (price/distance/time: lower is better; reliability/
 * capacity fit are already 0-100 and passed straight through by the
 * caller). When every value in the set is equal, every candidate scores
 * 100 — there is no meaningful spread to penalize anyone for.
 */
function normalizeInverse(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 100);
  return values.map((v) => ((max - v) / (max - min)) * 100);
}

export class LogisticsOptimizationEngine {
  rank(candidates: OptimizationCandidate[], context: OptimizationContext, weights: OptimizationWeights): OptimizationResult {
    if (candidates.length === 0) {
      return { algorithmVersion: LOGISTICS_ALGORITHM_VERSION, weights, rankings: [], recommendedQuoteId: null };
    }

    const priceScores = normalizeInverse(candidates.map((c) => c.quotedAmount));
    const distanceScores = normalizeInverse(candidates.map((c) => c.estimatedDistanceKm));
    const timeScores = normalizeInverse(candidates.map((c) => c.estimatedDurationMinutes));

    const scored = candidates.map((candidate, index) => {
      // Capacity fit: how closely the vehicle's capacity matches the
      // required load, without going under it (ineligible candidates are
      // never passed in — see VehicleEligibilityService). A vehicle at
      // exactly the required capacity scores 100; a vehicle at 3x the
      // required capacity scores lower — excess capacity is (mildly)
      // penalized as inefficient/oversized for the job, not rewarded.
      const fitRatio = context.requiredCapacityKg > 0 ? context.requiredCapacityKg / candidate.vehicleCapacityKg : 1;
      const capacityFitScore = Math.max(0, Math.min(100, fitRatio * 100));

      const componentScores: ComponentScores = {
        priceScore: round2(priceScores[index]),
        distanceScore: round2(distanceScores[index]),
        timeScore: round2(timeScores[index]),
        capacityFitScore: round2(capacityFitScore),
        reliabilityScore: round2(candidate.reliabilityScore),
      };

      const finalScore =
        componentScores.priceScore * weights.priceWeight +
        componentScores.distanceScore * weights.distanceWeight +
        componentScores.timeScore * weights.timeWeight +
        componentScores.capacityFitScore * weights.capacityWeight +
        componentScores.reliabilityScore * weights.reliabilityWeight;

      const reasons: RankingReason[] = [];
      if (Math.min(...candidates.map((c) => c.quotedAmount)) === candidate.quotedAmount) reasons.push("LOWEST_TOTAL_COST");
      if (Math.min(...candidates.map((c) => c.estimatedDistanceKm)) === candidate.estimatedDistanceKm)
        reasons.push("SHORTEST_DISTANCE");
      if (Math.min(...candidates.map((c) => c.estimatedDurationMinutes)) === candidate.estimatedDurationMinutes)
        reasons.push("FASTEST_DELIVERY");
      if (componentScores.capacityFitScore >= 80) reasons.push("GOOD_CAPACITY_FIT");
      if (candidate.reliabilitySource === "DEFAULT") {
        reasons.push("RELIABILITY_UNVERIFIED");
      } else if (componentScores.reliabilityScore >= 75) {
        reasons.push("HIGH_PROVIDER_RELIABILITY");
      }

      return { candidate, score: round2(finalScore), componentScores, reasons };
    });

    // Deterministic ordering: score desc, then quotedAmount asc, then
    // quoteId asc — guarantees the exact same ranking for the exact same
    // input regardless of the order candidates were passed in.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.candidate.quotedAmount !== b.candidate.quotedAmount) return a.candidate.quotedAmount - b.candidate.quotedAmount;
      return a.candidate.quoteId.localeCompare(b.candidate.quoteId);
    });

    const rankings: RankedOption[] = scored.map((entry, index) => ({
      rank: index + 1,
      quoteId: entry.candidate.quoteId,
      score: entry.score,
      componentScores: entry.componentScores,
      reasons: entry.reasons,
    }));

    return {
      algorithmVersion: LOGISTICS_ALGORITHM_VERSION,
      weights,
      rankings,
      recommendedQuoteId: rankings[0]?.quoteId ?? null,
    };
  }
}
