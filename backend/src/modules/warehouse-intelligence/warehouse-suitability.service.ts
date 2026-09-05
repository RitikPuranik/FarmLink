import { AuthenticatedUserContext } from "../auth/auth.types";
import { AuditService } from "../audit/audit.service";
import { WarehouseDomainError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { ReferenceDataService } from "../reference-data/reference-data.service";
import { CropStorageRequirementRepository, UpsertCropStorageRequirementData } from "./crop-storage-requirement.repository";
import {
  evaluateStorageSuitability,
  insufficientCropRequirementsResult,
  insufficientWarehouseConditionDataResult,
  SUITABILITY_STATUS_RANK,
} from "./storage-suitability.engine";
import { CropStorageRequirementInput, StorageConditionsInput } from "./storage-suitability.types";
import { WarehouseRepository } from "./warehouse.repository";
import { WarehouseStorageRepository, UpdateWarehouseStorageUnitData } from "./warehouse-storage.repository";
import { WarehouseAvailabilityService } from "./warehouse-availability.service";
import {
  CropStorageRequirementSummaryDTO,
  OverallEligibility,
  StorageEligibilityResponseDTO,
  StorageSuitabilityDTO,
  toCropStorageRequirementSummary,
  WarehouseSuitabilityResponseDTO,
} from "./warehouse-suitability.types";
import { toWarehouseDTO, toWarehouseStorageUnitDTO, WarehouseStorageUnitDTO, WarehouseWithCapacity } from "./warehouse.types";
import { invalidateWarehouseCache } from "./warehouse-cache";

export interface StorageEligibilityQueryInput {
  cropId: string;
  quantity?: number;
  unit?: "KG" | "QTL" | "TONNE";
}

export interface UpdateStorageConditionsInput {
  temperatureControlled?: boolean;
  minTemperature?: number | null;
  maxTemperature?: number | null;
  humidityControlled?: boolean;
  minHumidity?: number | null;
  maxHumidity?: number | null;
  ventilationAvailable?: boolean | null;
  coldStorageAvailable?: boolean | null;
  controlledAtmosphereAvailable?: boolean | null;
  pestControlAvailable?: boolean | null;
  moistureControlAvailable?: boolean | null;
}

export interface UpsertCropStorageRequirementInput {
  preferredTemperatureMin?: number | null;
  preferredTemperatureMax?: number | null;
  preferredHumidityMin?: number | null;
  preferredHumidityMax?: number | null;
  requiresVentilation?: boolean | null;
  requiresColdStorage?: boolean | null;
  requiresControlledAtmosphere?: boolean | null;
  requiresPestControl?: boolean | null;
  requiresMoistureControl?: boolean | null;
  compatibleStorageTypes?: string[];
  maximumRecommendedStorageDays?: number | null;
  notes?: string | null;
}

// Mirrors WarehouseAvailabilityService's own visibility rule exactly (see
// that file's own comment) — kept as a small local copy rather than an
// exported shared helper, since Part 2 never exported it either; both
// copies must be kept in sync if the visibility rule ever changes.
function isWarehouseVisibleTo(actor: AuthenticatedUserContext, warehouse: WarehouseWithCapacity): boolean {
  if (actor.role === "ADMIN") return true;
  if (warehouse.ownerUserId === actor.id) return true;
  return warehouse.status === "ACTIVE" && warehouse.isActive;
}

function canManageWarehouse(actor: AuthenticatedUserContext, warehouse: { ownerUserId: string | null }): boolean {
  if (actor.role === "ADMIN") return true;
  return actor.role === "WAREHOUSE_OPERATOR" && warehouse.ownerUserId === actor.id;
}

function toRequirementInput(row: {
  preferredTemperatureMin: unknown;
  preferredTemperatureMax: unknown;
  preferredHumidityMin: unknown;
  preferredHumidityMax: unknown;
  requiresVentilation: boolean | null;
  requiresColdStorage: boolean | null;
  requiresControlledAtmosphere: boolean | null;
  requiresPestControl: boolean | null;
  requiresMoistureControl: boolean | null;
  compatibleStorageTypes: string[];
  maximumRecommendedStorageDays: number | null;
}): CropStorageRequirementInput {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    preferredTemperatureMin: num(row.preferredTemperatureMin),
    preferredTemperatureMax: num(row.preferredTemperatureMax),
    preferredHumidityMin: num(row.preferredHumidityMin),
    preferredHumidityMax: num(row.preferredHumidityMax),
    requiresVentilation: row.requiresVentilation,
    requiresColdStorage: row.requiresColdStorage,
    requiresControlledAtmosphere: row.requiresControlledAtmosphere,
    requiresPestControl: row.requiresPestControl,
    requiresMoistureControl: row.requiresMoistureControl,
    compatibleStorageTypes: row.compatibleStorageTypes as CropStorageRequirementInput["compatibleStorageTypes"],
    maximumRecommendedStorageDays: row.maximumRecommendedStorageDays,
  };
}

function toConditionsInput(unit: {
  storageType: string;
  temperatureControlled: boolean;
  minTemperature: unknown;
  maxTemperature: unknown;
  humidityControlled: boolean;
  minHumidity: unknown;
  maxHumidity: unknown;
  ventilationAvailable: boolean | null;
  coldStorageAvailable: boolean | null;
  controlledAtmosphereAvailable: boolean | null;
  pestControlAvailable: boolean | null;
  moistureControlAvailable: boolean | null;
}): StorageConditionsInput {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    storageType: unit.storageType as StorageConditionsInput["storageType"],
    temperatureControlled: unit.temperatureControlled,
    minTemperature: num(unit.minTemperature),
    maxTemperature: num(unit.maxTemperature),
    humidityControlled: unit.humidityControlled,
    minHumidity: num(unit.minHumidity),
    maxHumidity: num(unit.maxHumidity),
    ventilationAvailable: unit.ventilationAvailable,
    coldStorageAvailable: unit.coldStorageAvailable,
    controlledAtmosphereAvailable: unit.controlledAtmosphereAvailable,
    pestControlAvailable: unit.pestControlAvailable,
    moistureControlAvailable: unit.moistureControlAvailable,
  };
}

/**
 * Module 9 Part 3 — the deterministic storage-suitability service
 * boundary. Owns: resolving the crop's configured requirements, resolving
 * the warehouse's configured storage-unit conditions, invoking the pure
 * engine (storage-suitability.engine.ts), and composing the result with
 * Part 2's capacity result for the eligibility endpoint. Never predicts
 * spoilage, never recommends a warehouse, never mutates data through a
 * read method.
 */
export class WarehouseSuitabilityService {
  constructor(
    private readonly warehouses: WarehouseRepository,
    private readonly storageUnits: WarehouseStorageRepository,
    private readonly cropRequirements: CropStorageRequirementRepository,
    private readonly referenceData: ReferenceDataService,
    private readonly availability: WarehouseAvailabilityService,
    private readonly audit: AuditService,
  ) {}

  private async resolveVisibleWarehouse(warehousePublicId: string, actor: AuthenticatedUserContext): Promise<WarehouseWithCapacity> {
    const warehouse = await this.warehouses.findByPublicIdWithCapacity(warehousePublicId);
    if (!warehouse) throw new WarehouseDomainError("Warehouse not found.", "WAREHOUSE_NOT_FOUND", 404);
    if (!isWarehouseVisibleTo(actor, warehouse)) {
      throw new WarehouseDomainError("Warehouse not found.", "WAREHOUSE_NOT_FOUND", 404);
    }
    return warehouse;
  }

  /**
   * Evaluates every active storage unit and returns the best result (see
   * SUITABILITY_STATUS_RANK), never hiding that other units may be worse
   * — evaluatedStorageUnitCount always reports how many were actually
   * compared. Deterministic tie-break: higher confidence first, then
   * storage-unit publicId ascending, so repeated calls with unchanged
   * data always return the exact same unit.
   */
  private evaluateWarehouse(
    requirement: CropStorageRequirementInput | null,
    units: Array<Parameters<typeof toConditionsInput>[0] & { publicId: string; code: string; isActive: boolean }>,
  ): StorageSuitabilityDTO {
    const activeUnits = units.filter((u) => u.isActive);

    if (!requirement) {
      return { ...insufficientCropRequirementsResult(), evaluatedStorageUnit: null, evaluatedStorageUnitCount: activeUnits.length };
    }
    if (activeUnits.length === 0) {
      return { ...insufficientWarehouseConditionDataResult(), evaluatedStorageUnit: null, evaluatedStorageUnitCount: 0 };
    }

    const evaluated = activeUnits
      .map((unit) => ({ unit, result: evaluateStorageSuitability(requirement, toConditionsInput(unit)) }))
      .sort((a, b) => {
        const rank = SUITABILITY_STATUS_RANK[a.result.status] - SUITABILITY_STATUS_RANK[b.result.status];
        if (rank !== 0) return rank;
        const confidence = (b.result.confidence ?? -1) - (a.result.confidence ?? -1);
        if (confidence !== 0) return confidence;
        return a.unit.publicId.localeCompare(b.unit.publicId);
      });

    const best = evaluated[0];
    return {
      ...best.result,
      evaluatedStorageUnit: { publicId: best.unit.publicId, code: best.unit.code },
      evaluatedStorageUnitCount: activeUnits.length,
    };
  }

  /** GET /api/warehouses/:warehouseId/suitability?cropId= */
  async getSuitability(
    warehousePublicId: string,
    cropId: string,
    actor: AuthenticatedUserContext,
  ): Promise<WarehouseSuitabilityResponseDTO> {
    const crop = await this.referenceData.getActiveCropOrThrow(cropId);
    const warehouse = await this.resolveVisibleWarehouse(warehousePublicId, actor);
    const requirementRow = await this.cropRequirements.findByCropId(crop.id);
    const requirement = requirementRow ? toRequirementInput(requirementRow) : null;

    const suitability = this.evaluateWarehouse(requirement, warehouse.storageUnits as any);

    trackEvent("warehouse_suitability_checked", actor.id, { status: suitability.status });

    return { warehouse: toWarehouseDTO(warehouse), crop: { id: crop.id, name: crop.name }, suitability };
  }

  /** GET /api/warehouses/:warehouseId/storage-eligibility?cropId=&quantity=&unit=
   *
   * Composes Part 2 capacity + Part 3 suitability, each preserved
   * independently in the response (build spec: "do not hide whether
   * rejection came from capacity or suitability"). overallEligibility
   * priority (documented, deterministic):
   *   1. suitability UNSUITABLE               -> UNSUITABLE
   *   2. capacity known-insufficient           -> INSUFFICIENT_CAPACITY
   *   3. suitability UNKNOWN or capacity unknown -> UNKNOWN
   *   4. otherwise                             -> ELIGIBLE
   */
  async getStorageEligibility(
    warehousePublicId: string,
    query: StorageEligibilityQueryInput,
    actor: AuthenticatedUserContext,
  ): Promise<StorageEligibilityResponseDTO> {
    const crop = await this.referenceData.getActiveCropOrThrow(query.cropId);
    const warehouse = await this.resolveVisibleWarehouse(warehousePublicId, actor);
    const requirementRow = await this.cropRequirements.findByCropId(crop.id);
    const requirement = requirementRow ? toRequirementInput(requirementRow) : null;
    const suitability = this.evaluateWarehouse(requirement, warehouse.storageUnits as any);

    const availabilityDto = await this.availability.getStorageAvailability(
      warehousePublicId,
      { cropId: query.cropId, quantity: query.quantity, unit: query.unit as any },
      actor,
    );

    const quantityRequested = query.quantity !== undefined;
    const capacityBlocking = quantityRequested
      ? availabilityDto.canAccommodate === false
      : availabilityDto.capacity.status === "UNAVAILABLE";
    const capacityUnknown = quantityRequested && availabilityDto.canAccommodate === null;

    let overallEligibility: OverallEligibility;
    if (suitability.status === "UNSUITABLE") {
      overallEligibility = "UNSUITABLE";
    } else if (capacityBlocking) {
      overallEligibility = "INSUFFICIENT_CAPACITY";
    } else if (suitability.status === "UNKNOWN" || capacityUnknown) {
      overallEligibility = "UNKNOWN";
    } else {
      overallEligibility = "ELIGIBLE";
    }

    trackEvent("warehouse_storage_eligibility_checked", actor.id, {
      overallEligibility,
      suitabilityStatus: suitability.status,
      capacityStatus: availabilityDto.capacity.status,
    });

    return {
      warehouse: availabilityDto.warehouse,
      capacity: availabilityDto.capacity,
      requestedQuantity: availabilityDto.requestedQuantity,
      canAccommodate: availabilityDto.canAccommodate,
      suitability,
      overallEligibility,
    };
  }

  /**
   * PATCH /api/warehouses/:warehouseId/storage-units/:storageUnitId/conditions
   *
   * ADMIN, or the WAREHOUSE_OPERATOR who owns this warehouse — same
   * authorization shape as Part 2's updateStorageUnitCapacity(). Merges
   * the patch onto existing values before validating min<=max so a
   * partial update (e.g. only minTemperature) can't silently create an
   * inverted range against an already-stored max.
   */
  async updateStorageConditions(
    actor: AuthenticatedUserContext,
    warehousePublicId: string,
    storageUnitPublicId: string,
    patch: UpdateStorageConditionsInput,
  ): Promise<WarehouseStorageUnitDTO> {
    const warehouse = await this.warehouses.findByPublicId(warehousePublicId);
    if (!warehouse) throw new WarehouseDomainError("Warehouse not found.", "WAREHOUSE_NOT_FOUND", 404);
    if (!canManageWarehouse(actor, warehouse)) {
      throw new WarehouseDomainError("Warehouse not found.", "WAREHOUSE_NOT_FOUND", 404);
    }

    const unit = await this.storageUnits.findByPublicId(storageUnitPublicId);
    if (!unit || unit.warehouseId !== warehouse.id) {
      throw new WarehouseDomainError("Storage unit not found.", "STORAGE_UNIT_NOT_FOUND", 404);
    }

    const nextMinTemp = patch.minTemperature !== undefined ? patch.minTemperature : unit.minTemperature === null ? null : Number(unit.minTemperature);
    const nextMaxTemp = patch.maxTemperature !== undefined ? patch.maxTemperature : unit.maxTemperature === null ? null : Number(unit.maxTemperature);
    if (nextMinTemp !== null && nextMaxTemp !== null && nextMinTemp > nextMaxTemp) {
      throw new WarehouseDomainError("Minimum temperature cannot exceed maximum temperature.", "INVALID_TEMPERATURE_RANGE");
    }

    const nextMinHumidity = patch.minHumidity !== undefined ? patch.minHumidity : unit.minHumidity === null ? null : Number(unit.minHumidity);
    const nextMaxHumidity = patch.maxHumidity !== undefined ? patch.maxHumidity : unit.maxHumidity === null ? null : Number(unit.maxHumidity);
    if (nextMinHumidity !== null && nextMaxHumidity !== null && nextMinHumidity > nextMaxHumidity) {
      throw new WarehouseDomainError("Minimum humidity cannot exceed maximum humidity.", "INVALID_HUMIDITY_RANGE");
    }

    const updateData: UpdateWarehouseStorageUnitData = {
      ...(patch.temperatureControlled !== undefined ? { temperatureControlled: patch.temperatureControlled } : {}),
      ...(patch.minTemperature !== undefined ? { minTemperature: patch.minTemperature } : {}),
      ...(patch.maxTemperature !== undefined ? { maxTemperature: patch.maxTemperature } : {}),
      ...(patch.humidityControlled !== undefined ? { humidityControlled: patch.humidityControlled } : {}),
      ...(patch.minHumidity !== undefined ? { minHumidity: patch.minHumidity } : {}),
      ...(patch.maxHumidity !== undefined ? { maxHumidity: patch.maxHumidity } : {}),
      ...(patch.ventilationAvailable !== undefined ? { ventilationAvailable: patch.ventilationAvailable } : {}),
      ...(patch.coldStorageAvailable !== undefined ? { coldStorageAvailable: patch.coldStorageAvailable } : {}),
      ...(patch.controlledAtmosphereAvailable !== undefined
        ? { controlledAtmosphereAvailable: patch.controlledAtmosphereAvailable }
        : {}),
      ...(patch.pestControlAvailable !== undefined ? { pestControlAvailable: patch.pestControlAvailable } : {}),
      ...(patch.moistureControlAvailable !== undefined ? { moistureControlAvailable: patch.moistureControlAvailable } : {}),
    };

    const updated = await this.storageUnits.update(unit.id, updateData);

    await this.audit.record({
      actorUserId: actor.id,
      action: "WAREHOUSE_STORAGE_CONDITIONS_UPDATED",
      entityType: "WarehouseStorageUnit",
      entityId: updated.publicId,
      metadata: { warehousePublicId: warehouse.publicId },
    });
    await invalidateWarehouseCache();

    return toWarehouseStorageUnitDTO(updated);
  }

  /**
   * PUT /api/warehouses/crop-storage-requirements/:cropId
   *
   * ADMIN only (enforced at the route; re-checked here defensively).
   * Always an upsert — see CropStorageRequirement's own schema comment on
   * why this part keeps one row per crop rather than a version history.
   */
  async upsertCropStorageRequirement(
    actor: AuthenticatedUserContext,
    cropId: string,
    patch: UpsertCropStorageRequirementInput,
  ): Promise<CropStorageRequirementSummaryDTO> {
    if (actor.role !== "ADMIN") {
      throw new WarehouseDomainError("Only an administrator can configure crop storage requirements.", "INVALID_STORAGE_REQUIREMENT", 403);
    }

    const crop = await this.referenceData.getActiveCropOrThrow(cropId);
    const existing = await this.cropRequirements.findByCropId(crop.id);

    const nextTempMin = patch.preferredTemperatureMin !== undefined ? patch.preferredTemperatureMin : existing?.preferredTemperatureMin === null || existing?.preferredTemperatureMin === undefined ? null : Number(existing.preferredTemperatureMin);
    const nextTempMax = patch.preferredTemperatureMax !== undefined ? patch.preferredTemperatureMax : existing?.preferredTemperatureMax === null || existing?.preferredTemperatureMax === undefined ? null : Number(existing.preferredTemperatureMax);
    if (nextTempMin !== null && nextTempMax !== null && nextTempMin > nextTempMax) {
      throw new WarehouseDomainError("Minimum preferred temperature cannot exceed the maximum.", "INVALID_TEMPERATURE_RANGE");
    }

    const nextHumidityMin = patch.preferredHumidityMin !== undefined ? patch.preferredHumidityMin : existing?.preferredHumidityMin === null || existing?.preferredHumidityMin === undefined ? null : Number(existing.preferredHumidityMin);
    const nextHumidityMax = patch.preferredHumidityMax !== undefined ? patch.preferredHumidityMax : existing?.preferredHumidityMax === null || existing?.preferredHumidityMax === undefined ? null : Number(existing.preferredHumidityMax);
    if (nextHumidityMin !== null && nextHumidityMax !== null && nextHumidityMin > nextHumidityMax) {
      throw new WarehouseDomainError("Minimum preferred humidity cannot exceed the maximum.", "INVALID_HUMIDITY_RANGE");
    }

    const data: UpsertCropStorageRequirementData = {
      cropId: crop.id,
      preferredTemperatureMin: nextTempMin,
      preferredTemperatureMax: nextTempMax,
      preferredHumidityMin: nextHumidityMin,
      preferredHumidityMax: nextHumidityMax,
      requiresVentilation: patch.requiresVentilation !== undefined ? patch.requiresVentilation : existing?.requiresVentilation ?? null,
      requiresColdStorage: patch.requiresColdStorage !== undefined ? patch.requiresColdStorage : existing?.requiresColdStorage ?? null,
      requiresControlledAtmosphere:
        patch.requiresControlledAtmosphere !== undefined ? patch.requiresControlledAtmosphere : existing?.requiresControlledAtmosphere ?? null,
      requiresPestControl: patch.requiresPestControl !== undefined ? patch.requiresPestControl : existing?.requiresPestControl ?? null,
      requiresMoistureControl:
        patch.requiresMoistureControl !== undefined ? patch.requiresMoistureControl : existing?.requiresMoistureControl ?? null,
      compatibleStorageTypes: (patch.compatibleStorageTypes as any) ?? existing?.compatibleStorageTypes ?? [],
      maximumRecommendedStorageDays:
        patch.maximumRecommendedStorageDays !== undefined ? patch.maximumRecommendedStorageDays : existing?.maximumRecommendedStorageDays ?? null,
      notes: patch.notes !== undefined ? patch.notes : existing?.notes ?? null,
    };

    const updated = await this.cropRequirements.upsert(data);

    await this.audit.record({
      actorUserId: actor.id,
      action: "CROP_STORAGE_REQUIREMENT_UPDATED",
      entityType: "CropStorageRequirement",
      entityId: crop.id,
      metadata: { cropId: crop.id },
    });
    await invalidateWarehouseCache();

    return toCropStorageRequirementSummary(updated);
  }
}
