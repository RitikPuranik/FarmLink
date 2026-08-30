import { CommunicationPreference, FarmerProfile, FpoMembershipStatus, LiquidityPreference, PrismaClient, User } from "@prisma/client";

export type FarmerProfileWithUser = FarmerProfile & { user: Pick<User, "id" | "publicId" | "fullName"> };

export interface CreateFarmerProfileData {
  userId: string;
  fpoMembershipStatus?: FpoMembershipStatus | null;
  fpoId?: string | null;
  liquidityPreference?: LiquidityPreference | null;
  willingToStore?: boolean | null;
  communicationPreference?: CommunicationPreference;
}

export interface UpdateFarmerProfileData {
  fpoMembershipStatus?: FpoMembershipStatus | null;
  fpoId?: string | null;
  liquidityPreference?: LiquidityPreference | null;
  willingToStore?: boolean | null;
  communicationPreference?: CommunicationPreference;
}

/**
 * Data-access boundary for the FarmerProfile singleton (build spec section
 * 64/65 — repositories only talk to the database, business rules live in
 * the service). Mirrors the AuthRepository pattern from Module 1 so tests
 * can inject an in-memory fake instead of a live database.
 */
export interface FarmerProfileRepository {
  findByUserId(userId: string): Promise<FarmerProfile | null>;
  findById(id: string): Promise<FarmerProfile | null>;
  /**
   * Batch lookup with the owning User's public-safe display fields —
   * added for Module 3's aggregation-by-farmer breakdown (build spec
   * section 33) and member directory, so resolving N farmerProfileIds
   * back to a display name costs one query instead of N. Purely additive.
   */
  findManyByIdsWithUser(ids: string[]): Promise<FarmerProfileWithUser[]>;
  create(data: CreateFarmerProfileData): Promise<FarmerProfile>;
  update(id: string, data: UpdateFarmerProfileData): Promise<FarmerProfile>;
}

export class PrismaFarmerProfileRepository implements FarmerProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByUserId(userId: string) {
    return this.prisma.farmerProfile.findUnique({ where: { userId } });
  }

  findById(id: string) {
    return this.prisma.farmerProfile.findUnique({ where: { id } });
  }

  findManyByIdsWithUser(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.farmerProfile.findMany({
      where: { id: { in: ids } },
      include: { user: { select: { id: true, publicId: true, fullName: true } } },
    });
  }

  create(data: CreateFarmerProfileData) {
    return this.prisma.farmerProfile.create({
      data: {
        userId: data.userId,
        fpoMembershipStatus: data.fpoMembershipStatus ?? null,
        fpoId: data.fpoId ?? null,
        liquidityPreference: data.liquidityPreference ?? null,
        willingToStore: data.willingToStore ?? null,
        communicationPreference: data.communicationPreference ?? "IN_APP",
      },
    });
  }

  update(id: string, data: UpdateFarmerProfileData) {
    return this.prisma.farmerProfile.update({
      where: { id },
      data: {
        ...(data.fpoMembershipStatus !== undefined ? { fpoMembershipStatus: data.fpoMembershipStatus } : {}),
        ...(data.fpoId !== undefined ? { fpoId: data.fpoId } : {}),
        ...(data.liquidityPreference !== undefined ? { liquidityPreference: data.liquidityPreference } : {}),
        ...(data.willingToStore !== undefined ? { willingToStore: data.willingToStore } : {}),
        ...(data.communicationPreference !== undefined
          ? { communicationPreference: data.communicationPreference }
          : {}),
      },
    });
  }
}
