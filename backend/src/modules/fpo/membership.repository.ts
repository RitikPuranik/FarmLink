import { Crop, District, Farm, FarmerCrop, FarmerProfile, FpoMembership, MembershipStatus, PrismaClient, User } from "@prisma/client";

export type MemberDirectoryRow = FpoMembership & {
  farmer: FarmerProfile & {
    user: Pick<User, "id" | "publicId" | "fullName">;
    farms: (Farm & { district: District })[];
    farmerCrops: (FarmerCrop & { crop: Crop })[];
  };
};

const MEMBER_DIRECTORY_INCLUDE = {
  farmer: {
    include: {
      user: { select: { id: true, publicId: true, fullName: true } },
      farms: { include: { district: true } },
      farmerCrops: { include: { crop: true } },
    },
  },
} as const;

export interface CreateMembershipData {
  fpoId: string;
  farmerId: string;
}

export interface MembershipListFilters {
  status?: MembershipStatus;
  cropId?: string;
  district?: string;
  search?: string;
  page: number;
  limit: number;
}

export interface MembershipListResult {
  items: MemberDirectoryRow[];
  total: number;
}

type TransitionFields = Partial<
  Pick<FpoMembership, "status" | "approvedAt" | "joinedAt" | "rejectedAt" | "removedAt" | "rejectionReason">
>;

/**
 * Data-access boundary for individual farmer <-> FPO membership rows.
 * Business rules (one active membership per farmer, valid state
 * transitions, who may approve/reject/remove) all live in
 * membership.service.ts — this repository only reads/writes rows and
 * offers the atomic primitives the service needs to enforce those rules
 * safely (see `transition` below).
 */
export interface FpoMembershipRepository {
  findById(id: string): Promise<FpoMembership | null>;
  findByPublicId(publicId: string): Promise<FpoMembership | null>;
  findActiveByFarmerId(farmerId: string): Promise<FpoMembership | null>;
  findPendingByFarmerAndFpo(farmerId: string, fpoId: string): Promise<FpoMembership | null>;
  /** Used by GET /api/farmers/me/fpo — ACTIVE takes priority; otherwise the
   * most recent still-open (PENDING/SUSPENDED) request, so a farmer who
   * just applied sees "pending" rather than an empty state. */
  findMostRelevantByFarmerId(farmerId: string): Promise<FpoMembership | null>;
  create(data: CreateMembershipData): Promise<FpoMembership>;
  /**
   * Conditional/atomic state transition (build spec section 49/93:
   * transactional approval, idempotent-safe repeats). Only applies `data`
   * if the row's current status is one of `fromStatuses`; returns null
   * (never throws) otherwise, so the service layer can turn that into a
   * clear conflict rather than silently double-applying a transition or
   * racing another request.
   */
  transition(id: string, fromStatuses: MembershipStatus[], data: TransitionFields): Promise<FpoMembership | null>;
  countActiveByFpoId(fpoId: string): Promise<number>;
  /** Batched member-count lookup for FPO search results — one query for a
   * whole page instead of one count() per row (build spec section 25/59). */
  countActiveGroupedByFpoIds(fpoIds: string[]): Promise<Record<string, number>>;
  countByFpoIdAndStatus(fpoId: string, status: MembershipStatus): Promise<number>;
  /** The set of active members' FarmerProfile ids — this is what feeds the
   * crop-aggregation engine's farmerCrop lookup. */
  listActiveFarmerProfileIdsForFpo(fpoId: string): Promise<string[]>;
  /** Union of ACTIVE members' FarmerProfile ids across *every* FPO — feeds
   * the read-only government national crop-wise supply summary (build spec
   * section 42). */
  listAllActiveFarmerProfileIds(): Promise<string[]>;
  listForFpo(fpoId: string, filters: MembershipListFilters): Promise<MembershipListResult>;
}

export class PrismaFpoMembershipRepository implements FpoMembershipRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string) {
    return this.prisma.fpoMembership.findUnique({ where: { id } });
  }

  findByPublicId(publicId: string) {
    return this.prisma.fpoMembership.findUnique({ where: { publicId } });
  }

  findActiveByFarmerId(farmerId: string) {
    return this.prisma.fpoMembership.findFirst({ where: { farmerId, status: "ACTIVE" } });
  }

  findPendingByFarmerAndFpo(farmerId: string, fpoId: string) {
    return this.prisma.fpoMembership.findFirst({ where: { farmerId, fpoId, status: "PENDING" } });
  }

  async findMostRelevantByFarmerId(farmerId: string) {
    const active = await this.findActiveByFarmerId(farmerId);
    if (active) return active;
    return this.prisma.fpoMembership.findFirst({
      where: { farmerId, status: { in: ["PENDING", "SUSPENDED"] } },
      orderBy: { requestedAt: "desc" },
    });
  }

  create(data: CreateMembershipData) {
    return this.prisma.fpoMembership.create({
      data: { fpoId: data.fpoId, farmerId: data.farmerId, status: "PENDING" },
    });
  }

  transition(id: string, fromStatuses: MembershipStatus[], data: TransitionFields) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.fpoMembership.updateMany({
        where: { id, status: { in: fromStatuses } },
        data,
      });
      if (result.count === 0) return null;
      return tx.fpoMembership.findUnique({ where: { id } });
    });
  }

  countActiveByFpoId(fpoId: string) {
    return this.prisma.fpoMembership.count({ where: { fpoId, status: "ACTIVE" } });
  }

  async countActiveGroupedByFpoIds(fpoIds: string[]) {
    const result: Record<string, number> = Object.fromEntries(fpoIds.map((id) => [id, 0]));
    if (fpoIds.length === 0) return result;
    const grouped = await this.prisma.fpoMembership.groupBy({
      by: ["fpoId"],
      where: { fpoId: { in: fpoIds }, status: "ACTIVE" },
      _count: { _all: true },
    });
    for (const row of grouped) result[row.fpoId] = row._count._all;
    return result;
  }

  countByFpoIdAndStatus(fpoId: string, status: MembershipStatus) {
    return this.prisma.fpoMembership.count({ where: { fpoId, status } });
  }

  async listActiveFarmerProfileIdsForFpo(fpoId: string) {
    const rows = await this.prisma.fpoMembership.findMany({
      where: { fpoId, status: "ACTIVE" },
      select: { farmerId: true },
    });
    return rows.map((r) => r.farmerId);
  }

  async listAllActiveFarmerProfileIds() {
    const rows = await this.prisma.fpoMembership.findMany({
      where: { status: "ACTIVE" },
      select: { farmerId: true },
    });
    return rows.map((r) => r.farmerId);
  }

  async listForFpo(fpoId: string, filters: MembershipListFilters) {
    // Every farmer-relation condition (crop/district/search) has to land in
    // one combined `farmer: {...}` clause — spreading multiple separate
    // `{ farmer: {...} }` objects into the same `where` would silently drop
    // all but the last one.
    const farmerConditions: Record<string, unknown> = {};
    if (filters.cropId) {
      farmerConditions.farmerCrops = { some: { cropId: filters.cropId } };
    }
    if (filters.district) {
      farmerConditions.farms = {
        some: { district: { name: { contains: filters.district, mode: "insensitive" as const } } },
      };
    }
    if (filters.search) {
      farmerConditions.user = { fullName: { contains: filters.search, mode: "insensitive" as const } };
    }

    const where = {
      fpoId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(Object.keys(farmerConditions).length > 0 ? { farmer: farmerConditions } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.fpoMembership.findMany({
        where,
        include: MEMBER_DIRECTORY_INCLUDE,
        orderBy: { requestedAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.fpoMembership.count({ where }),
    ]);

    return { items: items as MemberDirectoryRow[], total };
  }
}
