import { CapacityStatus, CropCompatibilityState } from "./warehouse-capacity";
import { SuitabilityStatus } from "./storage-suitability.types";
import { AnalysisFactorKey, WAREHOUSE_RISK_ANALYSIS_CONFIG, isCriticalAnalysisFactor } from "./warehouse-intelligence.config";
import { computeRebalancedWeightedScore, WeightedRebalanceResult } from "./weighted-scoring";
import {
  ConstraintCode,
  DurationCompatibilityOutcome,
  OperationalStatusOutcome,
  RiskCode,
  WarehouseConstraint,
  WarehouseRisk,
} from "./warehouse-risk-analysis.types";

// ---------------------------------------------------------------------------
// Module 9 Part 4 — pure, deterministic, database-free risk-analysis
// engine. No Prisma, no Redis, no AI provider, no sleeping — mirrors
// storage-suitability.engine.ts's own discipline. Every function here
// takes already-resolved plain values and returns a plain value; the
// service layer (warehouse-risk-analysis.service.ts) owns fetching data
// and calling this engine.
// ---------------------------------------------------------------------------

/**
 * NOT_APPLICABLE covers both "no duration was requested" and "the
 * warehouse has no configured maximum for this crop" — neither is a data
 * gap serious enough to flag as a risk (this part's explicit "do not
 * invent duration limits" rule), so the factor is simply omitted from
 * scoring rather than treated as unknown/blocking.
 */
export function compareDuration(requestedDurationDays: number | undefined, maxAllowedDays: number | null): DurationCompatibilityOutcome {
  if (requestedDurationDays === undefined || requestedDurationDays <= 0) return "NOT_APPLICABLE";
  if (maxAllowedDays === null || maxAllowedDays === undefined) return "NOT_APPLICABLE";
  return requestedDurationDays <= maxAllowedDays ? "SUPPORTED" : "EXCEEDS_MAXIMUM";
}

/** Warehouse operational status is always knowable from persisted
 * Warehouse.status/isActive — never "unknown", unlike most other
 * factors here. */
export function evaluateOperationalStatus(status: string, isActive: boolean): OperationalStatusOutcome {
  return status === "ACTIVE" && isActive ? "OPERATIONAL" : "UNAVAILABLE";
}

/** Per-factor 0-100 score, or null when the factor cannot be scored
 * (unknown/not-applicable) — callers must treat null as "omit and
 * rebalance", never as a fabricated neutral midpoint score. */
export function scoreForFactor(
  factor: AnalysisFactorKey,
  outcome:
    | CropCompatibilityState
    | { capacityStatus: CapacityStatus; canAccommodate: boolean | null; quantityRequested: boolean }
    | DurationCompatibilityOutcome
    | SuitabilityStatus
    | OperationalStatusOutcome,
): number | null {
  switch (factor) {
    case "CROP_COMPATIBILITY": {
      const v = outcome as CropCompatibilityState;
      if (v === "SUPPORTED") return 100;
      if (v === "UNSUPPORTED") return 0;
      return null; // UNKNOWN
    }
    case "CAPACITY_FEASIBILITY": {
      const v = outcome as { capacityStatus: CapacityStatus; canAccommodate: boolean | null; quantityRequested: boolean };
      if (v.quantityRequested) {
        if (v.canAccommodate === true) return 100;
        if (v.canAccommodate === false) return 0;
        return null; // compatibility unknown, fit can't be confirmed
      }
      return WAREHOUSE_RISK_ANALYSIS_CONFIG.CAPACITY_STATUS_SCORE[v.capacityStatus];
    }
    case "DURATION_COMPATIBILITY": {
      const v = outcome as DurationCompatibilityOutcome;
      if (v === "NOT_APPLICABLE") return null;
      return v === "SUPPORTED" ? 100 : 0;
    }
    case "ENVIRONMENTAL_COMPATIBILITY": {
      const v = outcome as SuitabilityStatus;
      return WAREHOUSE_RISK_ANALYSIS_CONFIG.ENVIRONMENTAL_STATUS_SCORE[v];
    }
    case "WAREHOUSE_OPERATIONAL_STATUS": {
      const v = outcome as OperationalStatusOutcome;
      return v === "OPERATIONAL" ? 100 : 0;
    }
    default:
      return null;
  }
}

export type WeightedScoreResult = WeightedRebalanceResult<AnalysisFactorKey>;

/**
 * Weighted sum over only the factors with a non-null score, with the
 * remaining weights rebalanced proportionally (this part's mandatory
 * "do not assign a fake neutral score; rebalance" rule) — delegates the
 * actual arithmetic to weighted-scoring.ts's computeRebalancedWeightedScore(),
 * shared with Part 5's ranking score so the two engines can't drift into
 * two different rebalancing behaviors under the same name. Returns
 * score: null only when every factor was omitted (nothing at all could
 * be evaluated) — the caller (evaluateWarehouseSuitabilityRisk) is
 * responsible for forcing an overall UNKNOWN/INSUFFICIENT_DATA status
 * separately whenever a *critical* factor was omitted, regardless of
 * what the rebalanced score of the remaining factors comes out to.
 */
export function computeWeightedScore(scores: Record<AnalysisFactorKey, number | null>): WeightedScoreResult {
  return computeRebalancedWeightedScore(WAREHOUSE_RISK_ANALYSIS_CONFIG.SCORE_WEIGHTS, scores);
}

/**
 * Confidence reflects data completeness, never a spoilage/success
 * probability: null whenever a critical factor was genuinely unknown
 * (see WAREHOUSE_RISK_ANALYSIS_CONFIG.CRITICAL_ANALYSIS_FACTORS),
 * otherwise the fraction of total possible weight that was actually
 * evaluated (rounded to 2 decimals) — a result built entirely from
 * NOT_APPLICABLE/omitted non-critical factors still reports a lower
 * confidence than one with every factor evaluated, even though neither
 * is blocked from having a status.
 */
export function computeConfidence(hasCriticalUnknown: boolean, factorsUsed: AnalysisFactorKey[]): number | null {
  if (hasCriticalUnknown) return null;
  const weights = WAREHOUSE_RISK_ANALYSIS_CONFIG.SCORE_WEIGHTS;
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return null;
  const usedWeight = factorsUsed.reduce((sum, key) => sum + weights[key], 0);
  return Math.round((usedWeight / totalWeight) * 100) / 100;
}

export interface EvaluatedFactorsInput {
  cropCompatibility: CropCompatibilityState;
  capacityStatus: CapacityStatus;
  canAccommodate: boolean | null;
  quantityRequested: boolean;
  durationCompatibility: DurationCompatibilityOutcome;
  environmentalCompatibility: SuitabilityStatus;
  operationalStatus: OperationalStatusOutcome;
}

export interface RiskAnalysisEngineResult {
  suitability: SuitabilityStatus;
  suitabilityScore: number | null;
  confidence: number | null;
  risks: WarehouseRisk[];
  constraints: WarehouseConstraint[];
  blockingIssues: Array<WarehouseRisk | WarehouseConstraint>;
  factorsUsed: AnalysisFactorKey[];
  omittedFactors: AnalysisFactorKey[];
}

function risk(code: RiskCode, severity: WarehouseRisk["severity"], blocking: boolean, explanation: string): WarehouseRisk {
  return { code, severity, blocking, explanation };
}

function constraint(code: ConstraintCode, blocking: boolean, explanation: string): WarehouseConstraint {
  return { code, blocking, explanation };
}

/**
 * The main deterministic entry point. Two callers with identical input
 * always get an identical result (build spec: "deterministic repeated
 * results"). Never touches a database, clock beyond what the caller
 * passed in, or AI provider.
 */
export function evaluateWarehouseSuitabilityRisk(input: EvaluatedFactorsInput): RiskAnalysisEngineResult {
  const risks: WarehouseRisk[] = [];
  const constraints: WarehouseConstraint[] = [];

  // --- Crop compatibility --------------------------------------------
  if (input.cropCompatibility === "UNSUPPORTED") {
    risks.push(risk("CROP_INCOMPATIBILITY", "CRITICAL", true, "This warehouse is explicitly configured as not supporting this crop."));
    constraints.push(constraint("CROP_EXPLICITLY_UNSUPPORTED", true, "The crop is explicitly marked unsupported for this warehouse."));
  } else if (input.cropCompatibility === "UNKNOWN") {
    risks.push(risk("CROP_COMPATIBILITY_UNKNOWN", "HIGH", false, "No configured compatibility record exists for this crop at this warehouse."));
  }

  // --- Capacity feasibility -------------------------------------------
  if (input.quantityRequested) {
    if (input.canAccommodate === false) {
      risks.push(risk("CAPACITY_CONSTRAINT", "CRITICAL", true, "The warehouse does not have enough available capacity for the requested quantity."));
      constraints.push(constraint("QUANTITY_EXCEEDS_AVAILABLE_CAPACITY", true, "Requested quantity exceeds currently available capacity."));
    } else if (input.canAccommodate === null) {
      risks.push(risk("CAPACITY_DATA_UNAVAILABLE", "HIGH", false, "Capacity compatibility could not be confirmed for the requested quantity."));
    } else if (input.capacityStatus === "LIMITED") {
      risks.push(risk("LIMITED_CAPACITY", "MEDIUM", false, "The warehouse is nearing full utilization."));
    }
  } else {
    if (input.capacityStatus === "UNAVAILABLE") {
      risks.push(risk("CAPACITY_DATA_UNAVAILABLE", "HIGH", false, "No configured capacity data exists for this warehouse."));
    } else if (input.capacityStatus === "FULL") {
      risks.push(risk("CAPACITY_CONSTRAINT", "HIGH", false, "The warehouse currently has no available capacity."));
    } else if (input.capacityStatus === "LIMITED") {
      risks.push(risk("LIMITED_CAPACITY", "MEDIUM", false, "The warehouse is nearing full utilization."));
    }
  }

  // --- Duration compatibility ------------------------------------------
  if (input.durationCompatibility === "EXCEEDS_MAXIMUM") {
    risks.push(risk("DURATION_LIMIT_EXCEEDED", "HIGH", true, "The requested storage duration exceeds this warehouse's configured maximum for this crop."));
    constraints.push(constraint("MAXIMUM_STORAGE_DURATION_EXCEEDED", true, "Requested duration exceeds the configured maximum storage duration."));
  }

  // --- Environmental compatibility (Part 3) -----------------------------
  if (input.environmentalCompatibility === "UNSUITABLE") {
    risks.push(risk("ENVIRONMENTAL_INCOMPATIBILITY", "CRITICAL", true, "This warehouse's declared storage conditions are incompatible with this crop's configured requirements."));
  } else if (input.environmentalCompatibility === "UNKNOWN") {
    risks.push(risk("ENVIRONMENTAL_DATA_UNKNOWN", "HIGH", false, "Storage-condition compatibility could not be reliably determined from configured data."));
    constraints.push(constraint("ENVIRONMENTAL_COMPATIBILITY_UNVERIFIED", false, "Environmental compatibility could not be verified from configured data."));
  } else if (input.environmentalCompatibility === "CONDITIONALLY_SUITABLE") {
    risks.push(risk("ENVIRONMENTAL_CONSTRAINT", "MEDIUM", false, "Some non-critical storage-condition preferences are unmet or unknown."));
  }

  // --- Operational status ------------------------------------------------
  if (input.operationalStatus === "UNAVAILABLE") {
    risks.push(risk("WAREHOUSE_UNAVAILABLE", "CRITICAL", true, "This warehouse is not currently operational."));
    constraints.push(constraint("WAREHOUSE_OPERATIONALLY_UNAVAILABLE", true, "The warehouse is inactive or suspended."));
  }

  // --- Scoring -------------------------------------------------------
  const scores: Record<AnalysisFactorKey, number | null> = {
    CROP_COMPATIBILITY: scoreForFactor("CROP_COMPATIBILITY", input.cropCompatibility),
    CAPACITY_FEASIBILITY: scoreForFactor("CAPACITY_FEASIBILITY", {
      capacityStatus: input.capacityStatus,
      canAccommodate: input.canAccommodate,
      quantityRequested: input.quantityRequested,
    }),
    DURATION_COMPATIBILITY: scoreForFactor("DURATION_COMPATIBILITY", input.durationCompatibility),
    ENVIRONMENTAL_COMPATIBILITY: scoreForFactor("ENVIRONMENTAL_COMPATIBILITY", input.environmentalCompatibility),
    WAREHOUSE_OPERATIONAL_STATUS: scoreForFactor("WAREHOUSE_OPERATIONAL_STATUS", input.operationalStatus),
  };

  const { score, factorsUsed, omittedFactors } = computeWeightedScore(scores);

  const criticalOmitted = omittedFactors.filter(isCriticalAnalysisFactor);
  const hasCriticalUnknown = criticalOmitted.length > 0;
  const confidence = computeConfidence(hasCriticalUnknown, factorsUsed);

  if (!hasCriticalUnknown && confidence !== null && confidence < WAREHOUSE_RISK_ANALYSIS_CONFIG.LOW_CONFIDENCE_THRESHOLD) {
    risks.push(risk("WAREHOUSE_DATA_INCOMPLETE", "LOW", false, "Several non-critical factors could not be evaluated from configured data."));
  }

  const blockingIssues: Array<WarehouseRisk | WarehouseConstraint> = [
    ...risks.filter((r) => r.blocking),
    ...constraints.filter((c) => c.blocking),
  ];

  let suitability: SuitabilityStatus;
  if (blockingIssues.length > 0) {
    suitability = "UNSUITABLE";
  } else if (hasCriticalUnknown) {
    suitability = "UNKNOWN";
  } else if (risks.length > 0 || constraints.length > 0) {
    suitability = "CONDITIONALLY_SUITABLE";
  } else {
    suitability = "SUITABLE";
  }

  return {
    suitability,
    suitabilityScore: suitability === "UNKNOWN" ? null : score,
    confidence,
    risks,
    constraints,
    blockingIssues,
    factorsUsed,
    omittedFactors,
  };
}
