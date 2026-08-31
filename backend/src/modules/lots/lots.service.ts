import { QuantityUnit } from "@prisma/client";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { FarmerProfileResolver } from "../farmers/farmer-profile.resolver";
import { FarmsRepository, FarmWithLocation } from "../farms/farms.repository";
import { FarmerCropRepository } from "../crops/farmer-crop.repository";
import { FpoRepository } from "../fpo/fpo.repository";
import { ReferenceDataService } from "../reference-data/reference-data.service";
import { convertKgToQuantity, convertQuantityToKg } from "../fpo/unit-conversion";
import { CropLotListFilters, CropLotRepository, UpdateCropLotData } from "./lots.repository";
import { CANCELLABLE_STATUSES, LotStatusService } from "./lot-status.service";
import { LotAuthorizationService } from "./lot.authorization";
import { CreateLotInput, ListLotsQuery, UpdateDraftLotInput } from "./lots.schemas";
import { CropLotDTO, CropLotWithRelations, FarmerLotSummaryDTO, LotStatusHistoryEntryDTO, toCropLotDTO } from "./lots.types";

export interface LotListResult {
  items: CropLotDTO[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Build spec section 94/102: the service layer for Module 4. Controllers
 * only parse/validate/respond (build spec section 95); every ownership
 * check, state-machine rule and audit/analytics call for a CropLot lives
 * here, reusing Module 1-3's own services rather than re-implementing any
 * of them (FarmerProfileResolver, ReferenceDataService,
 * FpoAuthorizationService via LotAuthorizationService, AuditService).
 */
export class LotsService {
  constructor(
    private readonly lots: CropLotRepository,
    private readonly farms: FarmsRepository,
    private readonly farmerCrops: FarmerCropRepository,
    private readonly farmerProfiles: FarmerProfileResolver,
    private readonly fpos: FpoRepository,
    private readonly referenceData: ReferenceDataService,
    private readonly lotStatus: LotStatusService,
    private readonly lotAuthorization: LotAuthorizationService,
    private readonly audit: AuditService,
    private readonly frontendUrl: string,
  ) {}

  async createLot(user: AuthenticatedUserContext, input: CreateLotInput, meta: RequestMeta): Promise<CropLotDTO> {
    // The schema guarantees exactly one of farmId/fpoId is present (build
    // spec section 6/12/14) — which branch runs is decided by the field,
    // and each branch re-checks it's talking to the right role.
    return input.farmId ? this.createFarmerLot(user, input, meta) : this.createFpoLot(user, input, meta);
  }

  private async createFarmerLot(user: AuthenticatedUserContext, input: CreateLotInput, meta: RequestMeta): Promise<CropLotDTO> {
    if (user.role !== "FARMER") {
      throw new AuthorizationError("Only a farmer can create a lot for their own farm.");
    }

    const farmerProfile = await this.farmerProfiles.ensure(user.id);

    // Build spec section 13/49/80: never trust farmerId from the request —
    // ownership is derived from the authenticated session. Mirrors
    // CropsService's own farm-reference check (a farm referenced from
    // outside its own /api/farms endpoints: missing farm -> 404, a farm
    // that exists but belongs to someone else -> 403) rather than
    // FarmsService.getOwnedOrThrow's uniform "safe not-found" (that one is
    // for the farm's *own* endpoints addressing it directly by id).
    const farm = await this.farms.findById(input.farmId!);
    if (!farm) {
      throw new NotFoundError("Farm not found.");
    }
    if (farm.farmerProfileId !== farmerProfile.id) {
      throw new AuthorizationError("You can only create a lot for your own farm.");
    }

    const crop = await this.referenceData.getActiveCropOrThrow(input.cropId);

    // Build spec section 34: the crop must already be listed against this
    // farm via Module 2's FarmerCrop, otherwise this would let a farmer
    // silently invent a crop/farm pairing that never went through profile
    // setup.
    const association = await this.farmerCrops.findByFarmAndCrop(farm.id, crop.id);
    if (!association) {
      throw new ValidationError("Please correct the highlighted fields", {
        cropId: "This crop is not listed for the selected farm. Add it to your farm profile first.",
      });
    }

    const quantityKg = convertQuantityToKg(input.quantity, input.unit);

    const created = await this.lots.create(
      {
        ownerType: "FARMER",
        sourceType: "FARMER_CREATED",
        farmerId: farmerProfile.id,
        fpoId: null,
        cropId: crop.id,
        farmId: farm.id,
        variety: input.variety ?? null,
        unit: input.unit,
        quantityKg,
        harvestDate: input.harvestDate ?? null,
        availabilityDate: input.availabilityDate,
        // Origin snapshot (build spec section 17/18/55) — copied now, never
        // re-derived from the live Farm later.
        originVillage: farm.village,
        originTaluka: farm.taluka.name,
        originDistrict: farm.district.name,
        originState: farm.state.name,
      },
      user.id,
    );

    await this.recordCreated(user, created, meta);
    return toCropLotDTO(created, this.frontendUrl);
  }

  private async createFpoLot(user: AuthenticatedUserContext, input: CreateLotInput, meta: RequestMeta): Promise<CropLotDTO> {
    if (user.role !== "FPO_ADMIN" && user.role !== "ADMIN") {
      throw new AuthorizationError("Only an FPO admin can create a lot for an FPO.");
    }

    const fpo = await this.fpos.findByPublicId(input.fpoId!);
    if (!fpo) {
      throw new NotFoundError("FPO not found.");
    }

    // Build spec section 14/50: an FPO admin may only create a lot for an
    // FPO they actively administer — never trust fpoId alone, and never
    // allow one FPO's admin to create a lot for a different FPO. This
    // reuses Module 3's own FpoAuthorizationService (via
    // LotAuthorizationService), so it's the exact same rule Module 3
    // already enforces for aggregation groups — not a re-implementation.
    const canManage = await this.lotAuthorization.canManageFpoLot(user, fpo.id);
    if (!canManage) {
      throw new AuthorizationError("You do not have permission to manage this FPO.");
    }

    const crop = await this.referenceData.getActiveCropOrThrow(input.cropId);
    const quantityKg = convertQuantityToKg(input.quantity, input.unit);

    const created = await this.lots.create(
      {
        ownerType: "FPO",
        sourceType: "FPO_AGGREGATED",
        farmerId: null,
        fpoId: fpo.id,
        cropId: crop.id,
        farmId: null,
        variety: input.variety ?? null,
        unit: input.unit,
        quantityKg,
        harvestDate: input.harvestDate ?? null,
        availabilityDate: input.availabilityDate,
        // An FPO-owned lot has no single Farm to snapshot from — its own
        // registered address stands in (build spec section 17 adapted to
        // the FPO ownership case described in section 6/35).
        originVillage: fpo.village,
        originTaluka: fpo.taluka ? fpo.taluka.name : null,
        originDistrict: fpo.district.name,
        originState: fpo.state.name,
      },
      user.id,
    );

    await this.recordCreated(user, created, meta);
    return toCropLotDTO(created, this.frontendUrl);
  }

  private async recordCreated(user: AuthenticatedUserContext, lot: CropLotWithRelations, meta: RequestMeta): Promise<void> {
    await this.audit.record({
      actorUserId: user.id,
      action: "LOT_CREATED",
      entityType: "CropLot",
      entityId: lot.id,
      metadata: { ownerType: lot.ownerType, sourceType: lot.sourceType, cropId: lot.cropId, status: lot.status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("lot_created", user.id, { ownerType: lot.ownerType, sourceType: lot.sourceType });
  }

  /**
   * Resolves a lot by its public id AND enforces view/modify authorization
   * in one place (mirrors FarmsService.getOwnedOrThrow). Build spec section
   * 43/76: a lot's existence is not public information — an unauthorized
   * caller gets the same "not found" a truly nonexistent publicId would
   * produce, never a 403 that would confirm the lot exists.
   */
  private async loadOwnedLotOrThrow(user: AuthenticatedUserContext, publicId: string): Promise<CropLotWithRelations> {
    const lot = await this.lots.findByPublicId(publicId);
    if (!lot) throw new NotFoundError("Lot not found.");

    const callerFarmerProfileId = user.role === "FARMER" ? (await this.farmerProfiles.ensure(user.id)).id : null;
    const canView = await this.lotAuthorization.canViewLot(user, lot, callerFarmerProfileId);
    if (!canView) throw new NotFoundError("Lot not found.");

    return lot;
  }

  async listMyLots(user: AuthenticatedUserContext, query: ListLotsQuery): Promise<LotListResult> {
    const profile = await this.farmerProfiles.ensure(user.id);
    const filters: CropLotListFilters = { status: query.status, cropId: query.cropId, farmId: query.farmId };
    const result = await this.lots.listByFarmerId(profile.id, filters, query.page, query.limit);
    return {
      items: result.items.map((lot) => toCropLotDTO(lot, this.frontendUrl, query.unit)),
      total: result.total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** Build spec section 23/76: an FPO admin's view of their own FPO's
   * lots, mounted separately at `/api/fpos/:fpoId/lots` — see
   * lots.routes.ts. */
  async listFpoLots(user: AuthenticatedUserContext, fpoPublicId: string, query: ListLotsQuery): Promise<LotListResult> {
    const fpo = await this.fpos.findByPublicId(fpoPublicId);
    if (!fpo) throw new NotFoundError("FPO not found.");

    const canManage = await this.lotAuthorization.canManageFpoLot(user, fpo.id);
    if (!canManage) throw new AuthorizationError("You do not have permission to manage this FPO.");

    const filters: CropLotListFilters = { status: query.status, cropId: query.cropId, farmId: query.farmId };
    const result = await this.lots.listByFpoId(fpo.id, filters, query.page, query.limit);
    return {
      items: result.items.map((lot) => toCropLotDTO(lot, this.frontendUrl, query.unit)),
      total: result.total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getLot(user: AuthenticatedUserContext, publicId: string, displayUnit?: QuantityUnit): Promise<CropLotDTO> {
    const lot = await this.loadOwnedLotOrThrow(user, publicId);
    trackEvent("lot_viewed", user.id, { status: lot.status });
    return toCropLotDTO(lot, this.frontendUrl, displayUnit);
  }

  async updateDraftLot(
    user: AuthenticatedUserContext,
    publicId: string,
    input: UpdateDraftLotInput,
    meta: RequestMeta,
  ): Promise<CropLotDTO> {
    const lot = await this.loadOwnedLotOrThrow(user, publicId);

    // Build spec section 24: only a still-DRAFT lot may be edited this way.
    if (lot.status !== "DRAFT") {
      throw new ConflictError("Only draft lots can be updated.");
    }

    const updateData: UpdateCropLotData = {};
    let effectiveFarm: FarmWithLocation | null = null;

    if (input.farmId !== undefined) {
      if (lot.ownerType !== "FARMER") {
        throw new ValidationError("Please correct the highlighted fields", { farmId: "This lot has no associated farm." });
      }
      const farmerProfile = await this.farmerProfiles.ensure(user.id);
      const farm = await this.farms.findById(input.farmId);
      if (!farm) {
        throw new NotFoundError("Farm not found.");
      }
      if (farm.farmerProfileId !== farmerProfile.id) {
        throw new AuthorizationError("You can only assign your own farm to this lot.");
      }
      effectiveFarm = farm;
      updateData.farmId = farm.id;
      updateData.originVillage = farm.village;
      updateData.originTaluka = farm.taluka.name;
      updateData.originDistrict = farm.district.name;
      updateData.originState = farm.state.name;
    }

    let effectiveCropId = lot.cropId;
    if (input.cropId !== undefined) {
      const crop = await this.referenceData.getActiveCropOrThrow(input.cropId);
      effectiveCropId = crop.id;
      updateData.cropId = crop.id;
    }

    // Re-validate the farmer-crop association whenever either side changes
    // (build spec section 34).
    if (lot.ownerType === "FARMER" && (input.farmId !== undefined || input.cropId !== undefined)) {
      const effectiveFarmId = effectiveFarm ? effectiveFarm.id : lot.farmId!;
      const association = await this.farmerCrops.findByFarmAndCrop(effectiveFarmId, effectiveCropId);
      if (!association) {
        throw new ValidationError("Please correct the highlighted fields", {
          cropId: "This crop is not listed for the selected farm. Add it to your farm profile first.",
        });
      }
    }

    if (input.quantity !== undefined || input.unit !== undefined) {
      const unit = input.unit ?? lot.unit;
      const quantityValue = input.quantity ?? convertKgToQuantity(Number(lot.quantityKg), lot.unit);
      const quantityKg = convertQuantityToKg(quantityValue, unit);
      updateData.unit = unit;
      updateData.quantityKg = quantityKg;
      // Build spec section 29/74: quantity protection only begins once a
      // lot leaves DRAFT — while still DRAFT, available always tracks the
      // new total exactly.
      updateData.availableQuantityKg = quantityKg;
    }

    if (input.variety !== undefined) updateData.variety = input.variety;
    if (input.harvestDate !== undefined) updateData.harvestDate = input.harvestDate;
    if (input.availabilityDate !== undefined) updateData.availabilityDate = input.availabilityDate;

    // Build spec section 20: harvestDate <= availabilityDate must still
    // hold using whichever of the two didn't change in this request — the
    // schema's own check (lots.schemas.ts) only covers the case where both
    // are supplied together.
    const effectiveHarvestDate = input.harvestDate !== undefined ? input.harvestDate : lot.harvestDate;
    const effectiveAvailabilityDate = input.availabilityDate !== undefined ? input.availabilityDate : lot.availabilityDate;
    if (effectiveHarvestDate && effectiveAvailabilityDate && effectiveHarvestDate.getTime() > effectiveAvailabilityDate.getTime()) {
      throw new ValidationError("Please correct the highlighted fields", {
        harvestDate: "Harvest date must be on or before the availability date.",
      });
    }

    const updated = await this.lots.updateDraft(lot.id, updateData);

    await this.audit.record({
      actorUserId: user.id,
      action: "LOT_UPDATED",
      entityType: "CropLot",
      entityId: updated.id,
      metadata: { fields: Object.keys(input) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("lot_updated", user.id, { status: updated.status });

    return toCropLotDTO(updated, this.frontendUrl);
  }

  async deleteDraftLot(user: AuthenticatedUserContext, publicId: string, meta: RequestMeta): Promise<void> {
    const lot = await this.loadOwnedLotOrThrow(user, publicId);

    // Build spec section 25: only a still-DRAFT lot may be hard-deleted —
    // an AVAILABLE (or later) lot must be cancelled instead, so a
    // transactional object never simply disappears from history.
    if (lot.status !== "DRAFT") {
      throw new ConflictError("Only draft lots can be deleted. Cancel an available lot instead.");
    }

    await this.lots.deleteDraft(lot.id);

    await this.audit.record({
      actorUserId: user.id,
      action: "LOT_DELETED",
      entityType: "CropLot",
      entityId: lot.id,
      metadata: { lotNumber: lot.lotNumber },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  async publishLot(user: AuthenticatedUserContext, publicId: string, meta: RequestMeta): Promise<CropLotDTO> {
    const lot = await this.loadOwnedLotOrThrow(user, publicId);

    // Build spec section 73: DRAFT + a positive quantity is everything
    // Module 4 requires before a lot may become AVAILABLE — every other
    // required field is already mandatory at creation time.
    if (lot.status !== "DRAFT") {
      throw new ConflictError("Only draft lots can be published.");
    }
    if (Number(lot.quantityKg) <= 0) {
      throw new ConflictError("A lot must have a positive quantity before it can be published.");
    }
    this.lotStatus.validateTransition(lot.status, "AVAILABLE");

    const updated = await this.lots.transition(lot.id, ["DRAFT"], "AVAILABLE", {
      actorUserId: user.id,
      fromStatus: lot.status,
    });
    if (!updated) {
      throw new ConflictError("This lot was already updated by someone else. Please refresh and try again.");
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "LOT_PUBLISHED",
      entityType: "CropLot",
      entityId: updated.id,
      metadata: { fromStatus: "DRAFT", toStatus: "AVAILABLE" },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("lot_published", user.id, { cropId: updated.cropId });

    return toCropLotDTO(updated, this.frontendUrl);
  }

  async cancelLot(user: AuthenticatedUserContext, publicId: string, reason: string | undefined, meta: RequestMeta): Promise<CropLotDTO> {
    const lot = await this.loadOwnedLotOrThrow(user, publicId);

    // Build spec section 75: cancellation is blocked once a lot has
    // entered a transaction-committed state.
    if (!CANCELLABLE_STATUSES.includes(lot.status)) {
      throw new ConflictError("This lot can no longer be cancelled — it is already part of a downstream transaction.");
    }
    this.lotStatus.validateTransition(lot.status, "CANCELLED");

    const updated = await this.lots.transition(lot.id, CANCELLABLE_STATUSES, "CANCELLED", {
      actorUserId: user.id,
      fromStatus: lot.status,
      reason,
    });
    if (!updated) {
      throw new ConflictError("This lot was already updated by someone else. Please refresh and try again.");
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "LOT_CANCELLED",
      entityType: "CropLot",
      entityId: updated.id,
      metadata: { fromStatus: lot.status, reason: reason ?? null },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("lot_cancelled", user.id, { fromStatus: lot.status });

    return toCropLotDTO(updated, this.frontendUrl);
  }

  async getLotHistory(user: AuthenticatedUserContext, publicId: string): Promise<LotStatusHistoryEntryDTO[]> {
    const lot = await this.loadOwnedLotOrThrow(user, publicId);
    return this.lots.getHistory(lot.id);
  }

  async getFarmerSummary(user: AuthenticatedUserContext): Promise<FarmerLotSummaryDTO> {
    const profile = await this.farmerProfiles.ensure(user.id);
    return this.lots.summarizeForFarmer(profile.id);
  }
}
