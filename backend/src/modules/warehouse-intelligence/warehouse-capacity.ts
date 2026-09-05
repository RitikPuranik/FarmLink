import { QuantityUnit, CropStorageCompatibility } from "@prisma/client";
import { convertQuantityToKg } from "../fpo/unit-conversion";
import { WAREHOUSE_INTELLIGENCE_CONFIG } from "./warehouse-intelligence.config";

// ---------------------------------------------------------------------------
// Module 9 Part 2 — pure, deterministic capacity domain functions.
//
// Everything here operates on plain numbers already normalized to KG (see
// toKg()/aggregateStorageUnitsToKg() below) — the same "internal
// normalization unit is KG" convention modules/fpo/unit-conversion.ts
// established for Module 3's aggregation math and that this schema's own
// QuantityUnit comment documents. Converting KG <-> QTL <-> TONNE is a
// fixed, unambiguous factor already trusted elsewhere in this codebase
// (crops/lots/buyer-matching all convert through it) — this is not the
// "silent ambiguous unit conversion" the build spec warns against; that
// warning is about inventing conversions between incompatible unit
// *systems* (e.g. weight vs. volume), which never happens here because
// QuantityUnit only ever expresses weight.
//
// No function here reads or writes the database, sleeps, or throws for
// business reasons — invalid/missing input is always represented as
// `null`/"UNAVAILABLE"/"UNKNOWN", never guessed at. Callers (the service
// layer) decide whether a null result becomes a 4xx.
// ---------------------------------------------------------------------------

export type CapacityStatus = "AVAILABLE" | "LIMITED" | "FULL" | "UNAVAILABLE";
export type CropCompatibilityState = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";

export interface StorageUnitCapacityInput {
  totalCapacity: number;
  availableCapacity: number;
  capacityUnit: QuantityUnit;
  isActive: boolean;
}

export interface AggregatedCapacityKg {
  totalKg: number;
  availableKg: number;
  /** How many active storage units contributed to this total — surfaced so
   * callers/tests can tell "zero capacity because 1 empty unit" apart from
   * "zero capacity because there are no active units at all". */
  unitCount: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** KG <-> KG/QTL/TONNE conversion for a single capacity figure. Never
 * called with anything outside the QuantityUnit enum — Zod/Prisma already
 * closed that door before this function ever runs. */
export function toKg(value: number, unit: QuantityUnit): number {
  return convertQuantityToKg(value, unit);
}

/**
 * Aggregates a warehouse's active storage units into a single KG figure.
 * Returns null — not zero — when there are no active storage units at
 * all, so "no configured capacity" is never confused with "configured,
 * zero capacity" (build spec: "a missing capacity configuration should be
 * represented honestly as unavailable/unknown").
 */
export function aggregateStorageUnitsToKg(units: StorageUnitCapacityInput[]): AggregatedCapacityKg | null {
  const active = units.filter((u) => u.isActive);
  if (active.length === 0) return null;

  let totalKg = 0;
  let availableKg = 0;
  for (const unit of active) {
    if (!isFiniteNumber(unit.totalCapacity) || !isFiniteNumber(unit.availableCapacity)) continue;
    totalKg += toKg(unit.totalCapacity, unit.capacityUnit);
    availableKg += toKg(unit.availableCapacity, unit.capacityUnit);
  }

  return { totalKg: round2(totalKg), availableKg: round2(availableKg), unitCount: active.length };
}

/**
 * Utilization = occupied / total * 100, clamped to [0, 100]. Returns null
 * for a missing/zero/negative total or a non-finite available figure —
 * "0 / 0" is not 0% utilized, it is undefined, and must not be reported as
 * a confident number.
 */
export function calculateUtilizationPercentage(totalKg: number | null, availableKg: number | null): number | null {
  if (!isFiniteNumber(totalKg) || totalKg <= 0) return null;
  if (!isFiniteNumber(availableKg)) return null;

  const occupiedKg = totalKg - availableKg;
  const percentage = (occupiedKg / totalKg) * 100;
  return round2(Math.max(0, Math.min(100, percentage)));
}

/**
 * Deterministic AVAILABLE / LIMITED / FULL / UNAVAILABLE classification.
 * UNAVAILABLE covers both "no capacity configured at all" (totalKg null)
 * and "configured with zero/invalid total" — both mean the same thing to
 * a caller deciding whether to trust this warehouse's numbers.
 */
export function capacityStatus(
  totalKg: number | null,
  availableKg: number | null,
  limitedThresholdPercent: number = WAREHOUSE_INTELLIGENCE_CONFIG.LIMITED_UTILIZATION_THRESHOLD_PERCENT,
): CapacityStatus {
  if (!isFiniteNumber(totalKg) || totalKg <= 0 || !isFiniteNumber(availableKg)) return "UNAVAILABLE";
  if (availableKg <= 0) return "FULL";

  const utilization = calculateUtilizationPercentage(totalKg, availableKg);
  if (utilization === null) return "UNAVAILABLE";
  return utilization >= limitedThresholdPercent ? "LIMITED" : "AVAILABLE";
}

/**
 * Exact-fit counts as accommodating (>=), matching CropLot's own
 * available-quantity comparison convention elsewhere in this codebase.
 * A null/non-finite availableKg (no configured capacity) or a
 * non-positive requested quantity always returns false — never "assume it
 * fits" (build spec: "never fabricate availability").
 */
export function canAccommodateQuantity(availableKg: number | null, requestedKg: number): boolean {
  if (!isFiniteNumber(availableKg)) return false;
  if (!isFiniteNumber(requestedKg) || requestedKg <= 0) return false;
  return availableKg >= requestedKg;
}

/**
 * Resolves configured (never inferred) crop/storage compatibility for one
 * warehouse. `rows` should already be scoped to (warehouseId, cropId) —
 * see WarehouseCapabilityRepository.findCompatible()'s sibling query for
 * the non-compatible case, or listByWarehouse() filtered by cropId.
 *
 * Resolution order when both exist: a storage-unit-scoped row overrides
 * the warehouse-wide (storageUnitId null) row for that specific unit —
 * documented here since Part 1 left "picking between them" as future
 * logic (see WarehouseCropCapability's own schema comment). NOT_RECOMMENDED
 * is mapped to UNSUPPORTED for hard fit/no-fit gating (a configured "don't
 * use this" is not a green light), while its original enum value is still
 * exposed to callers via the raw row so nothing configured is discarded.
 * No matching row at all -> UNKNOWN, which must never be upgraded to
 * SUPPORTED by a caller.
 */
export function resolveCropCompatibility(
  rows: Array<{ storageUnitId: string | null; compatibility: CropStorageCompatibility }>,
  storageUnitId?: string | null,
): CropCompatibilityState {
  const unitScoped = storageUnitId ? rows.find((r) => r.storageUnitId === storageUnitId) : undefined;
  const warehouseWide = rows.find((r) => r.storageUnitId === null);
  const resolved = unitScoped ?? warehouseWide;

  if (!resolved) return "UNKNOWN";
  return resolved.compatibility === "COMPATIBLE" ? "SUPPORTED" : "UNSUPPORTED";
}

/**
 * Module 9 Part 4 — resolves the configured maximum storage duration for
 * a (warehouse, crop) pair from the same WarehouseCropCapability rows
 * resolveCropCompatibility() above already reads, using the identical
 * unit-scoped-overrides-warehouse-wide resolution order (see that
 * function's own comment) rather than a second, differently-ordered
 * lookup. Returns null — never a fabricated default — when no row
 * configures a duration for this pair, exactly like maxStorageDurationDays
 * itself already returns null on the raw row.
 */
export function resolveMaxStorageDurationDays(
  rows: Array<{ storageUnitId: string | null; maxStorageDurationDays: number | null }>,
  storageUnitId?: string | null,
): number | null {
  const unitScoped = storageUnitId ? rows.find((r) => r.storageUnitId === storageUnitId) : undefined;
  const warehouseWide = rows.find((r) => r.storageUnitId === null);
  const resolved = unitScoped ?? warehouseWide;
  return resolved?.maxStorageDurationDays ?? null;
}

/**
 * Shared degrees-per-km approximation (~111 km per degree of latitude) —
 * the same one Module 6's own nearby-market search uses. Extracted here
 * (Part 5) so both this module's own nearby-warehouse search (Part 2's
 * WarehouseAvailabilityService.searchNearby) and the recommendation
 * engine's candidate discovery (Part 5) read one formula instead of two
 * copies that could silently drift apart.
 */
export function computeBoundingBox(
  latitude: number,
  longitude: number,
  radiusKm: number,
): { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number } {
  const degreeDelta = radiusKm / 111;
  return {
    minLatitude: latitude - degreeDelta,
    maxLatitude: latitude + degreeDelta,
    minLongitude: longitude - degreeDelta,
    maxLongitude: longitude + degreeDelta,
  };
}
