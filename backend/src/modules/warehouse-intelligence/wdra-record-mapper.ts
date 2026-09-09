import { ExternalWarehouseRecord } from "./providers/warehouse-data-provider";

// ---------------------------------------------------------------------------
// WDRA CSV dataset ingestion (Part 1 of the government warehouse ingestion
// spec). Pure, synchronous row -> ExternalWarehouseRecord mapping — no I/O,
// no database, so it can be unit tested directly against plain row objects.
// See wdra-csv-parser.ts for turning a CSV file into rows of this shape,
// and wdra-csv-import.ts for the CLI script that wires parsing + mapping +
// the existing WarehouseProviderRegistry/WarehouseSyncService pipeline
// together.
// ---------------------------------------------------------------------------

export const WDRA_PROVIDER_ID = "wdra";

/** The exact WDRA export column headers, used as the row's keys. */
export interface WdraCsvRow {
  "WHM Name"?: string;
  "WH Name"?: string;
  "WH ID"?: string;
  Address?: string;
  District?: string;
  State?: string;
  "Capacity(in MT)"?: string;
  "Registration Date"?: string;
  "Registration Valid Upto"?: string;
  "Contact No."?: string;
  Status?: string;
  Remarks?: string;
}

function clean(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Maps one WDRA CSV row into the canonical ExternalWarehouseRecord.
 * Deliberately does no validation and no unit conversion itself — an
 * empty/missing "WH ID" becomes externalId: "" (which the shared
 * warehouse-validation.service.ts already rejects as MISSING_EXTERNAL_ID,
 * exactly like every other provider's malformed rows), and
 * "Capacity(in MT)" is passed through as raw text with a fixed "MT" unit
 * for the shared normalization layer's existing MT -> KG conversion
 * (QUANTITY_ALIASES in modules/fpo/unit-conversion.ts) to handle — never
 * a second, WDRA-specific conversion routine.
 */
export function mapWdraCsvRowToExternalRecord(row: Record<string, string | undefined>): ExternalWarehouseRecord {
  const whId = clean(row["WH ID"]);
  const capacity = clean(row["Capacity(in MT)"]);

  return {
    externalId: whId ?? "",
    source: { providerId: WDRA_PROVIDER_ID, providerType: "GOVERNMENT" },
    name: clean(row["WH Name"]),
    location: {
      address: clean(row["Address"]),
      village: null,
      district: clean(row["District"]),
      state: clean(row["State"]),
      pincode: null,
      // WDRA does not report coordinates — never invented.
      latitude: null,
      longitude: null,
    },
    contact: { phone: null, email: null },
    storage: {
      totalCapacity: capacity,
      availableCapacity: null,
      // Fixed per the WDRA export's own "Capacity(in MT)" column header,
      // only when a capacity value was actually supplied — resolves
      // through the exact same QUANTITY_ALIASES table (MT -> TONNE -> KG)
      // every other provider's capacity already goes through.
      capacityUnit: capacity ? "MT" : null,
      // WDRA has no reliable storage-type column — left unset rather
      // than guessed. The shared sync service's own AMBIENT default
      // (warehouse-sync.service.ts persistOne) applies on create exactly
      // as it would for any other provider that supplied none; nothing
      // WDRA-specific is fabricated here.
      storageType: null,
      temperatureControlled: null,
      minimumTemperature: null,
      maximumTemperature: null,
    },
    // Raw WDRA status text ("Active"/"Inactive"/"Suspended", case/
    // whitespace-insensitive) — resolved to the canonical WarehouseStatus
    // enum by the shared normalization layer's STATUS_ALIASES table.
    status: clean(row["Status"]),
    metadata: {
      whmName: clean(row["WHM Name"]),
      registrationDate: clean(row["Registration Date"]),
      registrationValidUpto: clean(row["Registration Valid Upto"]),
      contactNo: clean(row["Contact No."]),
      remarks: clean(row["Remarks"]),
    },
    sourceUpdatedAt: null,
  };
}
