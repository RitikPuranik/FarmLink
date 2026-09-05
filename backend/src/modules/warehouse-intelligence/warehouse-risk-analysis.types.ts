import { CropCompatibilityState, CapacityStatus } from "./warehouse-capacity";
import { SuitabilityStatus } from "./storage-suitability.types";
import { AnalysisFactorKey } from "./warehouse-intelligence.config";

// ---------------------------------------------------------------------------
// Module 9 Part 4 — Warehouse Suitability & Risk Analysis. Composes:
//   - Part 1's WarehouseCropCapability (crop compatibility, configured
//     max storage duration)
//   - Part 2's capacity/availability logic (WarehouseAvailabilityService)
//   - Part 3's environmental-suitability engine (temperature/humidity/
//     boolean capability comparison)
//   - a new warehouse-operational-status check and duration-limit check
// into one deterministic, explainable result. Reuses Part 3's own
// SuitabilityStatus type ("Use existing enums if they already exist" —
// see the build spec's own instruction) rather than inventing a parallel
// SUITABLE/CONDITIONALLY_SUITABLE/UNSUITABLE/INSUFFICIENT_DATA enum;
// Part 3's UNKNOWN plays exactly the role this part's spec calls
// INSUFFICIENT_DATA.
// ---------------------------------------------------------------------------

export type DurationCompatibilityOutcome = "SUPPORTED" | "EXCEEDS_MAXIMUM" | "NOT_APPLICABLE";

export type OperationalStatusOutcome = "OPERATIONAL" | "UNAVAILABLE";

export type RiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RiskCode =
  | "CROP_INCOMPATIBILITY"
  | "CROP_COMPATIBILITY_UNKNOWN"
  | "CAPACITY_CONSTRAINT"
  | "LIMITED_CAPACITY"
  | "CAPACITY_DATA_UNAVAILABLE"
  | "DURATION_LIMIT_EXCEEDED"
  | "WAREHOUSE_UNAVAILABLE"
  | "ENVIRONMENTAL_INCOMPATIBILITY"
  | "ENVIRONMENTAL_CONSTRAINT"
  | "ENVIRONMENTAL_DATA_UNKNOWN"
  | "WAREHOUSE_DATA_INCOMPLETE";

export interface WarehouseRisk {
  code: RiskCode;
  severity: RiskSeverity;
  blocking: boolean;
  explanation: string;
}

export type ConstraintCode =
  | "QUANTITY_EXCEEDS_AVAILABLE_CAPACITY"
  | "MAXIMUM_STORAGE_DURATION_EXCEEDED"
  | "CROP_EXPLICITLY_UNSUPPORTED"
  | "ENVIRONMENTAL_COMPATIBILITY_UNVERIFIED"
  | "WAREHOUSE_OPERATIONALLY_UNAVAILABLE";

export interface WarehouseConstraint {
  code: ConstraintCode;
  blocking: boolean;
  explanation: string;
}

export interface AvailabilitySummary {
  status: CapacityStatus;
  totalKg: number | null;
  availableKg: number | null;
  canAccommodate: boolean | null;
}

export interface WarehouseSuitabilityAnalysisInput {
  cropId: string;
  requestedQuantity?: { value: number; unit: "KG" | "QTL" | "TONNE" };
  requestedDurationDays?: number;
  /** Optional, already-resolved lot context — this part deliberately
   * does not reach into a CropLotRepository itself (see the module doc
   * for why); a future caller (e.g. Module 8) that already has the lot
   * loaded can pass its cropId/quantity/duration context in through the
   * fields above instead. */
}

export interface WarehouseSuitabilityAnalysisResult {
  warehouseId: string;
  cropId: string;
  suitability: SuitabilityStatus;
  suitabilityScore: number | null;
  confidence: number | null;

  blockingIssues: Array<WarehouseRisk | WarehouseConstraint>;
  risks: WarehouseRisk[];
  constraints: WarehouseConstraint[];

  factorsUsed: AnalysisFactorKey[];
  omittedFactors: AnalysisFactorKey[];

  cropCompatibility: CropCompatibilityState;
  durationCompatibility: DurationCompatibilityOutcome;
  environmentalCompatibility: SuitabilityStatus;
  operationalStatus: OperationalStatusOutcome;

  availabilitySummary: AvailabilitySummary;

  evaluatedAt: string;
  disclaimer: string;
}

export const RISK_ANALYSIS_DISCLAIMER =
  "This is a deterministic analysis of configured, persisted warehouse and crop data. It is not a spoilage " +
  "prediction, a storage guarantee, or an AI recommendation, and does not guarantee actual warehouse availability " +
  "at the time of storage.";
