import { randomUUID } from "crypto";
import type {
  CreateFarmerProfileData,
  FarmerProfileRepository,
  UpdateFarmerProfileData,
} from "../../src/modules/farmers/farmer-profile.repository";

export interface FakeFarmerProfile {
  id: string;
  userId: string;
  fpoMembershipStatus: string | null;
  fpoId: string | null;
  liquidityPreference: string | null;
  willingToStore: boolean | null;
  communicationPreference: string;
  createdAt: Date;
  updatedAt: Date;
}

export class InMemoryFarmerProfileRepository implements FarmerProfileRepository {
  profiles: FakeFarmerProfile[] = [];

  /** Injected lazily by buildTestApp.ts (avoids a circular constructor
   * dependency between the farmer-profile and auth in-memory repos) — see
   * setUsersRepository below. */
  private users?: { users: { id: string; publicId: string; fullName: string }[] };

  setUsersRepository(users: { users: { id: string; publicId: string; fullName: string }[] }) {
    this.users = users;
  }

  async findByUserId(userId: string) {
    return (this.profiles.find((p) => p.userId === userId) as never) ?? null;
  }

  async findById(id: string) {
    return (this.profiles.find((p) => p.id === id) as never) ?? null;
  }

  async findManyByIdsWithUser(ids: string[]) {
    const matches = this.profiles.filter((p) => ids.includes(p.id));
    return matches.map((p) => {
      const user = this.users?.users.find((u) => u.id === p.userId);
      return { ...p, user } as never;
    });
  }

  async create(data: CreateFarmerProfileData) {
    const now = new Date();
    const profile: FakeFarmerProfile = {
      id: randomUUID(),
      userId: data.userId,
      fpoMembershipStatus: data.fpoMembershipStatus ?? null,
      fpoId: data.fpoId ?? null,
      liquidityPreference: data.liquidityPreference ?? null,
      willingToStore: data.willingToStore ?? null,
      communicationPreference: data.communicationPreference ?? "IN_APP",
      createdAt: now,
      updatedAt: now,
    };
    this.profiles.push(profile);
    return profile as never;
  }

  async update(id: string, data: UpdateFarmerProfileData) {
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) throw new Error("FarmerProfile not found in fake repository.");
    if (data.fpoMembershipStatus !== undefined) profile.fpoMembershipStatus = data.fpoMembershipStatus;
    if (data.fpoId !== undefined) profile.fpoId = data.fpoId;
    if (data.liquidityPreference !== undefined) profile.liquidityPreference = data.liquidityPreference;
    if (data.willingToStore !== undefined) profile.willingToStore = data.willingToStore;
    if (data.communicationPreference !== undefined) profile.communicationPreference = data.communicationPreference;
    profile.updatedAt = new Date();
    return profile as never;
  }
}
