import { NormalizedWarehouseRecord } from "./warehouse-normalization.service";

// ---------------------------------------------------------------------------
// Runs strictly after normalization (Part 8). A record failing validation
// here is skipped by warehouse-sync.service.ts for THIS record only — it
// never rolls back or aborts the rest of the sync run (Part 14).
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
}

export type ValidationLevel = "VALID" | "PARTIAL" | "INVALID";

export interface WarehouseValidationResult {
  level: ValidationLevel;
  record: NormalizedWarehouseRecord;
  /** Non-blocking: present on both VALID and PARTIAL results (e.g. a
   * normalization-stage warning about a dropped capacity unit still shows
   * up here even though the record as a whole is persistable). */
  warnings: ValidationIssue[];
  /** Present only when level is INVALID — the reasons persistence was
   * refused outright. */
  errors: ValidationIssue[];
}

const PINCODE_PATTERN = /^\d{6}$/;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates one normalized record. Missing OPTIONAL fields (coordinates,
 * capacity, contact, storage conditions) never fail validation on their
 * own — only genuinely inconsistent or out-of-range data does (Part 8:
 * "do not reject the entire warehouse simply because optional coordinates
 * are missing").
 */
export function validateNormalizedWarehouseRecord(record: NormalizedWarehouseRecord): WarehouseValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [...record.warnings.map((w) => ({ field: w.field, code: w.code, message: w.message }))];

  // ---- Required identity -------------------------------------------------
  if (!record.externalId.trim()) {
    errors.push({ field: "externalId", code: "MISSING_EXTERNAL_ID", message: "A provider record must have a stable external id." });
  }
  if (!record.source.providerId.trim()) {
    errors.push({ field: "source.providerId", code: "MISSING_PROVIDER_ID", message: "A provider record must identify its provider." });
  }
  if (!record.name) {
    // A name-less warehouse can still be identified by its source/external
    // id for provenance purposes, but is not safe to surface in search —
    // treated as a hard requirement, same as the existing Warehouse.name
    // NOT NULL column already enforces for FarmLink-created warehouses.
    errors.push({ field: "name", code: "MISSING_NAME", message: "Warehouse name is required." });
  }
  if (!record.location.state || !record.location.district) {
    errors.push({ field: "location", code: "MISSING_STATE_OR_DISTRICT", message: "State and district are required." });
  }

  // ---- Location -----------------------------------------------------------
  const { latitude, longitude } = record.location;
  if ((latitude === null) !== (longitude === null)) {
    errors.push({ field: "location", code: "INCOMPLETE_COORDINATES", message: "Latitude and longitude must both be present or both be absent." });
  } else if (latitude !== null && longitude !== null) {
    if (Math.abs(latitude) > 90) errors.push({ field: "location.latitude", code: "INVALID_LATITUDE", message: "Latitude must be between -90 and 90." });
    if (Math.abs(longitude) > 180) errors.push({ field: "location.longitude", code: "INVALID_LONGITUDE", message: "Longitude must be between -180 and 180." });
  }
  if (record.location.pincode && !PINCODE_PATTERN.test(record.location.pincode)) {
    // Non-fatal: an unparseable pincode is dropped by the sync service at
    // persistence time, never used to reject the whole record.
    warnings.push({ field: "location.pincode", code: "INVALID_PINCODE_FORMAT", message: "Pincode is not a valid 6-digit PIN code; it will be ignored." });
  }

  // ---- Capacity -------------------------------------------------------------
  if (record.capacity) {
    const { totalKg, availableKg } = record.capacity;
    for (const [field, value] of [
      ["capacity.totalKg", totalKg],
      ["capacity.availableKg", availableKg],
    ] as const) {
      if (value !== null && (!isFiniteNumber(value) || value < 0)) {
        errors.push({ field, code: "INVALID_CAPACITY", message: `${field} must be a non-negative finite number.` });
      }
    }
    if (isFiniteNumber(totalKg) && isFiniteNumber(availableKg) && availableKg > totalKg) {
      errors.push({ field: "capacity.availableKg", code: "INVALID_CAPACITY", message: "Available capacity cannot exceed total capacity." });
    }
  }

  // ---- Storage / temperature ------------------------------------------------
  if (record.minTemperatureC !== null && record.maxTemperatureC !== null && record.minTemperatureC > record.maxTemperatureC) {
    errors.push({
      field: "minTemperatureC",
      code: "INVALID_TEMPERATURE_RANGE",
      message: "Minimum temperature must not exceed maximum temperature.",
    });
  }

  if (errors.length) {
    return { level: "INVALID", record, warnings, errors };
  }
  return { level: warnings.length ? "PARTIAL" : "VALID", record, warnings, errors };
}
