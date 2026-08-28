import { CommunicationPreference, FarmerProfile, FpoMembershipStatus, LiquidityPreference, PrismaClient } from "@prisma/client";

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
