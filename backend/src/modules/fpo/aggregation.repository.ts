import { AggregationGroup, AggregationGroupStatus, Crop, PrismaClient, QuantityUnit } from "@prisma/client";

export type AggregationGroupWithCrop = AggregationGroup & { crop: Crop };

const CROP_INCLUDE = { crop: true } as const;

export interface CreateAggregationGroupData {
  fpoId: string;
  cropId: string;
  targetQuantity?: number | null;
  estimatedQuantity?: number | null;
  unit: QuantityUnit;
  targetDate?: Date | null;
}

export interface UpdateAggregationGroupData {
  targetQuantity?: number | null;
  targetDate?: Date | null;
  status?: AggregationGroupStatus;
  estimatedQuantity?: number | null;
}

export interface AggregationGroupListFilters {
  cropId?: string;
  status?: AggregationGroupStatus;
}

/**
 * Data-access boundary for AggregationGroup — a planning target only (build
 * spec section 34/75: never a sale/order/contract/lot/shipment). The live
 * "how much do we actually have right now" figure always comes from
 * FpoAggregationService's crop-aggregation computation, not from this
 * table's estimatedQuantity column (which is just the snapshot taken at
 * create/update time — see that field's comment in schema.prisma).
 */
export interface AggregationGroupRepository {
  findById(id: string): Promise<AggregationGroupWithCrop | null>;
  findByPublicId(publicId: string): Promise<AggregationGroupWithCrop | null>;
  listByFpoId(fpoId: string, filters: AggregationGroupListFilters): Promise<AggregationGroupWithCrop[]>;
  create(data: CreateAggregationGroupData): Promise<AggregationGroupWithCrop>;
  update(id: string, data: UpdateAggregationGroupData): Promise<AggregationGroupWithCrop>;
  /** Same conditional-transition primitive as FpoMembershipRepository —
   * used by cancel() so a group can't be cancelled twice or resurrected
   * from an already-terminal state. */
  transition(id: string, fromStatuses: AggregationGroupStatus[], toStatus: AggregationGroupStatus): Promise<AggregationGroupWithCrop | null>;
  countActiveByFpoId(fpoId: string): Promise<number>;
}

export class PrismaAggregationGroupRepository implements AggregationGroupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string) {
    return this.prisma.aggregationGroup.findUnique({ where: { id }, include: CROP_INCLUDE });
  }

  findByPublicId(publicId: string) {
    return this.prisma.aggregationGroup.findUnique({ where: { publicId }, include: CROP_INCLUDE });
  }

  listByFpoId(fpoId: string, filters: AggregationGroupListFilters) {
    return this.prisma.aggregationGroup.findMany({
      where: {
        fpoId,
        ...(filters.cropId ? { cropId: filters.cropId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: CROP_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  create(data: CreateAggregationGroupData) {
    return this.prisma.aggregationGroup.create({
      data: {
        fpoId: data.fpoId,
        cropId: data.cropId,
        targetQuantity: data.targetQuantity ?? null,
        estimatedQuantity: data.estimatedQuantity ?? null,
        unit: data.unit,
        targetDate: data.targetDate ?? null,
        status: "OPEN",
      },
      include: CROP_INCLUDE,
    });
  }

  update(id: string, data: UpdateAggregationGroupData) {
    return this.prisma.aggregationGroup.update({
      where: { id },
      data: {
        ...(data.targetQuantity !== undefined ? { targetQuantity: data.targetQuantity } : {}),
        ...(data.targetDate !== undefined ? { targetDate: data.targetDate } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.estimatedQuantity !== undefined ? { estimatedQuantity: data.estimatedQuantity } : {}),
      },
      include: CROP_INCLUDE,
    });
  }

  transition(id: string, fromStatuses: AggregationGroupStatus[], toStatus: AggregationGroupStatus) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.aggregationGroup.updateMany({
        where: { id, status: { in: fromStatuses } },
        data: { status: toStatus },
      });
      if (result.count === 0) return null;
      return tx.aggregationGroup.findUnique({ where: { id }, include: CROP_INCLUDE });
    });
  }

  countActiveByFpoId(fpoId: string) {
    return this.prisma.aggregationGroup.count({ where: { fpoId, status: { in: ["OPEN", "READY"] } } });
  }
}
