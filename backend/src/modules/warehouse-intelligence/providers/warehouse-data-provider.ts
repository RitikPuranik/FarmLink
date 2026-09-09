// ---------------------------------------------------------------------------
// Warehouse Ecosystem — Data Ingestion Provider boundary.
//
// This is a DIFFERENT abstraction from StorageIntelligenceProvider
// (storage-intelligence-provider.ts). That one answers "can this crop be
// stored, and where" for the Sell vs Store Decision Engine, reading only
// the FarmLink Warehouse DB. This one answers "where do warehouse RECORDS
// come from" for the sync pipeline that fills that DB in the first place.
// Nothing downstream of the FarmLink Warehouse DB (search, availability,
// suitability, risk, recommendations, StorageIntelligenceProvider, Sell vs
// Store) ever imports anything from this file or this providers/ folder —
// that dependency direction, and only that direction, is what keeps
// external-source complexity from leaking past the normalization layer.
// ---------------------------------------------------------------------------

export type WarehouseProviderType = "FARMLINK" | "GOVERNMENT" | "PRIVATE_PARTNER";

/**
 * Canonical, provider-neutral shape every provider must translate its own
 * source format into before returning. Never a Prisma model, never a raw
 * external API response shape. Every field the source didn't actually
 * supply is `null` (or omitted for optional nested objects) — never a
 * guessed/derived value. See warehouse-normalization.service.ts for what
 * happens to this record next.
 */
export interface ExternalWarehouseRecord {
  /** The provider's own stable identifier for this warehouse. Combined
   * with the provider's id, this is the idempotency key the sync service
   * upserts against — see WarehouseSourceReference. */
  externalId: string;

  source: {
    providerId: string;
    providerType: WarehouseProviderType;
  };

  name: string | null;

  location: {
    address?: string | null;
    village?: string | null;
    district?: string | null;
    state?: string | null;
    pincode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };

  contact?: {
    phone?: string | null;
    email?: string | null;
  };

  storage?: {
    /** Left as a raw string, not a number — the source's own textual
     * quantity (e.g. "500", "1,200.5"), parsed and unit-converted only in
     * the normalization layer, never here. */
    totalCapacity?: string | null;
    availableCapacity?: string | null;
    /** Free-text unit as the source wrote it (e.g. "MT", "quintal",
     * "bags") — normalization resolves this against a known alias table
     * and marks the record invalid rather than guessing if it can't. */
    capacityUnit?: string | null;
    /** Free-text storage-type hint (e.g. "cold storage", "silo") —
     * normalization maps this to the existing StorageType enum where it
     * confidently can, otherwise leaves it unset (never invents AMBIENT). */
    storageType?: string | null;
    temperatureControlled?: boolean | null;
    minimumTemperature?: string | null;
    maximumTemperature?: string | null;
  };

  /** Non-sensitive provider payload fragments worth preserving for
   * troubleshooting/provenance. Never credentials, never a full raw
   * payload dump. */
  metadata?: Record<string, unknown>;

  /** Free-text lifecycle status as the source wrote it (e.g. "Active",
   * "inactive", "SUSPENDED") — resolved against a small explicit alias
   * table in the normalization layer (STATUS_ALIASES), exactly the same
   * "unrecognized text is dropped to null, never guessed" discipline as
   * storage.storageType above. `undefined`/`null` means the source simply
   * doesn't report a status for this record — the sync service then
   * leaves Warehouse.status/isActive at their existing/default value
   * rather than fabricating one. */
  status?: string | null;

  sourceUpdatedAt?: Date | null;
}

export interface WarehouseProviderRequest {
  /** Optional lower bound the provider may use to only fetch
   * records updated since this timestamp — purely an optimization hint;
   * a provider that can't support it is free to ignore it and return
   * everything (the sync service re-validates/re-normalizes every record
   * it gets regardless). */
  updatedSince?: Date;
  /** Bounds how many external records a single fetch call may return, so
   * one provider can never turn a sync run into an unbounded fetch. */
  maxRecords?: number;
}

export type WarehouseProviderStatus = "SUCCESS" | "PARTIAL" | "UNAVAILABLE" | "FAILED";

export interface ProviderError {
  code: string;
  message: string;
}

export interface WarehouseProviderResult {
  provider: {
    id: string;
    type: WarehouseProviderType;
  };

  /**
   * SUCCESS: the provider ran and returned data (possibly zero records —
   * "no new warehouses this run" is success, not failure).
   * PARTIAL: the provider ran but some of its own records were dropped
   * before even reaching the canonical contract (e.g. one malformed page
   * of a paginated source) — `warehouses` still holds everything usable.
   * UNAVAILABLE: the provider is intentionally not configured/enabled.
   * This is never treated as a system failure — see
   * UnavailableGovernmentWarehouseProvider / UnavailablePartnerWarehouseProvider.
   * FAILED: the provider attempted to run and hit an unexpected error.
   */
  status: WarehouseProviderStatus;

  warehouses: ExternalWarehouseRecord[];

  metadata?: {
    fetchedAt: Date;
    sourceTimestamp?: Date | null;
    recordCount: number;
  };

  errors?: ProviderError[];
}

/**
 * The provider boundary every concrete source (FarmLink, Government,
 * Private Partner, and any future one) implements. WarehouseProviderRegistry
 * is the only thing that calls this directly — nothing else in the
 * codebase should ever import a concrete provider class.
 */
export interface WarehouseDataProvider {
  readonly providerId: string;
  readonly providerType: WarehouseProviderType;
  fetchWarehouses(request: WarehouseProviderRequest): Promise<WarehouseProviderResult>;
}
