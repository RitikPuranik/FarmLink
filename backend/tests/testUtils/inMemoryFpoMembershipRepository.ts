import { randomUUID } from "crypto";
import type {
  CreateMembershipData,
  FpoMembershipRepository,
  MembershipListFilters,
} from "../../src/modules/fpo/membership.repository";
import { InMemoryFarmerProfileRepository } from "./inMemoryFarmerProfileRepository";
import { InMemoryAuthRepository } from "./inMemoryAuthRepository";
import { InMemoryFarmsRepository } from "./inMemoryFarmsRepository";
import { InMemoryFarmerCropRepository } from "./inMemoryFarmerCropRepository";
import { InMemoryReferenceDataRepository } from "./inMemoryReferenceDataRepository";

export interface FakeFpoMembership {
  id: string;
  publicId: string;
  fpoId: string;
  farmerId: string;
  status: string;
  requestedAt: Date;
  joinedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  removedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Mirrors InMemoryFarmerCropRepository's pattern — joins across the other
 * in-memory fakes (farmer profile -> user/farms/crops) to replicate the
 * Prisma `include` used by the real member-directory query. */
export class InMemoryFpoMembershipRepository implements FpoMembershipRepository {
  memberships: FakeFpoMembership[] = [];

  constructor(
    private readonly referenceData: InMemoryReferenceDataRepository,
    private readonly farmerProfiles: InMemoryFarmerProfileRepository,
    private readonly users: InMemoryAuthRepository,
    private readonly farms: InMemoryFarmsRepository,
    private readonly farmerCrops: InMemoryFarmerCropRepository,
  ) {}

  private withFarmer(m: FakeFpoMembership) {
    const profile = this.farmerProfiles.profiles.find((p) => p.id === m.farmerId);
    const user = profile ? this.users.users.find((u) => u.id === profile.userId) : undefined;
    const farms = this.farms.farms.filter((f) => f.farmerProfileId === m.farmerId);
    const farmerCrops = this.farmerCrops.rows
      .filter((r) => r.farmerProfileId === m.farmerId)
      .map((r) => ({ ...r, crop: this.referenceData.crops.find((c) => c.id === r.cropId) }));

    return {
      ...m,
      farmer: profile
        ? {
            ...profile,
            user: user ? { id: user.id, publicId: user.publicId, fullName: user.fullName } : undefined,
            farms,
            farmerCrops,
          }
        : undefined,
    } as never;
  }

  async findById(id: string) {
    return (this.memberships.find((m) => m.id === id) as never) ?? null;
  }

  async findByPublicId(publicId: string) {
    return (this.memberships.find((m) => m.publicId === publicId) as never) ?? null;
  }

  async findActiveByFarmerId(farmerId: string) {
    return (this.memberships.find((m) => m.farmerId === farmerId && m.status === "ACTIVE") as never) ?? null;
  }

  async findPendingByFarmerAndFpo(farmerId: string, fpoId: string) {
    return (
      (this.memberships.find((m) => m.farmerId === farmerId && m.fpoId === fpoId && m.status === "PENDING") as never) ??
      null
    );
  }

  async findMostRelevantByFarmerId(farmerId: string) {
    const active = await this.findActiveByFarmerId(farmerId);
    if (active) return active;
    const open = this.memberships
      .filter((m) => m.farmerId === farmerId && (m.status === "PENDING" || m.status === "SUSPENDED"))
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
    return (open[0] as never) ?? null;
  }

  async create(data: CreateMembershipData) {
    const now = new Date();
    const membership: FakeFpoMembership = {
      id: randomUUID(),
      publicId: randomUUID(),
      fpoId: data.fpoId,
      farmerId: data.farmerId,
      status: "PENDING",
      requestedAt: now,
      joinedAt: null,
      approvedAt: null,
      rejectedAt: null,
      removedAt: null,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.memberships.push(membership);
    return membership as never;
  }

  async transition(id: string, fromStatuses: string[], data: Record<string, unknown>) {
    const membership = this.memberships.find((m) => m.id === id);
    if (!membership || !fromStatuses.includes(membership.status)) return null;
    Object.assign(membership, data, { updatedAt: new Date() });
    return membership as never;
  }

  async countActiveByFpoId(fpoId: string) {
    return this.memberships.filter((m) => m.fpoId === fpoId && m.status === "ACTIVE").length;
  }

  async countActiveGroupedByFpoIds(fpoIds: string[]) {
    const result: Record<string, number> = Object.fromEntries(fpoIds.map((id) => [id, 0]));
    for (const m of this.memberships) {
      if (m.status === "ACTIVE" && fpoIds.includes(m.fpoId)) {
        result[m.fpoId] = (result[m.fpoId] ?? 0) + 1;
      }
    }
    return result;
  }

  async countByFpoIdAndStatus(fpoId: string, status: string) {
    return this.memberships.filter((m) => m.fpoId === fpoId && m.status === status).length;
  }

  async listActiveFarmerProfileIdsForFpo(fpoId: string) {
    return this.memberships.filter((m) => m.fpoId === fpoId && m.status === "ACTIVE").map((m) => m.farmerId);
  }

  async listAllActiveFarmerProfileIds() {
    return this.memberships.filter((m) => m.status === "ACTIVE").map((m) => m.farmerId);
  }

  async listForFpo(fpoId: string, filters: MembershipListFilters) {
    let matches = this.memberships.filter((m) => m.fpoId === fpoId);
    if (filters.status) matches = matches.filter((m) => m.status === filters.status);

    if (filters.cropId) {
      matches = matches.filter((m) =>
        this.farmerCrops.rows.some((r) => r.farmerProfileId === m.farmerId && r.cropId === filters.cropId),
      );
    }
    if (filters.district) {
      const needle = filters.district.toLowerCase();
      matches = matches.filter((m) =>
        this.farms.farms.some((f) => {
          if (f.farmerProfileId !== m.farmerId) return false;
          const district = this.referenceData.districts.find((d) => d.id === f.districtId);
          return district?.name.toLowerCase().includes(needle);
        }),
      );
    }
    if (filters.search) {
      const needle = filters.search.toLowerCase();
      matches = matches.filter((m) => {
        const profile = this.farmerProfiles.profiles.find((p) => p.id === m.farmerId);
        const user = profile ? this.users.users.find((u) => u.id === profile.userId) : undefined;
        return user?.fullName.toLowerCase().includes(needle);
      });
    }

    matches.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
    const total = matches.length;
    const start = (filters.page - 1) * filters.limit;
    const page = matches.slice(start, start + filters.limit);
    return { items: page.map((m) => this.withFarmer(m)), total };
  }
}
