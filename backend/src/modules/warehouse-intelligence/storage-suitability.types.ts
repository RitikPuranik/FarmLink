import { StorageType } from "@prisma/client";
import { CriticalFactorKey } from "./warehouse-intelligence.config";

// ---------------------------------------------------------------------------
// Module 9 Part 3 — plain, database-free types for the deterministic
// storage suitability engine. Mirrors warehouse-capacity.ts's own
// "everything here operates on plain values already resolved by the
// caller" discipline: nothing in this file or storage-suitability.engine.ts
// reads Prisma, sleeps, calls an AI provider, or predicts spoilage.
// ---------------------------------------------------------------------------

export type SuitabilityStatus = "SUITABLE" | "CONDITIONALLY_SUITABLE" | "UNSUITABLE" | "UNKNOWN";

export type RangeComparisonOutcome = "FULL_MATCH" | "PARTIAL_MATCH" | "NO_MATCH" | "UNKNOWN" | "NOT_REQUIRED";

export type BooleanRequirementOutcome = "SATISFIED" | "UNSATISFIED" | "UNKNOWN" | "NOT_REQUIRED";

export type StorageTypeOutcome = "COMPATIBLE" | "INCOMPATIBLE" | "NOT_REQUIRED";

/**
 * Explicit, configured crop-side requirement (see CropStorageRequirement).
 * `null` on any preferred-range/requires-* field means "never explicitly
 * configured" and must be treated as OMITTED/NOT_REQUIRED by the engine —
 * never coerced to a default. `compatibleStorageTypes: []` means "no
 * storage-type restriction was configured", not "compatible with none".
 */
export interface CropStorageRequirementInput {
  preferredTemperatureMin: number | null;
  preferredTemperatureMax: number | null;
  preferredHumidityMin: number | null;
  preferredHumidityMax: number | null;
  requiresVentilation: boolean | null;
  requiresColdStorage: boolean | null;
  requiresControlledAtmosphere: boolean | null;
  requiresPestControl: boolean | null;
  requiresMoistureControl: boolean | null;
  compatibleStorageTypes: StorageType[];
  maximumRecommendedStorageDays: number | null;
}

/**
 * Factual, configured warehouse/storage-unit conditions (see
 * WarehouseStorageUnit). Every boolean here is `boolean | null` for the
 * same "null = unknown, never assumed false" reason as the requirement
 * input above — see the schema's own comment on these columns.
 */
export interface StorageConditionsInput {
  storageType: StorageType;
  temperatureControlled: boolean;
  minTemperature: number | null;
  maxTemperature: number | null;
  humidityControlled: boolean;
  minHumidity: number | null;
  maxHumidity: number | null;
  ventilationAvailable: boolean | null;
  coldStorageAvailable: boolean | null;
  controlledAtmosphereAvailable: boolean | null;
  pestControlAvailable: boolean | null;
  moistureControlAvailable: boolean | null;
}

/** One deterministic explanation code per factor the engine evaluated —
 * never freeform/AI-generated text (this part's explicit "use
 * deterministic explanation codes/templates" instruction). */
export type SuitabilityExplanationCode =
  | "STORAGE_TYPE_COMPATIBLE"
  | "STORAGE_TYPE_INCOMPATIBLE"
  | "STORAGE_TYPE_NOT_RESTRICTED"
  | "TEMPERATURE_RANGE_COMPATIBLE"
  | "TEMPERATURE_RANGE_PARTIALLY_COMPATIBLE"
  | "TEMPERATURE_RANGE_INCOMPATIBLE"
  | "TEMPERATURE_REQUIREMENT_UNKNOWN"
  | "TEMPERATURE_NOT_REQUIRED"
  | "HUMIDITY_RANGE_COMPATIBLE"
  | "HUMIDITY_RANGE_PARTIALLY_COMPATIBLE"
  | "HUMIDITY_RANGE_INCOMPATIBLE"
  | "HUMIDITY_REQUIREMENT_UNKNOWN"
  | "HUMIDITY_NOT_REQUIRED"
  | "COLD_STORAGE_REQUIRED_AND_AVAILABLE"
  | "COLD_STORAGE_REQUIRED_BUT_UNAVAILABLE"
  | "COLD_STORAGE_REQUIREMENT_UNKNOWN"
  | "COLD_STORAGE_NOT_REQUIRED"
  | "CONTROLLED_ATMOSPHERE_REQUIRED_AND_AVAILABLE"
  | "CONTROLLED_ATMOSPHERE_REQUIRED_BUT_UNAVAILABLE"
  | "CONTROLLED_ATMOSPHERE_REQUIREMENT_UNKNOWN"
  | "CONTROLLED_ATMOSPHERE_NOT_REQUIRED"
  | "VENTILATION_REQUIRED_AND_AVAILABLE"
  | "VENTILATION_REQUIRED_BUT_UNAVAILABLE"
  | "VENTILATION_REQUIREMENT_UNKNOWN"
  | "VENTILATION_NOT_REQUIRED"
  | "PEST_CONTROL_REQUIRED_AND_AVAILABLE"
  | "PEST_CONTROL_REQUIRED_BUT_UNAVAILABLE"
  | "PEST_CONTROL_REQUIREMENT_UNKNOWN"
  | "PEST_CONTROL_NOT_REQUIRED"
  | "MOISTURE_CONTROL_REQUIRED_AND_AVAILABLE"
  | "MOISTURE_CONTROL_REQUIRED_BUT_UNAVAILABLE"
  | "MOISTURE_CONTROL_REQUIREMENT_UNKNOWN"
  | "MOISTURE_CONTROL_NOT_REQUIRED"
  | "INSUFFICIENT_CROP_STORAGE_REQUIREMENTS"
  | "INSUFFICIENT_WAREHOUSE_CONDITION_DATA";

/** Every factor the engine can evaluate, one entry each — used to build
 * requirementsChecked/satisfied/unmet/unknown/omitted without repeating
 * the same string literal at every call site. */
export interface SuitabilityFactorResult {
  factor: CriticalFactorKey;
  outcome: RangeComparisonOutcome | BooleanRequirementOutcome | StorageTypeOutcome;
  critical: boolean;
  explanationCode: SuitabilityExplanationCode;
}

/**
 * The engine's full, structured result for one (crop requirement,
 * warehouse/storage-unit conditions) pair. Mirrors the build spec's
 * "Suitability Result" contract. `disclaimer` is a fixed, deterministic
 * string (never AI-generated) reiterating that this is a configured-data
 * comparison, not a spoilage prediction or storage guarantee.
 */
export interface StorageSuitabilityResult {
  status: SuitabilityStatus;
  confidence: number | null;
  requirementsChecked: CriticalFactorKey[];
  satisfiedRequirements: CriticalFactorKey[];
  unmetRequirements: CriticalFactorKey[];
  unknownRequirements: CriticalFactorKey[];
  omittedRequirements: CriticalFactorKey[];
  explanationCodes: SuitabilityExplanationCode[];
  disclaimer: string;
}

export const SUITABILITY_DISCLAIMER =
  "This is a deterministic compatibility check between configured warehouse conditions and configured crop " +
  "storage requirements. It is not a spoilage prediction, a storage guarantee, or an AI recommendation.";
