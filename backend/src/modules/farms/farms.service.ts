import { NotFoundError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuditService } from "../audit/audit.service";
import { RequestMeta } from "../auth/auth.types";
import { FarmerProfileResolver } from "../farmers/farmer-profile.resolver";
import { ReferenceDataService } from "../reference-data/reference-data.service";
import { FarmsRepository, FarmWithLocation } from "./farms.repository";
import { CreateFarmRequestBody, UpdateFarmRequestBody } from "./farms.schemas";
import { FarmDTO, toFarmDTO } from "./farms.types";

export class FarmsService {
  constructor(
    private readonly farms: FarmsRepository,
    private readonly profiles: FarmerProfileResolver,
    private readonly referenceData: ReferenceDataService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<FarmDTO[]> {
    const profile = await this.profiles.ensure(userId);
    const farms = await this.farms.findManyByFarmerProfileId(profile.id);
    return farms.map(toFarmDTO);
  }

  /**
   * Resolves a farm AND enforces ownership in one place (build spec
   * section 37/48: only the owning farmer may touch their own farms,
   * derived from the authenticated session — never a client-supplied id).
   * A farm that exists but belongs to someone else responds identically
   * to one that doesn't exist at all ("safe not-found behavior", section
   * 37) so a farmer can't probe for other farmers' farm ids.
   */
  private async getOwnedOrThrow(userId: string, farmId: string): Promise<FarmWithLocation> {
    const profile = await this.profiles.ensure(userId);
    const farm = await this.farms.findById(farmId);
    if (!farm || farm.farmerProfileId !== profile.id) {
      throw new NotFoundError("Farm not found.");
    }
    return farm;
  }

  async get(userId: string, farmId: string): Promise<FarmDTO> {
    return toFarmDTO(await this.getOwnedOrThrow(userId, farmId));
  }

  async create(userId: string, input: CreateFarmRequestBody, meta: RequestMeta): Promise<FarmDTO> {
    const profile = await this.profiles.ensure(userId);
    await this.referenceData.assertValidLocationChain(input);

    const farm = await this.farms.create({ farmerProfileId: profile.id, ...input });

    await this.audit.record({
      actorUserId: userId,
      action: "FARM_CREATED",
      entityType: "Farm",
      entityId: farm.id,
      metadata: { areaUnit: farm.areaUnit, irrigationType: farm.irrigationType },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("farm_created", userId, { districtId: farm.districtId, areaUnit: farm.areaUnit });

    return toFarmDTO(farm);
  }

  async update(userId: string, farmId: string, input: UpdateFarmRequestBody, meta: RequestMeta): Promise<FarmDTO> {
    const farm = await this.getOwnedOrThrow(userId, farmId);

    if (input.stateId || input.districtId || input.talukaId) {
      await this.referenceData.assertValidLocationChain({
        stateId: input.stateId ?? farm.stateId,
        districtId: input.districtId ?? farm.districtId,
        talukaId: input.talukaId ?? farm.talukaId,
      });
    }

    const updated = await this.farms.update(farm.id, input);

    await this.audit.record({
      actorUserId: userId,
      action: "FARM_UPDATED",
      entityType: "Farm",
      entityId: updated.id,
      metadata: { fields: Object.keys(input) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("farm_updated", userId, { districtId: updated.districtId });

    return toFarmDTO(updated);
  }

  async remove(userId: string, farmId: string, meta: RequestMeta): Promise<void> {
    const farm = await this.getOwnedOrThrow(userId, farmId);
    await this.farms.delete(farm.id);

    await this.audit.record({
      actorUserId: userId,
      action: "FARM_DELETED",
      entityType: "Farm",
      entityId: farm.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
}
