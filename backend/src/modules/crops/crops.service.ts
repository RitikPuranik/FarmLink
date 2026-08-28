import { AuthorizationError, ConflictError, NotFoundError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuditService } from "../audit/audit.service";
import { RequestMeta } from "../auth/auth.types";
import { FarmsRepository } from "../farms/farms.repository";
import { FarmerProfileResolver } from "../farmers/farmer-profile.resolver";
import { ReferenceDataService } from "../reference-data/reference-data.service";
import { FarmerCropRepository, FarmerCropWithCrop } from "./farmer-crop.repository";
import { AddFarmerCropRequestBody, UpdateFarmerCropRequestBody } from "./crops.schemas";
import { FarmerCropDTO, toFarmerCropDTO } from "./crops.types";

export class CropsService {
  constructor(
    private readonly farmerCrops: FarmerCropRepository,
    private readonly farms: FarmsRepository,
    private readonly profiles: FarmerProfileResolver,
    private readonly referenceData: ReferenceDataService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<FarmerCropDTO[]> {
    const profile = await this.profiles.ensure(userId);
    const rows = await this.farmerCrops.findManyByFarmerProfileId(profile.id);
    return rows.map(toFarmerCropDTO);
  }

  /** Same ownership derivation rule as farms: session, never client input (section 48). */
  private async getOwnedOrThrow(userId: string, farmerCropId: string): Promise<FarmerCropWithCrop> {
    const profile = await this.profiles.ensure(userId);
    const row = await this.farmerCrops.findById(farmerCropId);
    if (!row || row.farmerProfileId !== profile.id) {
      throw new NotFoundError("Crop record not found.");
    }
    return row;
  }

  async add(userId: string, input: AddFarmerCropRequestBody, meta: RequestMeta): Promise<FarmerCropDTO> {
    const profile = await this.profiles.ensure(userId);

    // Build spec section 58: attaching a crop to a farm you don't own is
    // an explicit 403, distinct from the "safe not-found" style used by
    // direct farm CRUD — here the farmId came from the crop-add form, so
    // there is no ambiguity to hide behind a generic 404.
    const farm = await this.farms.findById(input.farmId);
    if (!farm) {
      throw new NotFoundError("Farm not found.");
    }
    if (farm.farmerProfileId !== profile.id) {
      throw new AuthorizationError("You can only add crops to your own farm.");
    }

    const crop = await this.referenceData.getActiveCropOrThrow(input.cropId);

    // Section 44: one farmer-crop row per (farm, crop) pair. Checked
    // explicitly here (matching the rest of this codebase's convention —
    // see auth.service.ts register()) rather than relying on catching the
    // DB's unique-constraint error, so the 409 carries a clear field-level
    // message instead of a translated database error code.
    const existingPair = await this.farmerCrops.findByFarmAndCrop(farm.id, crop.id);
    if (existingPair) {
      throw new ConflictError("This crop is already recorded for this farm.", {
        cropId: "This crop is already recorded for this farm.",
      });
    }

    const created = await this.farmerCrops.create({
      farmerProfileId: profile.id,
      farmId: farm.id,
      cropId: crop.id,
      area: input.area,
      areaUnit: input.areaUnit,
      typicalYield: input.typicalYield ?? null,
      yieldUnit: input.yieldUnit ?? null,
      // isPrimary is set through the dedicated transaction below so a
      // farm can never end up with two primary crops (section 20/45),
      // including on the very first crop added to a farm.
      isPrimary: false,
    });

    const finalRow = input.isPrimary ? await this.farmerCrops.setPrimary(farm.id, created.id) : created;

    await this.audit.record({
      actorUserId: userId,
      action: "CROP_ADDED",
      entityType: "FarmerCrop",
      entityId: finalRow.id,
      metadata: { cropId: crop.id, farmId: farm.id, isPrimary: finalRow.isPrimary },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("crop_added", userId, { cropId: crop.id });
    if (finalRow.isPrimary) {
      trackEvent("primary_crop_selected", userId, { cropId: crop.id });
    }

    return toFarmerCropDTO(finalRow);
  }

  async update(
    userId: string,
    farmerCropId: string,
    input: UpdateFarmerCropRequestBody,
    meta: RequestMeta,
  ): Promise<FarmerCropDTO> {
    const existing = await this.getOwnedOrThrow(userId, farmerCropId);

    const { isPrimary, ...editableFields } = input;
    let row = existing;
    if (Object.keys(editableFields).length > 0) {
      row = await this.farmerCrops.update(existing.id, editableFields);
    }
    if (isPrimary === true && !row.isPrimary) {
      row = await this.farmerCrops.setPrimary(existing.farmId, existing.id);
    }

    await this.audit.record({
      actorUserId: userId,
      action: "CROP_UPDATED",
      entityType: "FarmerCrop",
      entityId: row.id,
      metadata: { fields: Object.keys(input) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    if (isPrimary === true) {
      trackEvent("primary_crop_selected", userId, { cropId: row.cropId });
    }

    return toFarmerCropDTO(row);
  }

  async remove(userId: string, farmerCropId: string, meta: RequestMeta): Promise<void> {
    const existing = await this.getOwnedOrThrow(userId, farmerCropId);
    await this.farmerCrops.delete(existing.id);

    await this.audit.record({
      actorUserId: userId,
      action: "CROP_REMOVED",
      entityType: "FarmerCrop",
      entityId: existing.id,
      metadata: { cropId: existing.cropId, farmId: existing.farmId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("crop_removed", userId, { cropId: existing.cropId });
  }
}
