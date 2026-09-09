import { ExternalWarehouseRecord } from "./warehouse-data-provider";

// ---------------------------------------------------------------------------
// FCI/IISFM (https://api.iisfm.nic.in/DepotsWithCap) response shape.
//
// IMPORTANT — read before touching this file: the exact JSON casing/shape
// this live endpoint returns could not be confirmed from the environment
// this importer was built in. A direct fetch of the endpoint was refused
// by its robots.txt, and no public documentation of this specific
// endpoint's response body could be located. Rather than guess a single
// shape and silently mis-map every field if that guess is wrong, this
// mapper is deliberately tolerant: it accepts several plausible top-level
// wrapper shapes and several plausible per-field key-casing conventions
// (the exact "Depot Code"/"Depot Name" spacing this task's own field
// list uses, common PascalCase/camelCase/snake_case variants NIC APIs
// use elsewhere, e.g. api.iisfm.nic.in/Comapi/Commodities). If the real
// response uses a casing not covered here, `parseFciDepotsResponse` will
// report it as an issue instead of returning zero silently-wrong records
// — see fci-iisfm-warehouse-provider.ts, which surfaces that as a FAILED
// provider result rather than fabricating data.
//
// The fixture this mapper is tested against
// (tests/fixtures/fci-iisfm-depots-with-cap.fixture.json) is built from
// this task's own documented field list, NOT a live capture — its own
// header comment says so. The day a live response is actually observed,
// replace that fixture with the real capture and this mapper's key list
// can be trimmed to match.
// ---------------------------------------------------------------------------

export interface FciDepotsParseResult {
  records: Record<string, unknown>[];
  issues: string[];
}

const WRAPPER_KEYS = ["data", "Data", "records", "Records", "result", "Result", "Depots", "depots", "DepotsWithCap"];

/**
 * Unwraps whatever top-level shape the response used down to a plain
 * array of depot objects. Accepts a bare array, or an array nested one
 * level under a conventional wrapper key. Anything else is reported as
 * an issue and returns zero records — never a guessed unwrap.
 */
export function parseFciDepotsResponse(raw: unknown): FciDepotsParseResult {
  const issues: string[] = [];

  let candidateArray: unknown;
  if (Array.isArray(raw)) {
    candidateArray = raw;
  } else if (raw && typeof raw === "object") {
    candidateArray = WRAPPER_KEYS.map((key) => (raw as Record<string, unknown>)[key]).find((value) => Array.isArray(value));
  }

  if (!Array.isArray(candidateArray)) {
    issues.push("FCI/IISFM response did not contain a recognizable array of depot records (checked the top level and common wrapper keys).");
    return { records: [], issues };
  }

  const records: Record<string, unknown>[] = [];
  for (const entry of candidateArray) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      records.push(entry as Record<string, unknown>);
    } else {
      issues.push("Skipped a non-object entry in the FCI/IISFM depot list.");
    }
  }
  return { records, issues };
}

function firstDefined(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  // Case-insensitive & symbol-insensitive fallback for resilient mapping
  const rowKeys = Object.keys(row);
  for (const key of keys) {
    const target = key.toLowerCase().replace(/[\s_]/g, "");
    const matchedKey = rowKeys.find((k) => k.toLowerCase().replace(/[\s_]/g, "") === target);
    if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && row[matchedKey] !== "") {
      return row[matchedKey];
    }
  }
  return undefined;
}

function textOf(row: Record<string, unknown>, keys: string[]): string | null {
  const value = firstDefined(row, keys);
  if (value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

const DEPOT_CODE_KEYS = ["Depot_Code", "Depot Code", "DepotCode", "depotCode", "depot_code", "DEPOT_CODE", "depotcode", "Code", "code"];
const DEPOT_NAME_KEYS = ["Depot_Name", "Depot Name", "DepotName", "depotName", "depot_name", "DEPOT_NAME", "depotname", "Name", "name"];
const REVENUE_STATE_KEYS = ["RevenueStateName", "Revenue State", "RevenueState", "revenueState", "revenue_state", "REVENUE_STATE", "State", "state"];
const REVENUE_DISTRICT_KEYS = ["RevenueDistrict", "Revenue District", "revenueDistrict", "revenue_district", "REVENUE_DISTRICT", "District", "district"];
const TOTAL_CAPACITY_KEYS = ["TotCap", "Total Capacity", "TotalCapacity", "totalCapacity", "total_capacity", "TOTAL_CAPACITY"];
const COVERED_CAPACITY_KEYS = ["CapCovered", "Covered Capacity", "CoveredCapacity", "coveredCapacity", "covered_capacity", "COVERED_CAPACITY"];
const OPEN_CAPACITY_KEYS = ["CapOpen", "Open Capacity", "OpenCapacity", "openCapacity", "open_capacity", "OPEN_CAPACITY"];
// No unit field is documented for this endpoint. Rather than assume MT
// (a reasonable but unconfirmed domain guess), this mapper only ever
// treats a capacity as having a resolvable unit if the response itself
// names one — otherwise capacityUnit stays null and the shared
// normalization layer drops the capacity with an UNSUPPORTED_CAPACITY_UNIT
// warning (visible, honest, never fabricated) rather than silently
// treating an unconfirmed number as tonnes.
const CAPACITY_UNIT_KEYS = ["Capacity Unit", "CapacityUnit", "capacityUnit", "capacity_unit", "Unit", "unit"];

/**
 * Maps one raw depot object (already unwrapped by parseFciDepotsResponse)
 * to the canonical ExternalWarehouseRecord. Returns null (never a
 * fabricated record) when the row carries no usable depot code — Part 7's
 * "Depot Code is the FCI/IISFM identity, never assume it equals a WDRA
 * WH ID" applies here in reverse: this mapper never invents one either.
 */
export function mapFciDepotToExternalRecord(row: Record<string, unknown>): ExternalWarehouseRecord | null {
  const externalId = textOf(row, DEPOT_CODE_KEYS);
  if (!externalId) return null;

  const totalCapacity = textOf(row, TOTAL_CAPACITY_KEYS);
  const capacityUnit = textOf(row, CAPACITY_UNIT_KEYS);

  return {
    externalId,
    source: { providerId: "fci-iisfm", providerType: "GOVERNMENT" },
    name: textOf(row, DEPOT_NAME_KEYS),
    location: {
      address: null,
      village: null,
      district: textOf(row, REVENUE_DISTRICT_KEYS),
      state: textOf(row, REVENUE_STATE_KEYS),
      pincode: null,
      // Never invented — DepotsWithCap's documented fields include no
      // coordinates.
      latitude: null,
      longitude: null,
    },
    contact: { phone: null, email: null },
    storage: {
      totalCapacity,
      availableCapacity: null,
      capacityUnit,
      storageType: null,
      temperatureControlled: null,
      minimumTemperature: null,
      maximumTemperature: null,
    },
    // Covered/Open Capacity are documented FCI fields with no equivalent
    // slot in the canonical contract (that distinguishes covered vs.
    // open-plinth capacity, which ExternalWarehouseRecord.storage does
    // not model) — preserved as provenance metadata rather than dropped,
    // same as WDRA's WHM Name/Registration fields.
    metadata: {
      coveredCapacity: textOf(row, COVERED_CAPACITY_KEYS),
      openCapacity: textOf(row, OPEN_CAPACITY_KEYS),
    },
    sourceUpdatedAt: null,
  };
}
