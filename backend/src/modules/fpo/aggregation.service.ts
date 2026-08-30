import { ConflictError, NotFoundError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { FarmerCropRepository } from "../crops/farmer-crop.repository";
import { FarmerProfileRepository } from "../farmers/farmer-profile.repository";
import { ReferenceDataService } from "../reference-data/reference-data.service";
import { AggregationGroupRepository } from "./aggregation.repository";
import {
  AggregationGroupDTO,
  CropAggregationMemberRowDTO,
  CropAggregationRowDTO,
  FpoAnalyticsDTO,
  toAggregationGroupDTO,
} from "./aggregation.types";
import { CreateAggregationGroupInput, UpdateAggregationGroupInput } from "./aggregation.schemas";
import { FpoAuthorizationService } from "./fpo.authorization";
import { FpoRepository } from "./fpo.repository";
import { FpoMembershipRepository } from "./membership.repository";
import {
  AreaUnit,
  convertArea,
  convertKgToQuantity,
  estimateFarmerCropQuantityKg,
} from "./unit-conversion";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface CropBucket {
  cropName: string;
  farmerIds: Set<string>;
  farmersWithEstimate: Set<string>;
  totalAreaAcre: number;
  estimatedQuantityKg: number;
}

/**
 * The crop-aggregation engine (build spec section 27/72): reads Module 2's
 * farmer/farm/crop data for an FPO's ACTIVE members and rolls it up per
 * crop. This is estimated/visible supply only — it never reserves crops,
 * decrements farmer quantities, or creates a commitment (build spec
 * section 74/97). AggregationGroup ("targets") are a separate, explicit
 * planning object layered on top.
 */
export class FpoAggregationService {
  constructor(
    private readonly fpoRepo: FpoRepository,
    private readonly memberships: FpoMembershipRepository,
    private readonly farmerCrops: FarmerCropRepository,
    private readonly farmerProfiles: FarmerProfileRepository,
    private readonly aggregationGroups: AggregationGroupRepository,
    private readonly referenceData: ReferenceDataService,
    private readonly authorization: FpoAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private async resolveFpoOrThrow(fpoPublicId: string) {
    const fpo = await this.fpoRepo.findByPublicId(fpoPublicId);
    if (!fpo) {
      throw new NotFoundError("FPO not found.");
    }
    return fpo;
  }

  /** Build spec section 28/42/52: FPO_ADMIN (own FPO), ADMIN, or a
   * GOVERNMENT_VIEWER reading aggregate figures — never an ordinary farmer
   * browsing another FPO's internals. */
  private async assertCanViewAggregate(user: AuthenticatedUserContext, fpoId: string): Promise<void> {
    if (user.role === "GOVERNMENT_VIEWER") return;
    await this.authorization.assertCanManageFpo(user, fpoId);
  }

  /**
   * The core roll-up: one batched query for active members, one batched
   * query for all of their crop rows (build spec section 32/59 — no
   * per-farmer loop), then group-and-sum in memory since the yield-unit
   * parsing/conversion (unit-conversion.ts) can't be expressed as a plain
   * SQL GROUP BY.
   */
  async computeCropAggregation(fpoId: string): Promise<CropAggregationRowDTO[]> {
    const farmerIds = await this.memberships.listActiveFarmerProfileIdsForFpo(fpoId);
    if (farmerIds.length === 0) return [];

    const rows = await this.farmerCrops.findManyByFarmerProfileIds(farmerIds);
    const buckets = new Map<string, CropBucket>();

    for (const row of rows) {
      let bucket = buckets.get(row.cropId);
      if (!bucket) {
        bucket = {
          cropName: row.crop.name,
          farmerIds: new Set(),
          farmersWithEstimate: new Set(),
          totalAreaAcre: 0,
          estimatedQuantityKg: 0,
        };
        buckets.set(row.cropId, bucket);
      }

      bucket.farmerIds.add(row.farmerProfileId);
      bucket.totalAreaAcre += convertArea(row.area, row.areaUnit as AreaUnit, "ACRE");

      const estimate = estimateFarmerCropQuantityKg({
        area: row.area,
        areaUnit: row.areaUnit as AreaUnit,
        typicalYield: row.typicalYield,
        yieldUnit: row.yieldUnit,
      });
      if (estimate.estimatedQuantityKg !== null) {
        bucket.estimatedQuantityKg += estimate.estimatedQuantityKg;
        bucket.farmersWithEstimate.add(row.farmerProfileId);
      }
    }

    const calculatedAt = new Date().toISOString();
    return Array.from(buckets.entries()).map(([cropId, bucket]) => ({
      cropId,
      cropName: bucket.cropName,
      farmerCount: bucket.farmerIds.size,
      totalArea: round2(bucket.totalAreaAcre),
      areaUnit: "ACRE" as const,
      // Build spec section 30: never invent a number — if not a single
      // farmer growing this crop had usable yield data, the figure is
      // null, not zero.
      estimatedQuantity:
        bucket.farmersWithEstimate.size > 0 ? round2(convertKgToQuantity(bucket.estimatedQuantityKg, "QTL")) : null,
      quantityUnit: "QTL" as const,
      estimateCoverage: { farmersWithEstimate: bucket.farmersWithEstimate.size, totalFarmers: bucket.farmerIds.size },
      calculatedAt,
    }));
  }

  async getCropAggregation(user: AuthenticatedUserContext, fpoPublicId: string): Promise<CropAggregationRowDTO[]> {
    const fpo = await this.resolveFpoOrThrow(fpoPublicId);
    await this.assertCanViewAggregate(user, fpo.id);
    return this.computeCropAggregation(fpo.id);
  }

  /** Build spec section 33: the private per-farmer breakdown for one crop —
   * FPO admin (own FPO) or platform ADMIN only, never government/farmer. */
  async getCropAggregationMembers(
    user: AuthenticatedUserContext,
    fpoPublicId: string,
    cropId: string,
  ): Promise<CropAggregationMemberRowDTO[]> {
    const fpo = await this.resolveFpoOrThrow(fpoPublicId);
    await this.authorization.assertCanManageFpo(user, fpo.id);

    const farmerIds = await this.memberships.listActiveFarmerProfileIdsForFpo(fpo.id);
    if (farmerIds.length === 0) return [];

    const rows = (await this.farmerCrops.findManyByFarmerProfileIds(farmerIds)).filter((r) => r.cropId === cropId);
    if (rows.length === 0) return [];

    // A farmer can grow the same crop on more than one farm — sum per
    // farmer before resolving display names (one batched lookup, not one
    // per row/farmer, build spec section 59).
    const byFarmer = new Map<string, { areaAcre: number; quantityKg: number; hasEstimate: boolean }>();
    for (const row of rows) {
      const entry = byFarmer.get(row.farmerProfileId) ?? { areaAcre: 0, quantityKg: 0, hasEstimate: false };
      entry.areaAcre += convertArea(row.area, row.areaUnit as AreaUnit, "ACRE");
      const estimate = estimateFarmerCropQuantityKg({
        area: row.area,
        areaUnit: row.areaUnit as AreaUnit,
        typicalYield: row.typicalYield,
        yieldUnit: row.yieldUnit,
      });
      if (estimate.estimatedQuantityKg !== null) {
        entry.quantityKg += estimate.estimatedQuantityKg;
        entry.hasEstimate = true;
      }
      byFarmer.set(row.farmerProfileId, entry);
    }

    const farmers = await this.farmerProfiles.findManyByIdsWithUser(Array.from(byFarmer.keys()));
    const nameById = new Map(farmers.map((f) => [f.id, f.user]));

    return Array.from(byFarmer.entries()).map(([farmerId, entry]) => ({
      farmerPublicId: nameById.get(farmerId)?.publicId ?? farmerId,
      name: nameById.get(farmerId)?.fullName ?? null,
      area: round2(entry.areaAcre),
      areaUnit: "ACRE" as const,
      estimatedQuantity: entry.hasEstimate ? round2(convertKgToQuantity(entry.quantityKg, "QTL")) : null,
      quantityUnit: "QTL" as const,
    }));
  }

  /**
   * Future-integration seam (build spec section 94): "Expose aggregation
   * data through a service interface ... getFpoCropAvailability(fpoId,
   * cropId)". No route calls this yet — Buyer Matching (a later module)
   * will.
   */
  async getFpoCropAvailability(fpoId: string, cropId: string): Promise<{ estimatedQuantityKg: number | null }> {
    const rows = await this.computeCropAggregation(fpoId);
    const row = rows.find((r) => r.cropId === cropId);
    if (!row || row.estimatedQuantity === null) return { estimatedQuantityKg: null };
    return { estimatedQuantityKg: row.estimatedQuantity * 100 };
  }

  private async assertFpoActiveForManagement(fpoId: string) {
    const fpo = await this.fpoRepo.findById(fpoId);
    if (!fpo || fpo.accountStatus !== "ACTIVE") {
      throw new ConflictError("This FPO is not currently active.");
    }
    return fpo;
  }

  async createAggregationGroup(
    user: AuthenticatedUserContext,
    fpoPublicId: string,
    input: CreateAggregationGroupInput,
    meta: RequestMeta,
  ): Promise<AggregationGroupDTO> {
    const fpo = await this.resolveFpoOrThrow(fpoPublicId);
    await this.authorization.assertCanManageFpo(user, fpo.id);
    await this.assertFpoActiveForManagement(fpo.id);
    await this.referenceData.getActiveCropOrThrow(input.cropId);

    const liveQuantity = (await this.getFpoCropAvailability(fpo.id, input.cropId)).estimatedQuantityKg;
    const snapshotInUnit = liveQuantity !== null ? convertKgToQuantity(liveQuantity, input.unit) : null;

    const group = await this.aggregationGroups.create({
      fpoId: fpo.id,
      cropId: input.cropId,
      targetQuantity: input.targetQuantity ?? null,
      estimatedQuantity: snapshotInUnit !== null ? round2(snapshotInUnit) : null,
      unit: input.unit,
      targetDate: input.targetDate ?? null,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "AGGREGATION_CREATED",
      entityType: "AggregationGroup",
      entityId: group.id,
      metadata: { fpoId: fpo.id, cropId: input.cropId },
      ...meta,
    });
    trackEvent("aggregation_created", user.id, { fpoId: fpo.publicId, cropId: input.cropId });

    return toAggregationGroupDTO(group, snapshotInUnit !== null ? round2(snapshotInUnit) : null);
  }

  private async loadGroupOrThrow(fpoId: string, aggregationPublicId: string) {
    const group = await this.aggregationGroups.findByPublicId(aggregationPublicId);
    if (!group || group.fpoId !== fpoId) {
      throw new NotFoundError("Aggregation target not found.");
    }
    return group;
  }

  private async liveEstimateInUnit(fpoId: string, cropId: string, unit: "KG" | "QTL" | "TONNE") {
    const { estimatedQuantityKg } = await this.getFpoCropAvailability(fpoId, cropId);
    return estimatedQuantityKg !== null ? round2(convertKgToQuantity(estimatedQuantityKg, unit)) : null;
  }

  async getAggregationGroup(
    user: AuthenticatedUserContext,
    fpoPublicId: string,
    aggregationPublicId: string,
  ): Promise<AggregationGroupDTO> {
    const fpo = await this.resolveFpoOrThrow(fpoPublicId);
    await this.assertCanViewAggregate(user, fpo.id);
    const group = await this.loadGroupOrThrow(fpo.id, aggregationPublicId);
    const live = await this.liveEstimateInUnit(fpo.id, group.cropId, group.unit);
    return toAggregationGroupDTO(group, live);
  }

  async listAggregationGroups(
    user: AuthenticatedUserContext,
    fpoPublicId: string,
    filters: { cropId?: string; status?: "DRAFT" | "OPEN" | "READY" | "CLOSED" | "CANCELLED" },
  ): Promise<AggregationGroupDTO[]> {
    const fpo = await this.resolveFpoOrThrow(fpoPublicId);
    await this.assertCanViewAggregate(user, fpo.id);
    const groups = await this.aggregationGroups.listByFpoId(fpo.id, filters);
    const results: AggregationGroupDTO[] = [];
    for (const group of groups) {
      const live = await this.liveEstimateInUnit(fpo.id, group.cropId, group.unit);
      results.push(toAggregationGroupDTO(group, live));
    }
    return results;
  }

  /** Build spec section 38: targetQuantity/targetDate/status only — never
   * fpoId/cropId, and never CANCELLED here (see aggregation.schemas.ts). */
  async updateAggregationGroup(
    user: AuthenticatedUserContext,
    fpoPublicId: string,
    aggregationPublicId: string,
    input: UpdateAggregationGroupInput,
    meta: RequestMeta,
  ): Promise<AggregationGroupDTO> {
    const fpo = await this.resolveFpoOrThrow(fpoPublicId);
    await this.authorization.assertCanManageFpo(user, fpo.id);
    const existing = await this.loadGroupOrThrow(fpo.id, aggregationPublicId);

    if (existing.status === "CANCELLED" || existing.status === "CLOSED") {
      throw new ConflictError("This aggregation target is no longer editable.");
    }

    const updated = await this.aggregationGroups.update(existing.id, {
      targetQuantity: input.targetQuantity,
      targetDate: input.targetDate,
      status: input.status,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "AGGREGATION_UPDATED",
      entityType: "AggregationGroup",
      entityId: updated.id,
      metadata: { fpoId: fpo.id },
      ...meta,
    });

    const live = await this.liveEstimateInUnit(fpo.id, updated.cropId, updated.unit);
    return toAggregationGroupDTO(updated, live);
  }

  /** Build spec section 39: OPEN/DRAFT/READY -> CANCELLED, never deleted. */
  async cancelAggregationGroup(
    user: AuthenticatedUserContext,
    fpoPublicId: string,
    aggregationPublicId: string,
    meta: RequestMeta,
  ): Promise<AggregationGroupDTO> {
    const fpo = await this.resolveFpoOrThrow(fpoPublicId);
    await this.authorization.assertCanManageFpo(user, fpo.id);
    const existing = await this.loadGroupOrThrow(fpo.id, aggregationPublicId);

    const updated = await this.aggregationGroups.transition(
      existing.id,
      ["DRAFT", "OPEN", "READY"],
      "CANCELLED",
    );
    if (!updated) {
      throw new ConflictError("This aggregation target has already been closed or cancelled.");
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "AGGREGATION_CANCELLED",
      entityType: "AggregationGroup",
      entityId: updated.id,
      metadata: { fpoId: fpo.id },
      ...meta,
    });

    const live = await this.liveEstimateInUnit(fpo.id, updated.cropId, updated.unit);
    return toAggregationGroupDTO(updated, live);
  }

  /** Build spec section 41: FPO_ADMIN (own) / ADMIN only — pendingMemberships
   * is private roster information, so (unlike crop-aggregation) this is not
   * opened to GOVERNMENT_VIEWER. */
  async getAnalyticsOverview(user: AuthenticatedUserContext, fpoPublicId: string): Promise<FpoAnalyticsDTO> {
    const fpo = await this.resolveFpoOrThrow(fpoPublicId);
    await this.authorization.assertCanManageFpo(user, fpo.id);

    const [activeMemberCount, suspendedMemberCount, pendingMemberships, cropRows, activeAggregationGroups] =
      await Promise.all([
        this.memberships.countActiveByFpoId(fpo.id),
        this.memberships.countByFpoIdAndStatus(fpo.id, "SUSPENDED"),
        this.memberships.countByFpoIdAndStatus(fpo.id, "PENDING"),
        this.computeCropAggregation(fpo.id),
        this.aggregationGroups.countActiveByFpoId(fpo.id),
      ]);

    const estimatedTotalSupply = round2(
      cropRows.reduce((sum, row) => sum + (row.estimatedQuantity ?? 0), 0),
    );
    const topCrops = [...cropRows]
      .filter((row) => row.estimatedQuantity !== null)
      .sort((a, b) => (b.estimatedQuantity ?? 0) - (a.estimatedQuantity ?? 0))
      .slice(0, 5)
      .map((row) => ({ crop: row.cropName, estimatedQuantity: row.estimatedQuantity as number }));

    return {
      // "Members" in the broad sense (still formally part of the FPO,
      // including those currently suspended) vs. strictly ACTIVE — mirrors
      // the distinct memberCount/activeMemberCount figures in build spec
      // section 41's example response.
      memberCount: activeMemberCount + suspendedMemberCount,
      activeMemberCount,
      pendingMemberships,
      cropCount: cropRows.length,
      estimatedTotalSupply: { value: estimatedTotalSupply, unit: "QTL" },
      topCrops,
      activeAggregationGroups,
      calculatedAt: new Date().toISOString(),
    };
  }
}
