import { StorageType, WarehouseStatus } from "@prisma/client";
import { QUANTITY_ALIASES, QuantityUnit as BaseQuantityUnit, convertQuantityToKg } from "../fpo/unit-conversion";
import { ExternalWarehouseRecord, WarehouseProviderType } from "./providers/warehouse-data-provider";

// ---------------------------------------------------------------------------
// Provider-specific raw data -> canonical ExternalWarehouseRecord (done by
// each provider) -> THIS normalization step -> validation
// (warehouse-validation.service.ts) -> FarmLink-compatible Warehouse input.
//
// Nothing here invents a value. Every field that cannot be confidently
// parsed/converted becomes `null` plus a warning explaining why — never a
// guessed number, never a default coordinate, never an assumed unit. See
// the module's docs/modules/module-09-warehouse-intelligence.md
// "Normalization rules" section for the full policy this file implements.
// ---------------------------------------------------------------------------

export interface NormalizationIssue {
  field: string;
  code: string;
  message: string;
}

export interface NormalizedWarehouseRecord {
  externalId: string;
  source: { providerId: string; providerType: WarehouseProviderType };

  name: string | null;

  location: {
    address: string | null;
    village: string | null;
    district: string | null;
    state: string | null;
    pincode: string | null;
    latitude: number | null;
    longitude: number | null;
  };

  contact: { phone: string | null; email: string | null };

  /** null when the source supplied no capacity information at all (a
   * genuinely different fact from "supplied capacity but in a unit we
   * couldn't convert" — that case still produces a `null` capacity here,
   * but with a NORMALIZATION_FAILED warning attached so validation can
   * tell the two apart if it ever needs to). Always expressed in KG —
   * the same internal base unit the rest of this codebase's quantity
   * logic already standardizes on (see warehouse-capacity.ts's own
   * comment on this convention). */
  capacity: { totalKg: number | null; availableKg: number | null } | null;

  storageType: StorageType | null;
  temperatureControlled: boolean | null;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;

  /** null means "the source didn't report a status for this record" —
   * distinct from an explicit status the sync service should apply. Never
   * defaulted to ACTIVE here; the sync service is the one place that
   * decides what a null status means for a create vs. an update (see its
   * own comment on this). */
  status: WarehouseStatus | null;

  metadata: Record<string, unknown> | undefined;
  sourceUpdatedAt: Date | null;

  warnings: NormalizationIssue[];
}

function cleanString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parseNumeric(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Only strips thousands separators — never a currency symbol or unit
  // suffix, which would silently hide a malformed source value instead of
  // surfacing it as unparseable.
  const cleaned = trimmed.replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Known, explicit storage-type hints only — mirrors the same "small,
 * explicit set of forms; anything else is treated exactly like missing"
 * discipline unit-conversion.ts uses for yieldUnit strings. An
 * unrecognized hint returns `null`, never StorageType.OTHER — OTHER means
 * "a real, distinct type we just don't enumerate", which free text alone
 * can never confidently establish. */
const STORAGE_TYPE_ALIASES: Record<string, StorageType> = {
  AMBIENT: "AMBIENT",
  "COLD STORAGE": "COLD_STORAGE",
  "COLD-STORAGE": "COLD_STORAGE",
  COLDSTORAGE: "COLD_STORAGE",
  COLD: "COLD_STORAGE",
  REEFER: "COLD_STORAGE",
  "CONTROLLED ATMOSPHERE": "CONTROLLED_ATMOSPHERE",
  "CONTROLLED-ATMOSPHERE": "CONTROLLED_ATMOSPHERE",
  CA: "CONTROLLED_ATMOSPHERE",
  SILO: "SILO",
  SILOS: "SILO",
  GODOWN: "WAREHOUSE_GODOWN",
  WAREHOUSE: "WAREHOUSE_GODOWN",
  "WAREHOUSE GODOWN": "WAREHOUSE_GODOWN",
  "WAREHOUSE-GODOWN": "WAREHOUSE_GODOWN",
};

function normalizeStorageType(hint: string | null | undefined): StorageType | null {
  const cleaned = cleanString(hint);
  if (!cleaned) return null;
  return STORAGE_TYPE_ALIASES[cleaned.toUpperCase()] ?? null;
}

/** Small, explicit set of forms only — mirrors STORAGE_TYPE_ALIASES'S own
 * "case/whitespace variations handled safely, anything else treated
 * exactly like absent" discipline. An unrecognized status string is
 * dropped to `null` (never guessed as ACTIVE) with a warning, so a typo'd
 * or unexpected source value never silently activates/deactivates a
 * warehouse. */
const STATUS_ALIASES: Record<string, WarehouseStatus> = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  SUSPENDED: "SUSPENDED",
};

function normalizeStatus(raw: string | null | undefined, warnings: NormalizationIssue[]): WarehouseStatus | null {
  const cleaned = cleanString(raw);
  if (!cleaned) return null;
  const resolved = STATUS_ALIASES[cleaned.toUpperCase()];
  if (!resolved) {
    warnings.push({
      field: "status",
      code: "UNRECOGNIZED_STATUS",
      message: `Status "${raw}" is not one of Active/Inactive/Suspended; the warehouse's existing/default status was left unchanged.`,
    });
    return null;
  }
  return resolved;
}

/** Resolves a free-text capacity unit against the exact same canonical
 * alias table Module 3's crop-quantity aggregation already trusts
 * (QUANTITY_ALIASES) — deliberately not a second, possibly-conflicting
 * conversion table (Part 7's explicit "do not create a second conflicting
 * conversion system" requirement). Bags, crates, and any other
 * count-based unit are intentionally absent from that table: there is no
 * fixed weight-per-bag this codebase could apply without guessing. */
function resolveCapacityUnit(raw: string | null | undefined): BaseQuantityUnit | null {
  const cleaned = cleanString(raw);
  if (!cleaned) return null;
  const key = cleaned.toUpperCase().replace(/\s+/g, "");
  return QUANTITY_ALIASES[key] ?? null;
}

function normalizeCapacity(
  storage: ExternalWarehouseRecord["storage"],
  warnings: NormalizationIssue[],
): NormalizedWarehouseRecord["capacity"] {
  if (!storage || (storage.totalCapacity == null && storage.availableCapacity == null)) return null;

  const unit = resolveCapacityUnit(storage.capacityUnit);
  if (!unit) {
    warnings.push({
      field: "capacityUnit",
      code: "UNSUPPORTED_CAPACITY_UNIT",
      message: `Capacity unit "${storage.capacityUnit ?? ""}" is not a supported weight unit; capacity was dropped rather than guessed.`,
    });
    return { totalKg: null, availableKg: null };
  }

  const total = parseNumeric(storage.totalCapacity);
  const available = parseNumeric(storage.availableCapacity);

  if (storage.totalCapacity != null && total === null) {
    warnings.push({ field: "totalCapacity", code: "UNPARSEABLE_NUMBER", message: `Could not parse totalCapacity "${storage.totalCapacity}".` });
  }
  if (storage.availableCapacity != null && available === null) {
    warnings.push({ field: "availableCapacity", code: "UNPARSEABLE_NUMBER", message: `Could not parse availableCapacity "${storage.availableCapacity}".` });
  }

  return {
    totalKg: total === null ? null : convertQuantityToKg(total, unit),
    availableKg: available === null ? null : convertQuantityToKg(available, unit),
  };
}

function normalizeTemperature(raw: string | null | undefined, field: string, warnings: NormalizationIssue[]): number | null {
  if (raw == null) return null;
  const parsed = parseNumeric(raw);
  if (parsed === null) {
    warnings.push({ field, code: "UNPARSEABLE_NUMBER", message: `Could not parse ${field} "${raw}".` });
  }
  return parsed;
}

function normalizeLatLng(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Pure, deterministic transform — no I/O, no database, no exceptions.
 * Anything unparseable/unsupported is dropped to `null` with a warning
 * explaining why; the caller (warehouse-validation.service.ts) decides
 * whether the resulting record is still usable.
 */
export function normalizeExternalWarehouseRecord(record: ExternalWarehouseRecord): NormalizedWarehouseRecord {
  const warnings: NormalizationIssue[] = [];

  return {
    externalId: record.externalId,
    source: { providerId: record.source.providerId, providerType: record.source.providerType },
    name: cleanString(record.name),
    location: {
      address: cleanString(record.location.address),
      village: cleanString(record.location.village),
      district: cleanString(record.location.district),
      state: cleanString(record.location.state),
      pincode: cleanString(record.location.pincode),
      latitude: normalizeLatLng(record.location.latitude),
      longitude: normalizeLatLng(record.location.longitude),
    },
    contact: {
      phone: cleanString(record.contact?.phone),
      email: cleanString(record.contact?.email),
    },
    capacity: normalizeCapacity(record.storage, warnings),
    storageType: normalizeStorageType(record.storage?.storageType),
    temperatureControlled: record.storage?.temperatureControlled ?? null,
    minTemperatureC: normalizeTemperature(record.storage?.minimumTemperature, "minimumTemperature", warnings),
    maxTemperatureC: normalizeTemperature(record.storage?.maximumTemperature, "maximumTemperature", warnings),
    status: normalizeStatus(record.status, warnings),
    metadata: record.metadata,
    sourceUpdatedAt: record.sourceUpdatedAt ?? null,
    warnings,
  };
}
