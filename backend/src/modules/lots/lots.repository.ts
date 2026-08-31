import { CropLotStatus, LotOwnerType, LotSourceType, PrismaClient, QuantityUnit } from "@prisma/client";
import { CropLotWithRelations, FarmerLotSummaryDTO, LotStatusHistoryEntryDTO } from "./lots.types";
import { nextLotNumberCandidate } from "./lot-number";

const LOT_INCLUDE = { crop: true, farm: true, fpo: true } as const;

export interface CreateCropLotData {
  ownerType: LotOwnerType;
  sourceType: LotSourceType;
  farmerId?: string | null;
  fpoId?: string | null;
  cropId: string;
  farmId?: string | null;
  variety?: string | null;
  unit: QuantityUnit;
  quantityKg: number;
  harvestDate?: Date | null;
  availabilityDate: Date;
  originVillage?: string | null;
  originTaluka?: string | null;
  originDistrict: string;
  originState: string;
}

export interface UpdateCropLotData {
  cropId?: string;
  farmId?: string | null;
  variety?: string | null;
  unit?: QuantityUnit;
  quantityKg?: number;
  // A quantity update on a still-DRAFT lot resets availableQuantityKg to
  // match (build spec section 24/29 — quantity protection only kicks in
  // once the lot leaves DRAFT), so this is written alongside quantityKg,
  // never independently, by lots.service.ts.
  availableQuantityKg?: number;
  harvestDate?: Date | null;
  availabilityDate?: Date;
  originVillage?: string | null;
  originTaluka?: string | null;
  originDistrict?: string;
  originState?: string;
}

export interface CropLotListFilters {
  status?: CropLotStatus;
  cropId?: string;
  farmId?: string;
}

export interface CropLotListResult {
  items: CropLotWithRelations[];
  total: number;
}

export interface TransitionMeta {
  actorUserId: string | null;
  /** The status the caller already confirmed the lot was in when it
   * decided to attempt this transition — used only to label the history
   * row; the atomic correctness guarantee comes from `fromStatuses` below
   * being enforced inside the same conditional UPDATE (see the Prisma
   * implementation's comment). */
  fromStatus: CropLotStatus;
  reason?: string;
}

/**
 * Data-access boundary for CropLot + its status history (build spec
 * section 93/96). Ownership (does this farmer/FPO admin own this lot?)
 * and state-machine legality are never decided here — see
 * lot.authorization.ts and lot-status.service.ts — this repository only
 * reads/writes rows and provides the atomic primitives (transition(),
 * adjustAvailableQuantity()) those higher layers rely on for correctness
 * under concurrency.
 */
export interface CropLotRepository {
  findById(id: string): Promise<CropLotWithRelations | null>;
  findByPublicId(publicId: string): Promise<CropLotWithRelations | null>;
  listByFarmerId(
    farmerId: string,
    filters: CropLotListFilters,
    page: number,
    limit: number,
  ): Promise<CropLotListResult>;
  listByFpoId(fpoId: string, filters: CropLotListFilters, page: number, limit: number): Promise<CropLotListResult>;
  create(data: CreateCropLotData, actorUserId: string | null): Promise<CropLotWithRelations>;
  updateDraft(id: string, data: UpdateCropLotData): Promise<CropLotWithRelations>;
  deleteDraft(id: string): Promise<void>;
  /** Atomic conditional transition (build spec section 27/31): the status
   * change and the "was it actually still in an eligible status" check
   * happen in one guarded UPDATE, exactly like
   * AggregationGroupRepository.transition() — never a separate read then
   * write, which would race under concurrent requests. Returns null if the
   * lot was no longer in any of `fromStatuses` (already transitioned by
   * someone else, or never was) so the caller can turn that into a
   * friendly ConflictError instead of silently double-applying it. */
  transition(id: string, fromStatuses: CropLotStatus[], toStatus: CropLotStatus, meta: TransitionMeta): Promise<CropLotWithRelations | null>;
  getHistory(id: string): Promise<LotStatusHistoryEntryDTO[]>;
  summarizeForFarmer(farmerId: string): Promise<FarmerLotSummaryDTO>;
  /** Build spec section 29-31 foundation: LotQuantityService's
   * reserve/release/consume all funnel through this one guarded UPDATE so
   * availableQuantityKg can never go negative (`gte: quantityKg` in the
   * WHERE clause of the decrement case — see the Prisma implementation).
   * Not reachable from any route yet; only future modules will call it. */
  adjustAvailableQuantity(id: string, deltaKg: number): Promise<CropLotWithRelations | null>;
}

function isUniqueLotNumberConflict(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

export class PrismaCropLotRepository implements CropLotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string) {
    return this.prisma.cropLot.findUnique({ where: { id }, include: LOT_INCLUDE });
  }

  findByPublicId(publicId: string) {
    return this.prisma.cropLot.findUnique({ where: { publicId }, include: LOT_INCLUDE });
  }

  private buildWhere(scope: { farmerId?: string; fpoId?: string }, filters: CropLotListFilters) {
    return {
      ...scope,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.cropId ? { cropId: filters.cropId } : {}),
      ...(filters.farmId ? { farmId: filters.farmId } : {}),
    };
  }

  async listByFarmerId(farmerId: string, filters: CropLotListFilters, page: number, limit: number) {
    const where = this.buildWhere({ farmerId }, filters);
    const [items, total] = await Promise.all([
      this.prisma.cropLot.findMany({
        where,
        include: LOT_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cropLot.count({ where }),
    ]);
    return { items, total };
  }

  async listByFpoId(fpoId: string, filters: CropLotListFilters, page: number, limit: number) {
    const where = this.buildWhere({ fpoId }, filters);
    const [items, total] = await Promise.all([
      this.prisma.cropLot.findMany({
        where,
        include: LOT_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cropLot.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Lot-number generation (build spec section 10) lives here, not in the
   * service, because uniqueness is a database-level concern: the sequence
   * is "how many lots already exist this year" and a collision can only
   * really happen if two requests compute the same count in the same
   * instant, which the retry loop below (bumping the candidate by
   * `attempt`, catching the resulting unique-constraint error) resolves
   * without a separate locking table.
   */
  async create(data: CreateCropLotData, actorUserId: string | null): Promise<CropLotWithRelations> {
    const year = new Date().getFullYear();
    const yearPrefix = `LOT-${year}-`;
    const baseSequence = (await this.prisma.cropLot.count({ where: { lotNumber: { startsWith: yearPrefix } } })) + 1;

    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const lotNumber = nextLotNumberCandidate(year, baseSequence, attempt);
      try {
        return await this.prisma.$transaction(async (tx) => {
          const created = await tx.cropLot.create({
            data: {
              lotNumber,
              ownerType: data.ownerType,
              sourceType: data.sourceType,
              farmerId: data.farmerId ?? null,
              fpoId: data.fpoId ?? null,
              cropId: data.cropId,
              farmId: data.farmId ?? null,
              variety: data.variety ?? null,
              unit: data.unit,
              quantityKg: data.quantityKg,
              availableQuantityKg: data.quantityKg,
              harvestDate: data.harvestDate ?? null,
              availabilityDate: data.availabilityDate,
              originVillage: data.originVillage ?? null,
              originTaluka: data.originTaluka ?? null,
              originDistrict: data.originDistrict,
              originState: data.originState,
              status: "DRAFT",
            },
            include: LOT_INCLUDE,
          });
          await tx.lotStatusHistory.create({
            data: { lotId: created.id, fromStatus: null, toStatus: "DRAFT", changedBy: actorUserId },
          });
          return created;
        });
      } catch (err) {
        if (isUniqueLotNumberConflict(err) && attempt < maxAttempts - 1) continue;
        throw err;
      }
    }
    // Unreachable — the loop above always either returns or rethrows.
    throw new Error("Failed to generate a unique lot number.");
  }

  updateDraft(id: string, data: UpdateCropLotData) {
    return this.prisma.cropLot.update({
      where: { id },
      data: {
        ...(data.cropId !== undefined ? { cropId: data.cropId } : {}),
        ...(data.farmId !== undefined ? { farmId: data.farmId } : {}),
        ...(data.variety !== undefined ? { variety: data.variety } : {}),
        ...(data.unit !== undefined ? { unit: data.unit } : {}),
        ...(data.quantityKg !== undefined ? { quantityKg: data.quantityKg } : {}),
        ...(data.availableQuantityKg !== undefined ? { availableQuantityKg: data.availableQuantityKg } : {}),
        ...(data.harvestDate !== undefined ? { harvestDate: data.harvestDate } : {}),
        ...(data.availabilityDate !== undefined ? { availabilityDate: data.availabilityDate } : {}),
        ...(data.originVillage !== undefined ? { originVillage: data.originVillage } : {}),
        ...(data.originTaluka !== undefined ? { originTaluka: data.originTaluka } : {}),
        ...(data.originDistrict !== undefined ? { originDistrict: data.originDistrict } : {}),
        ...(data.originState !== undefined ? { originState: data.originState } : {}),
      },
      include: LOT_INCLUDE,
    });
  }

  async deleteDraft(id: string) {
    // History rows cascade (schema.prisma: LotStatusHistory.lot onDelete:
    // Cascade) — fine here because build spec section 25 only allows
    // hard-deleting a lot that never left DRAFT, so there is no
    // meaningful history to preserve yet (just the single DRAFT row).
    await this.prisma.cropLot.delete({ where: { id } });
  }

  async transition(
    id: string,
    fromStatuses: CropLotStatus[],
    toStatus: CropLotStatus,
    meta: TransitionMeta,
  ): Promise<CropLotWithRelations | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.cropLot.updateMany({
        where: { id, status: { in: fromStatuses } },
        data: { status: toStatus },
      });
      if (result.count === 0) return null;

      await tx.lotStatusHistory.create({
        data: { lotId: id, fromStatus: meta.fromStatus, toStatus, changedBy: meta.actorUserId, reason: meta.reason },
      });

      return tx.cropLot.findUnique({ where: { id }, include: LOT_INCLUDE });
    });
  }

  async getHistory(id: string): Promise<LotStatusHistoryEntryDTO[]> {
    const rows = await this.prisma.lotStatusHistory.findMany({
      where: { lotId: id },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      changedBy: row.changedBy,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async summarizeForFarmer(farmerId: string): Promise<FarmerLotSummaryDTO> {
    const [totalLots, draftLots, availableLots, cancelledLots, availableAgg] = await Promise.all([
      this.prisma.cropLot.count({ where: { farmerId } }),
      this.prisma.cropLot.count({ where: { farmerId, status: "DRAFT" } }),
      this.prisma.cropLot.count({ where: { farmerId, status: "AVAILABLE" } }),
      this.prisma.cropLot.count({ where: { farmerId, status: "CANCELLED" } }),
      this.prisma.cropLot.aggregate({
        where: { farmerId, status: "AVAILABLE" },
        _sum: { availableQuantityKg: true },
      }),
    ]);
    return {
      totalLots,
      draftLots,
      availableLots,
      cancelledLots,
      totalAvailableQuantityKg: Math.round(Number(availableAgg._sum.availableQuantityKg ?? 0) * 100) / 100,
    };
  }

  async adjustAvailableQuantity(id: string, deltaKg: number): Promise<CropLotWithRelations | null> {
    if (deltaKg === 0) return this.findById(id);

    return this.prisma.$transaction(async (tx) => {
      if (deltaKg > 0) {
        // release()/back out of a reservation — no lower-bound risk, but
        // still guarded to an existing row.
        const result = await tx.cropLot.updateMany({
          where: { id },
          data: { availableQuantityKg: { increment: deltaKg } },
        });
        if (result.count === 0) return null;
      } else {
        // reserve()/consume() — the WHERE clause is the atomic
        // never-go-negative guard (build spec section 31): the decrement
        // only applies if enough quantity is still available at the
        // moment of the UPDATE, not at the moment this function was
        // called.
        const result = await tx.cropLot.updateMany({
          where: { id, availableQuantityKg: { gte: Math.abs(deltaKg) } },
          data: { availableQuantityKg: { decrement: Math.abs(deltaKg) } },
        });
        if (result.count === 0) return null;
      }
      return tx.cropLot.findUnique({ where: { id }, include: LOT_INCLUDE });
    });
  }
}
