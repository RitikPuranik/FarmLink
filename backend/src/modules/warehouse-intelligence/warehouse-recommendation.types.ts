import { QuantityUnit, StorageRateType } from "@prisma/client";
import { SuitabilityStatus } from "./storage-suitability.types";
import { RankingFactorKey } from "./warehouse-intelligence.config";
import { WarehouseConstraint, WarehouseRisk } from "./warehouse-risk-analysis.types";
import { WarehouseDTO } from "./warehouse.types";

// ---------------------------------------------------------------------------
// Module 9 Part 5 — Warehouse Recommendation & Ranking Engine. Ranks
// warehouses already found SUITABLE/CONDITIONALLY_SUITABLE by Part 4 —
// never re-derives suitability itself, never uses AI, never fabricates a
// cost or distance it can't actually compute.
// ---------------------------------------------------------------------------

export interface RecommendationSearchInput {
  cropId: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  quantity?: number;
  unit?: QuantityUnit;
  durationDays?: number;
}

/**
 * Only ever populated when quantity, a resolvable unit, a requested
 * duration, and an applicable configured StorageRate (Part 1) all exist
 * together — see estimateStorageCost() in warehouse-recommendation.
 * engine.ts. `assumptions` states in plain language exactly which inputs
 * were used, since this is a deterministic arithmetic estimate from
 * configured data, never a market quote or a guarantee.
 */
export interface StorageCostEstimate {
  amount: number;
  currency: string;
  pricingBasis: StorageRateType;
  quantityUsedKg: number;
  durationUsedDays: number;
  assumptions: string[];
}

export interface WarehouseRecommendationResult {
  warehouse: WarehouseDTO;
  rank: number;
  rankingScore: number;

  suitability: SuitabilityStatus;
  suitabilityScore: number | null;
  confidence: number | null;

  distanceKm: number | null;
  availableCapacityKg: number | null;

  estimatedStorageCost: StorageCostEstimate | null;

  risks: WarehouseRisk[];
  constraints: WarehouseConstraint[];

  factorsUsed: RankingFactorKey[];
  omittedFactors: RankingFactorKey[];

  /** Deterministic, template-built — never LLM-generated. Only ever
   * names facts actually used in this candidate's own ranking; never
   * claims a factor that was omitted for it. */
  explanation: string;

  evaluatedAt: string;
}

/**
 * A candidate that could not be confidently ranked (Part 4 returned
 * UNKNOWN) — kept structurally separate from `recommendations` rather
 * than mixed in with an apologetic caveat, per this part's explicit "do
 * not mix them with recommended warehouses without clearly indicating
 * uncertainty" instruction.
 */
export interface UnevaluableCandidateDTO {
  warehouse: WarehouseDTO;
  reason: "INSUFFICIENT_DATA";
  explanationCodes: string[];
}

export interface RecommendationSearchMetadata {
  cropId: string;
  quantity: number | null;
  unit: QuantityUnit | null;
  durationDays: number | null;
  latitude: number | null;
  longitude: number | null;
  radiusKm: number | null;
}

export interface WarehouseRecommendationResponse {
  recommendations: WarehouseRecommendationResult[];
  unevaluableCandidates: UnevaluableCandidateDTO[];
  evaluatedCandidateCount: number;
  suitableCandidateCount: number;
  excludedCandidateCount: number;
  searchMetadata: RecommendationSearchMetadata;
  disclaimer: string;
}

export const RECOMMENDATION_DISCLAIMER =
  "This ranking is a deterministic comparison of configured, persisted warehouse data (suitability, capacity, " +
  "distance, and — only where a rate is configured — an estimated cost). It is not an AI recommendation, does not " +
  "predict spoilage, and does not guarantee warehouse availability at the time of storage.";
