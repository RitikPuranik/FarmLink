import { ConflictError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuditService } from "../audit/audit.service";
import { RequestMeta } from "../auth/auth.types";
import { FarmsRepository } from "../farms/farms.repository";
import { toFarmDTO } from "../farms/farms.types";
import { FarmerCropRepository } from "../crops/farmer-crop.repository";
import { toFarmerCropDTO } from "../crops/crops.types";
import { ReferenceDataService } from "../reference-data/reference-data.service";
import { calculateCompletion, CompletionResult } from "./completion";
import { FarmerProfileRepository } from "./farmer-profile.repository";
import { FarmerProfileResolver } from "./farmer-profile.resolver";
import { FarmerProfileRequestBody } from "./farmers.schemas";
import { FarmerProfileAggregateDTO, toFarmerProfileDTO } from "./farmers.types";

export class FarmersService {
  constructor(
    private readonly profiles: FarmerProfileRepository,
    private readonly resolver: FarmerProfileResolver,
    private readonly farms: FarmsRepository,
    private readonly farmerCrops: FarmerCropRepository,
    private readonly referenceData: ReferenceDataService,
    private readonly audit: AuditService,
  ) {}

  private async buildAggregate(userId: string): Promise<FarmerProfileAggregateDTO> {
    const profile = await this.resolver.ensure(userId);
    const [farmRows, cropRows, fpo] = await Promise.all([
      this.farms.findManyByFarmerProfileId(profile.id),
      this.farmerCrops.findManyByFarmerProfileId(profile.id),
      profile.fpoId ? this.referenceData.getFpoById(profile.fpoId) : Promise.resolve(null),
    ]);

    const farms = farmRows.map(toFarmDTO);
    const crops = cropRows.map(toFarmerCropDTO);
    const completion = calculateCompletion({ profile, farms, crops });

    return { profile: toFarmerProfileDTO(profile, fpo), farms, crops, completion };
  }

  async getMyAggregate(userId: string): Promise<FarmerProfileAggregateDTO> {
    return this.buildAggregate(userId);
  }

  async getCompletion(userId: string): Promise<CompletionResult> {
    const { completion } = await this.buildAggregate(userId);
    return completion;
  }

  /**
   * Validates the FPO-related and fpoId-clearing rules shared by create
   * and update, then resolves what fpoId should actually be persisted.
   * Build spec section 22: never trust a client-supplied FPO id without
   * verifying it exists; and if the farmer isn't (or is no longer) a
   * member, fpoId should not be left dangling from a previous answer.
   */
  private async resolveFpoId(
    input: FarmerProfileRequestBody,
    existingFpoId: string | null,
  ): Promise<string | null | undefined> {
    if (input.fpoMembershipStatus === undefined) {
      // Membership status isn't part of this request — leave fpoId alone
      // unless the caller explicitly touched it.
      if (input.fpoId === undefined) return undefined;
      if (input.fpoId === null) return null;
      await this.referenceData.assertFpoExists(input.fpoId);
      return input.fpoId;
    }

    if (input.fpoMembershipStatus !== "MEMBER") {
      // Not (or no longer) a member: never leave a stale fpoId behind.
      return null;
    }

    const fpoId = input.fpoId ?? existingFpoId;
    // The schema's refine already requires fpoId when status === MEMBER
    // for create, but update may be reaffirming MEMBER without resending
    // fpoId if it was already set — fall back to the existing value.
    await this.referenceData.assertFpoExists(fpoId!);
    return fpoId!;
  }

  private trackPreferenceEvents(userId: string, input: FarmerProfileRequestBody, resolvedFpoId: string | null | undefined) {
    if (resolvedFpoId !== undefined && resolvedFpoId !== null) {
      trackEvent("fpo_selected", userId, { fpoId: resolvedFpoId });
    }
    if (input.liquidityPreference !== undefined) {
      trackEvent("liquidity_preference_set", userId, { liquidityPreference: input.liquidityPreference });
    }
    if (input.willingToStore !== undefined) {
      trackEvent("storage_preference_set", userId, { willingToStore: input.willingToStore });
    }
  }

  async createProfile(
    userId: string,
    input: FarmerProfileRequestBody,
    meta: RequestMeta,
  ): Promise<FarmerProfileAggregateDTO> {
    const existing = await this.profiles.findByUserId(userId);
    if (existing) {
      throw new ConflictError("A farmer profile already exists for this account.");
    }

    const resolvedFpoId = await this.resolveFpoId(input, null);

    const created = await this.profiles.create({
      userId,
      fpoMembershipStatus: input.fpoMembershipStatus ?? null,
      fpoId: resolvedFpoId ?? null,
      liquidityPreference: input.liquidityPreference ?? null,
      willingToStore: input.willingToStore ?? null,
      communicationPreference: input.communicationPreference ?? "IN_APP",
    });

    await this.audit.record({
      actorUserId: userId,
      action: "FARMER_PROFILE_CREATED",
      entityType: "FarmerProfile",
      entityId: created.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("profile_started", userId, {});
    this.trackPreferenceEvents(userId, input, resolvedFpoId);

    return this.buildAggregate(userId);
  }

  async updateProfile(
    userId: string,
    input: FarmerProfileRequestBody,
    meta: RequestMeta,
  ): Promise<FarmerProfileAggregateDTO> {
    // PATCH is idempotent-create for this singleton resource — see
    // FarmerProfileResolver's doc comment for why this doesn't weaken the
    // POST /profile duplicate check above.
    const profile = await this.resolver.ensure(userId);

    const resolvedFpoId = await this.resolveFpoId(input, profile.fpoId);

    await this.profiles.update(profile.id, {
      ...(input.fpoMembershipStatus !== undefined ? { fpoMembershipStatus: input.fpoMembershipStatus } : {}),
      ...(resolvedFpoId !== undefined ? { fpoId: resolvedFpoId } : {}),
      ...(input.liquidityPreference !== undefined ? { liquidityPreference: input.liquidityPreference } : {}),
      ...(input.willingToStore !== undefined ? { willingToStore: input.willingToStore } : {}),
      ...(input.communicationPreference !== undefined
        ? { communicationPreference: input.communicationPreference }
        : {}),
    });

    await this.audit.record({
      actorUserId: userId,
      action: "PREFERENCE_UPDATED",
      entityType: "FarmerProfile",
      entityId: profile.id,
      metadata: { fields: Object.keys(input) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    if (typeof resolvedFpoId === "string") {
      await this.audit.record({
        actorUserId: userId,
        action: "FPO_ASSOCIATED",
        entityType: "FarmerProfile",
        entityId: profile.id,
        metadata: { fpoId: resolvedFpoId },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
    this.trackPreferenceEvents(userId, input, resolvedFpoId);

    const aggregate = await this.buildAggregate(userId);
    if (aggregate.completion.percentage === 100) {
      trackEvent("profile_completed", userId, {});
    }
    return aggregate;
  }
}
