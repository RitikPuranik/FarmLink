import { QuantityUnit, StorageRateType } from "@prisma/client";
import { CapacityStatus } from "./warehouse-capacity";
import { RankingFactorKey, WAREHOUSE_RECOMMENDATION_CONFIG, WAREHOUSE_RISK_ANALYSIS_CONFIG } from "./warehouse-intelligence.config";
import { RiskSeverity, WarehouseRisk } from "./warehouse-risk-analysis.types";
import { StorageCostEstimate } from "./warehouse-recommendation.types";
import { computeRebalancedWeightedScore } from "./weighted-scoring";

// ---------------------------------------------------------------------------
// Module 9 Part 5 — pure, deterministic, database-free ranking engine. No
// Prisma, no Redis, no AI, no sleeping — mirrors storage-suitability.
// engine.ts and warehouse-risk-analysis.engine.ts's own discipline.
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Closer scores higher; null (no coordinates, or no location search at
 * all) is omitted, never treated as "infinitely far" or "0 distance". */
export function scoreDistance(distanceKm: number | null, radiusKm: number | null): number | null {
  if (!isFiniteNumber(distanceKm) || !isFiniteNumber(radiusKm) || radiusKm <= 0) return null;
  const fraction = Math.max(0, Math.min(1, distanceKm / radiusKm));
  return Math.round((100 - fraction * 100) * 100) / 100;
}

/**
 * When a specific quantity was requested: exactly enough capacity scores
 * 50; capacity at or beyond `(1 + CAPACITY_HEADROOM_SATURATION_RATIO)` ×
 * the requested quantity saturates at 100 — this differentiates *how
 * much* headroom a candidate has, unlike Part 4's binary
 * canAccommodate-only feasibility score. When no quantity was requested,
 * falls back to Part 4's own status-based score (reused, not
 * duplicated) so an unrequested-quantity search can still rank by
 * capacity generally.
 */
export function scoreCapacityHeadroom(
  availableKg: number | null,
  requestedKg: number | null,
  capacityStatus: CapacityStatus,
): number | null {
  if (requestedKg !== null && requestedKg > 0) {
    if (!isFiniteNumber(availableKg)) return null;
    if (availableKg < requestedKg) return null; // shouldn't reach ranking at all — Part 4 already excludes this
    const headroomRatio = (availableKg - requestedKg) / requestedKg;
    const saturation = WAREHOUSE_RECOMMENDATION_CONFIG.CAPACITY_HEADROOM_SATURATION_RATIO;
    const fraction = saturation > 0 ? Math.min(1, headroomRatio / saturation) : headroomRatio > 0 ? 1 : 0;
    return Math.round((50 + fraction * 50) * 100) / 100;
  }
  return WAREHOUSE_RISK_ANALYSIS_CONFIG.CAPACITY_STATUS_SCORE[capacityStatus];
}

/**
 * Relative cost scoring across the *evaluated batch*: the cheapest
 * candidate in this particular result set scores 100, the most
 * expensive scores 0, proportionally in between. There is no absolute
 * "good price" threshold anywhere in this schema to score against, so —
 * exactly like Module 6's own relative price-percentile pattern — cost
 * is ranked relative to the other real, configured costs actually
 * returned this request, never against an invented absolute scale.
 * Candidates with a null cost keep null here (per-candidate omission,
 * rebalanced individually by computeRankingScore).
 */
export function scoreCostsRelatively(costs: Array<number | null>): Array<number | null> {
  const known = costs.filter(isFiniteNumber);
  if (known.length === 0) return costs.map(() => null);
  const min = Math.min(...known);
  const max = Math.max(...known);
  return costs.map((cost) => {
    if (!isFiniteNumber(cost)) return null;
    if (max === min) return 100;
    return Math.round((100 - ((cost - min) / (max - min)) * 100) * 100) / 100;
  });
}

export interface RankingScores {
  DISTANCE: number | null;
  SUITABILITY_SCORE: number | null;
  CAPACITY_HEADROOM: number | null;
  STORAGE_COST: number | null;
}

export function computeRankingScore(scores: RankingScores) {
  return computeRebalancedWeightedScore(WAREHOUSE_RECOMMENDATION_CONFIG.RANKING_WEIGHTS, scores);
}

/**
 * Convert a warehouse's applicable StorageRate (Part 1, already resolved
 * by the caller via StorageRateRepository.findApplicable) into a cost
 * estimate. Returns null whenever quantity, duration, or the rate itself
 * is missing — never a fabricated number. `quantityKg` must already be
 * normalized to KG (see toKg() in warehouse-capacity.ts); `billingUnit`
 * is converted the same way so a QTL- or TONNE-billed rate is compared
 * on the same basis as a KG one, using the same trusted KG-normalization
 * convention this module already relies on elsewhere (see
 * warehouse-capacity.ts's own comment on why KG<->QTL<->TONNE conversion
 * is not the "silent ambiguous unit conversion" the build spec warns
 * against).
 */
export function estimateStorageCost(
  rate: { rateType: StorageRateType; rateAmount: number; currency: string; billingUnit: QuantityUnit },
  billingUnitToKg: (value: number, unit: QuantityUnit) => number,
  quantityKg: number | null,
  durationDays: number | null,
): StorageCostEstimate | null {
  if (!isFiniteNumber(quantityKg) || quantityKg <= 0) return null;
  if (!isFiniteNumber(durationDays) || durationDays <= 0) return null;

  const assumptions: string[] = [
    `Rate type ${rate.rateType} at ${rate.rateAmount} ${rate.currency} per ${rate.billingUnit}.`,
  ];

  let amount: number;
  switch (rate.rateType) {
    case "PER_QUANTITY_PER_DAY": {
      const billingUnitKg = billingUnitToKg(1, rate.billingUnit);
      if (!isFiniteNumber(billingUnitKg) || billingUnitKg <= 0) return null;
      const ratePerKg = rate.rateAmount / billingUnitKg;
      amount = ratePerKg * quantityKg * durationDays;
      assumptions.push(`Quantity converted to ${quantityKg.toFixed(2)} kg for a per-quantity-per-day rate.`);
      break;
    }
    case "PER_DAY":
      amount = rate.rateAmount * durationDays;
      assumptions.push("Flat per-day rate; not scaled by quantity.");
      break;
    case "PER_WEEK":
      amount = rate.rateAmount * Math.ceil(durationDays / 7);
      assumptions.push(`Billed in whole weeks (${Math.ceil(durationDays / 7)} week(s) for ${durationDays} day(s)).`);
      break;
    case "PER_MONTH":
      amount = rate.rateAmount * Math.ceil(durationDays / 30);
      assumptions.push(`Billed in whole 30-day months (${Math.ceil(durationDays / 30)} month(s) for ${durationDays} day(s)).`);
      break;
    default:
      return null;
  }

  return {
    amount: Math.round(amount * 100) / 100,
    currency: rate.currency,
    pricingBasis: rate.rateType,
    quantityUsedKg: Math.round(quantityKg * 100) / 100,
    durationUsedDays: durationDays,
    assumptions,
  };
}

const SEVERITY_WEIGHT: Record<RiskSeverity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/** Sum of severity weights across a candidate's (already non-blocking —
 * blocking ones mean Part 4 excluded the candidate before it ever
 * reaches ranking) risks — used only as tie-break input #2 below, never
 * as a ranking score of its own. */
export function riskSeverityWeight(risks: WarehouseRisk[]): number {
  return risks.reduce((sum, r) => sum + SEVERITY_WEIGHT[r.severity], 0);
}

export interface TieBreakCandidate {
  rankingScore: number;
  suitabilityScore: number | null;
  risks: WarehouseRisk[];
  distanceKm: number | null;
  availableCapacityKg: number | null;
  warehousePublicId: string;
}

/**
 * Deterministic, fully specified comparator (build spec's exact order):
 * 1) rankingScore desc, 2) suitabilityScore desc (nulls last),
 * 3) total non-blocking risk severity asc (fewer/lighter risks first),
 * 4) distanceKm asc (nulls last — an unknown distance is never assumed
 * to be the closest), 5) availableCapacityKg desc (nulls last),
 * 6) warehousePublicId asc as the final, always-decisive tiebreaker —
 * never relies on incoming array/database order.
 */
export function compareForRanking(a: TieBreakCandidate, b: TieBreakCandidate): number {
  if (a.rankingScore !== b.rankingScore) return b.rankingScore - a.rankingScore;

  const suitabilityA = a.suitabilityScore ?? -1;
  const suitabilityB = b.suitabilityScore ?? -1;
  if (suitabilityA !== suitabilityB) return suitabilityB - suitabilityA;

  const riskA = riskSeverityWeight(a.risks);
  const riskB = riskSeverityWeight(b.risks);
  if (riskA !== riskB) return riskA - riskB;

  const distanceA = a.distanceKm ?? Number.POSITIVE_INFINITY;
  const distanceB = b.distanceKm ?? Number.POSITIVE_INFINITY;
  if (distanceA !== distanceB) return distanceA - distanceB;

  const capacityA = a.availableCapacityKg ?? -1;
  const capacityB = b.availableCapacityKg ?? -1;
  if (capacityA !== capacityB) return capacityB - capacityA;

  return a.warehousePublicId.localeCompare(b.warehousePublicId);
}

/**
 * Template-based explanation — never LLM-generated (build spec: "Do NOT
 * use LLMs"). Only mentions factors that were actually used for this
 * specific candidate; an omitted factor is named in `omittedFactors`
 * inputs but never claimed as a strength.
 */
export function buildRecommendationExplanation(input: {
  suitability: "SUITABLE" | "CONDITIONALLY_SUITABLE";
  factorsUsed: RankingFactorKey[];
  distanceKm: number | null;
  hasCostEstimate: boolean;
}): string {
  const strengths: string[] = [];
  if (input.suitability === "SUITABLE") strengths.push("is fully suitable for this crop");
  else strengths.push("is suitable for this crop with some non-critical constraints");

  if (input.factorsUsed.includes("CAPACITY_HEADROOM")) strengths.push("has sufficient available capacity");
  if (input.factorsUsed.includes("DISTANCE") && input.distanceKm !== null) {
    strengths.push(`is ${input.distanceKm.toFixed(1)} km from the requested location`);
  }
  if (input.factorsUsed.includes("STORAGE_COST") && input.hasCostEstimate) {
    strengths.push("has a competitively priced configured storage rate among the evaluated candidates");
  }

  return `Ranked based on the following: this warehouse ${strengths.join(", ")}.`;
}
