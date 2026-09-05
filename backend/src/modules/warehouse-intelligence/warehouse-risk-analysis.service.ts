import { QuantityUnit } from "@prisma/client";
import { AuthenticatedUserContext } from "../auth/auth.types";
import { WarehouseDomainError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { ReferenceDataService } from "../reference-data/reference-data.service";
import { resolveCropCompatibility, resolveMaxStorageDurationDays } from "./warehouse-capacity";
import { compareDuration, evaluateOperationalStatus, evaluateWarehouseSuitabilityRisk } from "./warehouse-risk-analysis.engine";
import { RISK_ANALYSIS_DISCLAIMER, WarehouseSuitabilityAnalysisResult } from "./warehouse-risk-analysis.types";
import { WarehouseAvailabilityService } from "./warehouse-availability.service";
import { WarehouseSuitabilityService } from "./warehouse-suitability.service";
import { WarehouseRepository } from "./warehouse.repository";
import { WarehouseWithCapacity } from "./warehouse.types";

export interface AnalyzeSuitabilityInput {
  cropId: string;
  quantity?: number;
  unit?: QuantityUnit;
  durationDays?: number;
}

// Mirrors WarehouseAvailabilityService's own visibility rule exactly (see
// that file's own comment on why this is a small local copy, not a
// shared export).
function isWarehouseVisibleTo(actor: AuthenticatedUserContext, warehouse: WarehouseWithCapacity): boolean {
  if (actor.role === "ADMIN") return true;
  if (warehouse.ownerUserId === actor.id) return true;
  return warehouse.status === "ACTIVE" && warehouse.isActive;
}

/**
 * Module 9 Part 4 — Warehouse Suitability & Risk Analysis. Composes
 * Part 1 (crop compatibility, configured max storage duration), Part 2
 * (capacity — via WarehouseAvailabilityService, never recomputed here),
 * and Part 3 (environmental/storage-condition suitability — via
 * WarehouseSuitabilityService, never recomputed here) into one
 * deterministic risk/constraint/score result via
 * warehouse-risk-analysis.engine.ts. This service's only original
 * evaluation logic is duration compatibility and operational status —
 * everything else is delegated to the parts that already own it.
 *
 * Deliberately does not accept a CropLot id and does not depend on a
 * lots repository: this excerpt of the repository doesn't include
 * Module 4's lot data-access layer, and guessing at its interface would
 * risk a silent wiring mismatch. A caller that already has a resolved
 * lot (e.g. a future Module 8 integration) can pass its cropId/quantity/
 * duration through AnalyzeSuitabilityInput directly instead.
 */
export class WarehouseSuitabilityAnalysisService {
  constructor(
    private readonly warehouses: WarehouseRepository,
    private readonly availability: WarehouseAvailabilityService,
    private readonly suitability: WarehouseSuitabilityService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /** GET /api/warehouses/:warehouseId/suitability-analysis?cropId=&quantity=&unit=&durationDays= */
  async analyzeSuitability(
    warehousePublicId: string,
    input: AnalyzeSuitabilityInput,
    actor: AuthenticatedUserContext,
  ): Promise<WarehouseSuitabilityAnalysisResult> {
    if (input.durationDays !== undefined && (!Number.isFinite(input.durationDays) || input.durationDays <= 0)) {
      throw new WarehouseDomainError("Requested storage duration must be a positive number of days.", "INVALID_DURATION");
    }

    const crop = await this.referenceData.getActiveCropOrThrow(input.cropId);

    // Part 2 owns capacity + crop compatibility resolution — reused here,
    // never recalculated (build spec: "do not recalculate capacity
    // differently if Part [2] already owns that logic").
    const availabilityDto = await this.availability.getStorageAvailability(
      warehousePublicId,
      { cropId: input.cropId, quantity: input.quantity, unit: input.unit },
      actor,
    );

    // Part 3 owns environmental/storage-condition suitability — reused
    // here, never recomputed.
    const suitabilityDto = await this.suitability.getSuitability(warehousePublicId, input.cropId, actor);

    // Duration and operational status are this part's own new factors —
    // both read directly off already-persisted fields, never inferred.
    const warehouse = await this.warehouses.findByPublicIdWithCapacity(warehousePublicId, input.cropId);
    if (!warehouse) throw new WarehouseDomainError("Warehouse not found.", "WAREHOUSE_NOT_FOUND", 404);
    if (!isWarehouseVisibleTo(actor, warehouse)) {
      throw new WarehouseDomainError("Warehouse not found.", "WAREHOUSE_NOT_FOUND", 404);
    }

    const maxStorageDurationDays = resolveMaxStorageDurationDays(
      warehouse.capabilities.filter((c) => c.crop.id === crop.id),
    );
    const durationCompatibility = compareDuration(input.durationDays, maxStorageDurationDays);
    const operationalStatus = evaluateOperationalStatus(warehouse.status, warehouse.isActive);
    const cropCompatibility =
      availabilityDto.compatibility ?? resolveCropCompatibility(warehouse.capabilities.filter((c) => c.crop.id === crop.id));

    const quantityRequested = input.quantity !== undefined && input.unit !== undefined;

    const engineResult = evaluateWarehouseSuitabilityRisk({
      cropCompatibility,
      capacityStatus: availabilityDto.capacity.status,
      canAccommodate: availabilityDto.canAccommodate,
      quantityRequested,
      durationCompatibility,
      environmentalCompatibility: suitabilityDto.suitability.status,
      operationalStatus,
    });

    trackEvent("warehouse_suitability_analyzed", actor.id, {
      suitability: engineResult.suitability,
      hasBlockingIssue: engineResult.blockingIssues.length > 0,
    });

    return {
      warehouseId: warehouse.publicId,
      cropId: crop.id,
      suitability: engineResult.suitability,
      suitabilityScore: engineResult.suitabilityScore,
      confidence: engineResult.confidence,
      blockingIssues: engineResult.blockingIssues,
      risks: engineResult.risks,
      constraints: engineResult.constraints,
      factorsUsed: engineResult.factorsUsed,
      omittedFactors: engineResult.omittedFactors,
      cropCompatibility,
      durationCompatibility,
      environmentalCompatibility: suitabilityDto.suitability.status,
      operationalStatus,
      availabilitySummary: {
        status: availabilityDto.capacity.status,
        totalKg: availabilityDto.capacity.totalKg,
        availableKg: availabilityDto.capacity.availableKg,
        canAccommodate: availabilityDto.canAccommodate,
      },
      evaluatedAt: new Date().toISOString(),
      disclaimer: RISK_ANALYSIS_DISCLAIMER,
    };
  }
}
