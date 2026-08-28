import { FarmerProfile } from "@prisma/client";
import { FarmerProfileRepository } from "./farmer-profile.repository";

/**
 * A FarmerProfile is infrastructure every self-service farmer endpoint
 * needs (farms/crops both hang off farmerProfileId), not optional business
 * data the farmer must remember to set up first. Rather than forcing a
 * strict "call POST /api/farmers/me/profile before you can add a farm"
 * ordering — which the build spec's own E2E flow (section 70) doesn't
 * assume either, since location/farm/crop steps happen inside the same
 * onboarding sequence — every module that needs the caller's profile id
 * resolves it through here, creating a bare row on first use if needed.
 *
 * This does NOT change what `POST /api/farmers/me/profile` means: that
 * endpoint still 409s if a profile already exists (build spec section 58),
 * because "already exists" is exactly what this resolver would have
 * silently produced for them already.
 */
export class FarmerProfileResolver {
  constructor(private readonly repo: FarmerProfileRepository) {}

  async ensure(userId: string): Promise<FarmerProfile> {
    const existing = await this.repo.findByUserId(userId);
    if (existing) return existing;
    return this.repo.create({ userId });
  }
}
