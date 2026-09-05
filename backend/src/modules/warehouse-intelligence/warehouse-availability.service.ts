import { QuantityUnit, WarehouseStatus } from "@prisma/client";
import { AuthenticatedUserContext } from "../auth/auth.types";
import { AuditService } from "../audit/audit.service";
import { NotFoundError, ValidationError, WarehouseDomainError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { haversineKm } from "../market-intelligence/analytics";
import { ReferenceDataService } from "../reference-data/reference-data.service";
import { WarehouseCapabilityRepository } from "./warehouse-capability.repository";
import {
  aggregateStorageUnitsToKg,
  calculateUtilizationPercentage,
  canAccommodateQuantity,
  capacityStatus,
  computeBoundingBox,
  resolveCropCompatibility,
  toKg,
} from "./warehouse-capacity";
import { WAREHOUSE_INTELLIGENCE_CONFIG } from "./warehouse-intelligence.config";
import { WarehouseRepository } from "./warehouse.repository";
import { WarehouseStorageRepository } from "./warehouse-storage.repository";
import {
  NearbyWarehouseResultDTO,
  WarehouseAvailabilityDTO,
  WarehouseCapacitySummaryDTO,
  WarehouseDTO,
  WarehouseWithCapacity,
  toWarehouseDTO,
  toWarehouseStorageUnitDTO,
} from "./warehouse.types";
import { getWarehouseCache, invalidateWarehouseCache, roundCoordinateForCacheKey, setWarehouseCache } from "./warehouse-cache";

export interface NearbySearchInput {
  latitude: number;
  longitude: number;
  radiusKm: number;
  cropId?: string;
  quantity?: number;
  unit?: QuantityUnit;
}

export interface AvailabilityQueryInput {
  cropId?: string;
  quantity?: number;
  unit?: QuantityUnit;
}

export interface UpdateStorageUnitCapacityInput {
  totalCapacity?: number;
  availableCapacity?: number;
}

export interface NearbySearchResult {
  results: NearbyWarehouseResultDTO[];
}

// Non-admin roles only ever see operationally ACTIVE, isActive warehouses.
// An ADMIN can search/view every status — matching AUTHORIZATION_POLICY's
// "ADMIN: full warehouse visibility" line in authorization.policy.ts.
function visibilityFilter(actor: AuthenticatedUserContext): { status?: WarehouseStatus; isActiveOnly: boolean } {
  if (actor.role === "ADMIN") return { isActiveOnly: false };
  return { status: "ACTIVE", isActiveOnly: true };
}

function isWarehouseVisibleTo(actor: AuthenticatedUserContext, warehouse: WarehouseWithCapacity): boolean {
  if (actor.role === "ADMIN") return true;
  if (warehouse.ownerUserId === actor.id) return true;
  return warehouse.status === "ACTIVE" && warehouse.isActive;
}

function canManageWarehouse(actor: AuthenticatedUserContext, warehouse: { ownerUserId: string | null }): boolean {
  // FPO-owned warehouses would need FpoAuthorizationService's membership
  // check (whether `actor` is an active admin of ownerFpoId) to let an
  // FPO_ADMIN manage them — that dependency isn't wired into this service
  // to avoid reaching across module boundaries for a Part 2 feature.
  // Deferred: see the final response's "not implemented" list.
  if (actor.role === "ADMIN") return true;
  return actor.role === "WAREHOUSE_OPERATOR" && warehouse.ownerUserId === actor.id;
}

/**
 * Module 9 Part 2 — the single service boundary through which any caller
 * (this module's own controller today; Module 8's Sell vs Store engine in
 * a future part) gets factual, derived-from-persisted-data warehouse
 * capacity information. Never reserves capacity, never mutates capacity
 * during a read, never fabricates a number it doesn't have — see each
 * method's own comment for how a missing/unknown input is represented.
 */
export class WarehouseAvailabilityService {
  constructor(
    private readonly warehouses: WarehouseRepository,
    private readonly storageUnits: WarehouseStorageRepository,
    private readonly capabilities: WarehouseCapabilityRepository,
    private readonly referenceData: ReferenceDataService,
    private readonly audit: AuditService,
  ) {}

  private summarize(warehouse: WarehouseWithCapacity): WarehouseCapacitySummaryDTO {
    const aggregate = aggregateStorageUnitsToKg(
      warehouse.storageUnits.map((u) => ({
        totalCapacity: Number(u.totalCapacity),
        availableCapacity: Number(u.availableCapacity),
        capacityUnit: u.capacityUnit,
        isActive: u.isActive,
      })),
    );
    const totalKg = aggregate?.totalKg ?? null;
    const availableKg = aggregate?.availableKg ?? null;
    return {
      totalKg,
      availableKg,
      utilizationPercent: calculateUtilizationPercentage(totalKg, availableKg),
      status: capacityStatus(totalKg, availableKg),
      storageUnitCount: aggregate?.unitCount ?? 0,
    };
  }

  private buildAvailabilityDTO(
    warehouse: WarehouseWithCapacity,
    requestedCrop: { id: string; name: string } | null,
    requestedQuantity: { value: number; unit: QuantityUnit } | null,
  ): WarehouseAvailabilityDTO {
    const capacity = this.summarize(warehouse);

    let compatibility: "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN" | null = null;
    if (requestedCrop) {
      compatibility = resolveCropCompatibility(
        warehouse.capabilities.filter((c) => c.crop.id === requestedCrop.id),
      );
    }

    let canAccommodate: boolean | null = null;
    if (requestedQuantity) {
      const requestedKg = toKg(requestedQuantity.value, requestedQuantity.unit);
      // A crop known NOT to be supported here is never reported as
      // "fits" regardless of raw capacity; UNKNOWN compatibility means the
      // fit itself is honestly unknown, never silently true (build spec:
      // "UNKNOWN must not silently become SUPPORTED").
      if (compatibility === "UNSUPPORTED") {
        canAccommodate = false;
      } else if (compatibility === "UNKNOWN") {
        canAccommodate = null;
      } else {
        canAccommodate = canAccommodateQuantity(capacity.availableKg, requestedKg);
      }
    }

    return {
      warehouse: toWarehouseDTO(warehouse),
      capacity,
      requestedCrop,
      compatibility,
      requestedQuantity,
      canAccommodate,
    };
  }

  private async resolveRequestedCrop(cropId?: string): Promise<{ id: string; name: string } | null> {
    if (!cropId) return null;
    const crop = await this.referenceData.getActiveCropOrThrow(cropId);
    return { id: crop.id, name: crop.name };
  }

  /** GET /api/warehouses/:warehouseId — plain warehouse details, no
   * capacity math. 404s (rather than 403s) for a warehouse the actor
   * can't see, so an outsider can't distinguish "doesn't exist" from
   * "exists but suspended", matching this codebase's existing
   * not-found-for-unauthorized convention (see lots/lot.authorization.ts
   * callers). */
  async getWarehouseDetail(warehousePublicId: string, actor: AuthenticatedUserContext): Promise<WarehouseDTO> {
    const warehouse = await this.warehouses.findByPublicId(warehousePublicId);
    if (!warehouse) throw new NotFoundError("Warehouse not found.");
    const visible =
      actor.role === "ADMIN" || warehouse.ownerUserId === actor.id || (warehouse.status === "ACTIVE" && warehouse.isActive);
    if (!visible) throw new NotFoundError("Warehouse not found.");
    return toWarehouseDTO(warehouse);
  }

  /**
   * GET /api/warehouses/:warehouseId/availability
   *
   * This is the clean boundary a future Module 8 integration should call
   * (build spec: "design the Warehouse Intelligence service so Module 8
   * can later consume factual storage information ... through a clean
   * service boundary such as getStorageAvailability()"). It returns only
   * DTOs — never a raw Prisma row — so Module 8 would never need to
   * import a Warehouse Prisma model to use it, keeping the two modules
   * decoupled with no circular dependency.
   */
  async getStorageAvailability(
    warehousePublicId: string,
    query: AvailabilityQueryInput,
    actor: AuthenticatedUserContext,
  ): Promise<WarehouseAvailabilityDTO> {
    if ((query.quantity === undefined) !== (query.unit === undefined)) {
      throw new ValidationError("Please correct the highlighted fields", {
        quantity: "quantity and unit must be provided together",
      });
    }

    const requestedCrop = await this.resolveRequestedCrop(query.cropId);
    const warehouse = await this.warehouses.findByPublicIdWithCapacity(warehousePublicId, query.cropId);
    if (!warehouse) throw new WarehouseDomainError("Warehouse not found.", "WAREHOUSE_NOT_FOUND", 404);
    if (!isWarehouseVisibleTo(actor, warehouse)) {
      throw new WarehouseDomainError("Warehouse not found.", "WAREHOUSE_NOT_FOUND", 404);
    }

    const requestedQuantity =
      query.quantity !== undefined && query.unit !== undefined ? { value: query.quantity, unit: query.unit } : null;

    const dto = this.buildAvailabilityDTO(warehouse, requestedCrop, requestedQuantity);

    trackEvent("warehouse_availability_viewed", actor.id, {
      warehouseStatus: dto.capacity.status,
      hasCropFilter: Boolean(query.cropId),
    });

    return dto;
  }

  /** Alias kept for call-site readability inside this module/controller —
   * getStorageAvailability() above is the name future callers (Module 8)
   * should depend on. */
  getAvailability = this.getStorageAvailability.bind(this);

  /**
   * GET /api/warehouses/nearby
   *
   * Strategy: bounding box first in SQL (WarehouseRepository.
   * findNearbyCandidates, bounded by NEAREST_CANDIDATE_LIMIT), then exact
   * Haversine distance + radius cut in application code, mirroring Module
   * 6's own nearby-market search (market-intelligence.service.ts's
   * candidates()) — the one difference being the box filter itself runs
   * in the database here instead of in memory, per this part's explicit
   * "avoid loading every warehouse" requirement.
   *
   * Sort order (deterministic, documented): 1) canAccommodate (true
   * first, unknown/false after — a null canAccommodate, i.e. unknown
   * compatibility, sorts with the non-fitting group since it is not a
   * confirmed fit), 2) capacity status rank (AVAILABLE > LIMITED > FULL >
   * UNAVAILABLE), 3) distance ascending, 4) available capacity
   * descending, 5) warehouse publicId ascending as a final deterministic
   * tiebreaker.
   */
  async searchNearby(input: NearbySearchInput, actor: AuthenticatedUserContext): Promise<NearbySearchResult> {
    if ((input.quantity === undefined) !== (input.unit === undefined)) {
      throw new ValidationError("Please correct the highlighted fields", {
        quantity: "quantity and unit must be provided together",
      });
    }
    if (input.radiusKm <= 0 || input.radiusKm > WAREHOUSE_INTELLIGENCE_CONFIG.MAX_RADIUS_KM) {
      throw new WarehouseDomainError(
        `Radius must be between 0 and ${WAREHOUSE_INTELLIGENCE_CONFIG.MAX_RADIUS_KM} km.`,
        "INVALID_RADIUS",
      );
    }
    if (Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180) {
      throw new WarehouseDomainError("Invalid latitude or longitude.", "INVALID_LOCATION");
    }

    const requestedCrop = await this.resolveRequestedCrop(input.cropId);

    const cacheKey = [
      roundCoordinateForCacheKey(input.latitude),
      roundCoordinateForCacheKey(input.longitude),
      input.radiusKm,
      input.cropId ?? null,
      input.quantity ?? null,
      input.unit ?? null,
      actor.role,
    ];
    const cached = await getWarehouseCache<NearbySearchResult>("nearby", cacheKey);
    if (cached) return cached;

    // Bounding box in degrees: ~111 km per degree of latitude, same
    // approximation Module 6 uses (market-intelligence.service.ts) — see
    // computeBoundingBox() in warehouse-capacity.ts, shared with Part 5's
    // recommendation candidate discovery.
    const bbox = computeBoundingBox(input.latitude, input.longitude, input.radiusKm);
    const visibility = visibilityFilter(actor);

    const candidates = await this.warehouses.findNearbyCandidates(
      {
        minLatitude: bbox.minLatitude,
        maxLatitude: bbox.maxLatitude,
        minLongitude: bbox.minLongitude,
        maxLongitude: bbox.maxLongitude,
        status: visibility.status,
        isActiveOnly: visibility.isActiveOnly,
        cropId: input.cropId,
      },
      WAREHOUSE_INTELLIGENCE_CONFIG.NEAREST_CANDIDATE_LIMIT,
    );

    const requestedQuantity =
      input.quantity !== undefined && input.unit !== undefined ? { value: input.quantity, unit: input.unit } : null;

    const STATUS_RANK: Record<string, number> = { AVAILABLE: 0, LIMITED: 1, FULL: 2, UNAVAILABLE: 3 };
    const fitRank = (canAccommodate: boolean | null) => (canAccommodate === true ? 0 : 1);

    const withinRadius: NearbyWarehouseResultDTO[] = [];
    for (const candidate of candidates) {
      if (candidate.latitude === null || candidate.longitude === null) continue;
      const distanceKm = haversineKm(input.latitude, input.longitude, candidate.latitude, candidate.longitude);
      if (distanceKm > input.radiusKm) continue;

      const dto = this.buildAvailabilityDTO(candidate, requestedCrop, requestedQuantity);
      withinRadius.push({ ...dto, distanceKm });
    }

    withinRadius.sort((a, b) => {
      const fit = fitRank(a.canAccommodate) - fitRank(b.canAccommodate);
      if (fit !== 0) return fit;
      const status = STATUS_RANK[a.capacity.status] - STATUS_RANK[b.capacity.status];
      if (status !== 0) return status;
      const distance = a.distanceKm - b.distanceKm;
      if (distance !== 0) return distance;
      const availability = (b.capacity.availableKg ?? -1) - (a.capacity.availableKg ?? -1);
      if (availability !== 0) return availability;
      return a.warehouse.publicId.localeCompare(b.warehouse.publicId);
    });

    const result: NearbySearchResult = { results: withinRadius };

    trackEvent("warehouse_search", actor.id, {
      radiusKm: input.radiusKm,
      hasCropFilter: Boolean(input.cropId),
      resultCount: withinRadius.length,
    });

    await setWarehouseCache("nearby", cacheKey, result);
    return result;
  }

  /**
   * PATCH /api/warehouses/:warehouseId/storage-units/:storageUnitId/capacity
   *
   * The only mutation this part adds. Never reserves capacity, never
   * touches StorageReservation/StorageRate — this is a plain, validated
   * column write on WarehouseStorageUnit, exactly the shape Part 1's own
   * repository update() method already supports.
   */
  async updateStorageUnitCapacity(
    actor: AuthenticatedUserContext,
    warehousePublicId: string,
    storageUnitPublicId: string,
    patch: UpdateStorageUnitCapacityInput,
  ) {
    const warehouse = await this.warehouses.findByPublicId(warehousePublicId);
    if (!warehouse) throw new WarehouseDomainError("Warehouse not found.", "WAREHOUSE_NOT_FOUND", 404);
    if (!canManageWarehouse(actor, warehouse)) {
      throw new WarehouseDomainError("Warehouse not found.", "WAREHOUSE_NOT_FOUND", 404);
    }

    const unit = await this.storageUnits.findByPublicId(storageUnitPublicId);
    if (!unit || unit.warehouseId !== warehouse.id) {
      throw new WarehouseDomainError("Storage unit not found.", "STORAGE_UNIT_NOT_FOUND", 404);
    }

    const nextTotal = patch.totalCapacity ?? Number(unit.totalCapacity);
    const nextAvailable = patch.availableCapacity ?? Number(unit.availableCapacity);

    if (nextTotal < 0) {
      throw new WarehouseDomainError("Total capacity cannot be negative.", "INVALID_CAPACITY");
    }
    if (nextAvailable < 0) {
      throw new WarehouseDomainError("Available capacity cannot be negative.", "INVALID_CAPACITY");
    }
    if (nextAvailable > nextTotal) {
      throw new WarehouseDomainError("Available capacity cannot exceed total capacity.", "INVALID_CAPACITY");
    }

    const updated = await this.storageUnits.update(unit.id, {
      ...(patch.totalCapacity !== undefined ? { totalCapacity: patch.totalCapacity } : {}),
      ...(patch.availableCapacity !== undefined ? { availableCapacity: patch.availableCapacity } : {}),
    });

    await this.audit.record({
      actorUserId: actor.id,
      action: "WAREHOUSE_CAPACITY_UPDATED",
      entityType: "WarehouseStorageUnit",
      entityId: updated.publicId,
      metadata: { warehousePublicId: warehouse.publicId },
    });
    await invalidateWarehouseCache();

    return toWarehouseStorageUnitDTO(updated);
  }
}
