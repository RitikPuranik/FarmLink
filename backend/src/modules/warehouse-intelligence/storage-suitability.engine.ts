import { isCriticalFactor, STORAGE_SUITABILITY_CONFIG } from "./warehouse-intelligence.config";
import {
  BooleanRequirementOutcome,
  CropStorageRequirementInput,
  RangeComparisonOutcome,
  StorageConditionsInput,
  StorageSuitabilityResult,
  StorageTypeOutcome,
  SuitabilityExplanationCode,
  SuitabilityFactorResult,
  SUITABILITY_DISCLAIMER,
} from "./storage-suitability.types";
import { CriticalFactorKey } from "./warehouse-intelligence.config";

// ---------------------------------------------------------------------------
// Module 9 Part 3 — pure, deterministic, database-free suitability engine.
//
// No function here reads Prisma, calls Redis, sleeps, calls an AI
// provider, or predicts spoilage — mirrors warehouse-capacity.ts's own
// "callers decide what a null/UNKNOWN result means for a 4xx" discipline.
// Every comparison is independently unit-testable with plain objects.
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Deterministic range-overlap comparison shared by temperature and
 * humidity. Returns NOT_REQUIRED when the crop never configured a
 * preferred range at all (both bounds null) — this must never be
 * conflated with UNKNOWN, which is reserved for "the crop DOES have a
 * configured preference but the warehouse's own range isn't known" (this
 * part's explicit "never treat unknown as compatible" rule cuts both
 * ways: an unconfigured crop preference is not a warehouse data gap).
 * FULL_MATCH means the warehouse's supported range fully contains the
 * crop's preferred range; PARTIAL_MATCH means the two ranges overlap but
 * the warehouse does not cover the crop's full preferred range; NO_MATCH
 * means the ranges do not overlap at all.
 */
export function compareRange(
  warehouseMin: number | null,
  warehouseMax: number | null,
  cropMin: number | null,
  cropMax: number | null,
): RangeComparisonOutcome {
  if (cropMin === null && cropMax === null) return "NOT_REQUIRED";
  if (!isFiniteNumber(cropMin) || !isFiniteNumber(cropMax)) return "UNKNOWN";
  if (!isFiniteNumber(warehouseMin) || !isFiniteNumber(warehouseMax)) return "UNKNOWN";
  if (cropMin > cropMax || warehouseMin > warehouseMax) return "UNKNOWN";

  const overlapStart = Math.max(warehouseMin, cropMin);
  const overlapEnd = Math.min(warehouseMax, cropMax);
  if (overlapEnd < overlapStart) return "NO_MATCH";

  const fullyContained = warehouseMin <= cropMin && warehouseMax >= cropMax;
  if (fullyContained) return "FULL_MATCH";

  const overlapWidth = overlapEnd - overlapStart;
  const cropWidth = cropMax - cropMin;
  // A single-point preferred range (cropMin === cropMax) that lies inside
  // the warehouse range only reaches here when fullyContained is already
  // true above, so cropWidth is always > 0 by this point.
  const overlapFraction = cropWidth > 0 ? overlapWidth / cropWidth : 0;
  return overlapFraction >= STORAGE_SUITABILITY_CONFIG.MIN_PARTIAL_OVERLAP_FRACTION ? "PARTIAL_MATCH" : "NO_MATCH";
}

/**
 * Deterministic boolean-capability comparison (build spec's exact truth
 * table): required+available -> SATISFIED, required+unavailable ->
 * UNSATISFIED, required+null -> UNKNOWN, not required (false/null) ->
 * NOT_REQUIRED regardless of warehouse data — a warehouse is never
 * penalized for a capability the crop doesn't explicitly need.
 */
export function compareBooleanRequirement(
  required: boolean | null,
  available: boolean | null,
): BooleanRequirementOutcome {
  if (required !== true) return "NOT_REQUIRED";
  if (available === true) return "SATISFIED";
  if (available === false) return "UNSATISFIED";
  return "UNKNOWN";
}

/**
 * Storage-type compatibility. An empty `compatibleStorageTypes` array
 * means the crop never had a storage-type restriction configured — the
 * factor is NOT_REQUIRED, never a false "incompatible with everything".
 */
export function compareStorageType(warehouseStorageType: string, compatibleStorageTypes: string[]): StorageTypeOutcome {
  if (compatibleStorageTypes.length === 0) return "NOT_REQUIRED";
  return compatibleStorageTypes.includes(warehouseStorageType) ? "COMPATIBLE" : "INCOMPATIBLE";
}

function factor(
  key: CriticalFactorKey,
  outcome: RangeComparisonOutcome | BooleanRequirementOutcome | StorageTypeOutcome,
  explanationCode: SuitabilityExplanationCode,
): SuitabilityFactorResult {
  return { factor: key, outcome, critical: isCriticalFactor(key), explanationCode };
}

function isUnmet(outcome: SuitabilityFactorResult["outcome"]): boolean {
  return outcome === "NO_MATCH" || outcome === "UNSATISFIED" || outcome === "INCOMPATIBLE";
}

function isOmitted(outcome: SuitabilityFactorResult["outcome"]): boolean {
  return outcome === "NOT_REQUIRED";
}

function isUnknownOutcome(outcome: SuitabilityFactorResult["outcome"]): boolean {
  return outcome === "UNKNOWN";
}

function isSatisfied(outcome: SuitabilityFactorResult["outcome"]): boolean {
  return outcome === "FULL_MATCH" || outcome === "PARTIAL_MATCH" || outcome === "SATISFIED" || outcome === "COMPATIBLE";
}

/**
 * Evaluates every applicable factor for one (crop requirement, warehouse
 * condition) pair and produces a single deterministic
 * StorageSuitabilityResult. Two callers of this exact function with the
 * exact same two inputs always get the exact same result (build spec:
 * "deterministic repeated evaluation").
 *
 * Status classification (centralized here, not scattered):
 *   1. Any critical factor UNMET            -> UNSUITABLE
 *   2. Else any critical factor UNKNOWN     -> UNKNOWN
 *   3. Else any non-critical UNMET/UNKNOWN  -> CONDITIONALLY_SUITABLE
 *   4. Else (every applicable factor met)   -> SUITABLE
 *
 * Confidence: null whenever the status is UNKNOWN (critical information
 * missing — build spec: "critical missing information -> low/null
 * confidence"); otherwise the fraction of applicable (non-omitted)
 * factors whose outcome was actually known, rounded to 2 decimals. Never
 * a probability of spoilage or storage success.
 */
export function evaluateStorageSuitability(
  requirement: CropStorageRequirementInput,
  conditions: StorageConditionsInput,
): StorageSuitabilityResult {
  const factors: SuitabilityFactorResult[] = [
    factor(
      "STORAGE_TYPE",
      compareStorageType(conditions.storageType, requirement.compatibleStorageTypes),
      "STORAGE_TYPE_COMPATIBLE", // placeholder, replaced below by explicit mapping
    ),
    factor(
      "TEMPERATURE_RANGE",
      compareRange(
        conditions.temperatureControlled ? conditions.minTemperature : null,
        conditions.temperatureControlled ? conditions.maxTemperature : null,
        requirement.preferredTemperatureMin,
        requirement.preferredTemperatureMax,
      ),
      "TEMPERATURE_RANGE_COMPATIBLE",
    ),
    factor(
      "HUMIDITY_RANGE",
      compareRange(
        conditions.humidityControlled ? conditions.minHumidity : null,
        conditions.humidityControlled ? conditions.maxHumidity : null,
        requirement.preferredHumidityMin,
        requirement.preferredHumidityMax,
      ),
      "HUMIDITY_RANGE_COMPATIBLE",
    ),
    factor(
      "COLD_STORAGE",
      compareBooleanRequirement(requirement.requiresColdStorage, conditions.coldStorageAvailable),
      "COLD_STORAGE_REQUIRED_AND_AVAILABLE",
    ),
    factor(
      "CONTROLLED_ATMOSPHERE",
      compareBooleanRequirement(requirement.requiresControlledAtmosphere, conditions.controlledAtmosphereAvailable),
      "CONTROLLED_ATMOSPHERE_REQUIRED_AND_AVAILABLE",
    ),
    factor(
      "VENTILATION",
      compareBooleanRequirement(requirement.requiresVentilation, conditions.ventilationAvailable),
      "VENTILATION_REQUIRED_AND_AVAILABLE",
    ),
    factor(
      "PEST_CONTROL",
      compareBooleanRequirement(requirement.requiresPestControl, conditions.pestControlAvailable),
      "PEST_CONTROL_REQUIRED_AND_AVAILABLE",
    ),
    factor(
      "MOISTURE_CONTROL",
      compareBooleanRequirement(requirement.requiresMoistureControl, conditions.moistureControlAvailable),
      "MOISTURE_CONTROL_REQUIRED_AND_AVAILABLE",
    ),
  ];

  // Deterministic explanation-code mapping per factor+outcome — kept as
  // one explicit table rather than string concatenation, so every code
  // emitted is one of storage-suitability.types.ts's own literal union.
  const EXPLANATION_MAP: Record<string, Partial<Record<string, SuitabilityExplanationCode>>> = {
    STORAGE_TYPE: {
      COMPATIBLE: "STORAGE_TYPE_COMPATIBLE",
      INCOMPATIBLE: "STORAGE_TYPE_INCOMPATIBLE",
      NOT_REQUIRED: "STORAGE_TYPE_NOT_RESTRICTED",
    },
    TEMPERATURE_RANGE: {
      FULL_MATCH: "TEMPERATURE_RANGE_COMPATIBLE",
      PARTIAL_MATCH: "TEMPERATURE_RANGE_PARTIALLY_COMPATIBLE",
      NO_MATCH: "TEMPERATURE_RANGE_INCOMPATIBLE",
      UNKNOWN: "TEMPERATURE_REQUIREMENT_UNKNOWN",
      NOT_REQUIRED: "TEMPERATURE_NOT_REQUIRED",
    },
    HUMIDITY_RANGE: {
      FULL_MATCH: "HUMIDITY_RANGE_COMPATIBLE",
      PARTIAL_MATCH: "HUMIDITY_RANGE_PARTIALLY_COMPATIBLE",
      NO_MATCH: "HUMIDITY_RANGE_INCOMPATIBLE",
      UNKNOWN: "HUMIDITY_REQUIREMENT_UNKNOWN",
      NOT_REQUIRED: "HUMIDITY_NOT_REQUIRED",
    },
    COLD_STORAGE: {
      SATISFIED: "COLD_STORAGE_REQUIRED_AND_AVAILABLE",
      UNSATISFIED: "COLD_STORAGE_REQUIRED_BUT_UNAVAILABLE",
      UNKNOWN: "COLD_STORAGE_REQUIREMENT_UNKNOWN",
      NOT_REQUIRED: "COLD_STORAGE_NOT_REQUIRED",
    },
    CONTROLLED_ATMOSPHERE: {
      SATISFIED: "CONTROLLED_ATMOSPHERE_REQUIRED_AND_AVAILABLE",
      UNSATISFIED: "CONTROLLED_ATMOSPHERE_REQUIRED_BUT_UNAVAILABLE",
      UNKNOWN: "CONTROLLED_ATMOSPHERE_REQUIREMENT_UNKNOWN",
      NOT_REQUIRED: "CONTROLLED_ATMOSPHERE_NOT_REQUIRED",
    },
    VENTILATION: {
      SATISFIED: "VENTILATION_REQUIRED_AND_AVAILABLE",
      UNSATISFIED: "VENTILATION_REQUIRED_BUT_UNAVAILABLE",
      UNKNOWN: "VENTILATION_REQUIREMENT_UNKNOWN",
      NOT_REQUIRED: "VENTILATION_NOT_REQUIRED",
    },
    PEST_CONTROL: {
      SATISFIED: "PEST_CONTROL_REQUIRED_AND_AVAILABLE",
      UNSATISFIED: "PEST_CONTROL_REQUIRED_BUT_UNAVAILABLE",
      UNKNOWN: "PEST_CONTROL_REQUIREMENT_UNKNOWN",
      NOT_REQUIRED: "PEST_CONTROL_NOT_REQUIRED",
    },
    MOISTURE_CONTROL: {
      SATISFIED: "MOISTURE_CONTROL_REQUIRED_AND_AVAILABLE",
      UNSATISFIED: "MOISTURE_CONTROL_REQUIRED_BUT_UNAVAILABLE",
      UNKNOWN: "MOISTURE_CONTROL_REQUIREMENT_UNKNOWN",
      NOT_REQUIRED: "MOISTURE_CONTROL_NOT_REQUIRED",
    },
  };

  for (const f of factors) {
    f.explanationCode = EXPLANATION_MAP[f.factor]?.[f.outcome] ?? f.explanationCode;
  }

  const requirementsChecked = factors.filter((f) => !isOmitted(f.outcome)).map((f) => f.factor);
  const satisfiedRequirements = factors.filter((f) => isSatisfied(f.outcome)).map((f) => f.factor);
  const unmetRequirements = factors.filter((f) => isUnmet(f.outcome)).map((f) => f.factor);
  const unknownRequirements = factors.filter((f) => isUnknownOutcome(f.outcome)).map((f) => f.factor);
  const omittedRequirements = factors.filter((f) => isOmitted(f.outcome)).map((f) => f.factor);

  const criticalUnmet = factors.some((f) => f.critical && isUnmet(f.outcome));
  const criticalUnknown = factors.some((f) => f.critical && isUnknownOutcome(f.outcome));
  const nonCriticalIssue = factors.some((f) => !f.critical && (isUnmet(f.outcome) || isUnknownOutcome(f.outcome)));

  let status: StorageSuitabilityResult["status"];
  if (criticalUnmet) {
    status = "UNSUITABLE";
  } else if (criticalUnknown) {
    status = "UNKNOWN";
  } else if (nonCriticalIssue) {
    status = "CONDITIONALLY_SUITABLE";
  } else {
    status = "SUITABLE";
  }

  let confidence: number | null;
  if (status === "UNKNOWN") {
    confidence = null;
  } else {
    const applicable = factors.filter((f) => !isOmitted(f.outcome));
    if (applicable.length === 0) {
      confidence = null;
    } else {
      const known = applicable.filter((f) => !isUnknownOutcome(f.outcome));
      confidence = Math.round((known.length / applicable.length) * 100) / 100;
    }
  }

  return {
    status,
    confidence,
    requirementsChecked,
    satisfiedRequirements,
    unmetRequirements,
    unknownRequirements,
    omittedRequirements,
    explanationCodes: factors.map((f) => f.explanationCode),
    disclaimer: SUITABILITY_DISCLAIMER,
  };
}

/** The honest UNKNOWN result returned when the crop has no configured
 * requirement row at all — never silently treated as SUITABLE (build
 * spec: "If a crop has no configured storage requirements, suitability
 * must be reported honestly as UNKNOWN"). */
export function insufficientCropRequirementsResult(): StorageSuitabilityResult {
  return {
    status: "UNKNOWN",
    confidence: null,
    requirementsChecked: [],
    satisfiedRequirements: [],
    unmetRequirements: [],
    unknownRequirements: [],
    omittedRequirements: [],
    explanationCodes: ["INSUFFICIENT_CROP_STORAGE_REQUIREMENTS"],
    disclaimer: SUITABILITY_DISCLAIMER,
  };
}

/** The honest UNKNOWN result returned when the warehouse has no active
 * storage units (no factual condition data to compare against at all). */
export function insufficientWarehouseConditionDataResult(): StorageSuitabilityResult {
  return {
    status: "UNKNOWN",
    confidence: null,
    requirementsChecked: [],
    satisfiedRequirements: [],
    unmetRequirements: [],
    unknownRequirements: [],
    omittedRequirements: [],
    explanationCodes: ["INSUFFICIENT_WAREHOUSE_CONDITION_DATA"],
    disclaimer: SUITABILITY_DISCLAIMER,
  };
}

/** Deterministic ranking used to pick the best result across a
 * warehouse's several storage units (see WarehouseSuitabilityService) —
 * SUITABLE is best, UNSUITABLE is worst, matching this part's "a farmer
 * only needs one suitable unit" framing while never hiding that other
 * units may have been worse. */
export const SUITABILITY_STATUS_RANK: Record<StorageSuitabilityResult["status"], number> = {
  SUITABLE: 0,
  CONDITIONALLY_SUITABLE: 1,
  UNKNOWN: 2,
  UNSUITABLE: 3,
};
