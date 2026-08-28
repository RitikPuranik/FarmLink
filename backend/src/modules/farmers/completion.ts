import { FarmerProfile } from "@prisma/client";
import { FarmDTO } from "../farms/farms.types";
import { FarmerCropDTO } from "../crops/crops.types";

export interface CompletionResult {
  percentage: number;
  missing: string[];
}

const WEIGHTS = {
  basicInfo: 20,
  farmLocation: 20,
  farmInfo: 20,
  primaryCrop: 20,
  fpoMembership: 10,
  sellingPreferences: 10,
} as const;

/**
 * Server-calculated profile completion (build spec section 26: "The
 * frontend must never send profileCompletionPercentage as an authoritative
 * value"). Pure function — no I/O — so it's trivially unit-testable and
 * always reflects the current state of farms/crops/preferences rather than
 * a value that could drift out of sync with them.
 *
 * Weights: basic account info 20%, farm location 20%, farm details 20%,
 * a designated primary crop 20%, FPO membership answered 10%, selling
 * preferences (liquidity + storage willingness) answered 10%.
 */
export function calculateCompletion(input: {
  profile: Pick<FarmerProfile, "fpoMembershipStatus" | "fpoId" | "liquidityPreference" | "willingToStore">;
  farms: FarmDTO[];
  crops: FarmerCropDTO[];
}): CompletionResult {
  const { profile, farms, crops } = input;

  // Always true post-registration: Module 1 requires fullName + mobile at
  // signup and defaults preferredLanguage to "en", so there is nothing left
  // for the farmer to fill in here. Modeled explicitly (rather than just
  // hard-coding the 20 into the total) so the weighting stays legible and
  // this module doesn't have to know Module 1's field names.
  const hasBasicInfo = true;

  const hasFarmLocation = farms.length > 0;
  const hasFarmInfo = farms.some((f) => f.area > 0 && f.irrigationType !== "NOT_SPECIFIED");
  const hasPrimaryCrop = crops.some((c) => c.isPrimary);

  const hasFpoMembership =
    profile.fpoMembershipStatus !== null &&
    profile.fpoMembershipStatus !== undefined &&
    (profile.fpoMembershipStatus !== "MEMBER" || Boolean(profile.fpoId));

  const hasSellingPreferences = profile.liquidityPreference != null && profile.willingToStore != null;

  const checks: { key: string; done: boolean; weight: number }[] = [
    { key: "basicInfo", done: hasBasicInfo, weight: WEIGHTS.basicInfo },
    { key: "farmLocation", done: hasFarmLocation, weight: WEIGHTS.farmLocation },
    { key: "farmInfo", done: hasFarmInfo, weight: WEIGHTS.farmInfo },
    { key: "primaryCrop", done: hasPrimaryCrop, weight: WEIGHTS.primaryCrop },
    { key: "fpoMembership", done: hasFpoMembership, weight: WEIGHTS.fpoMembership },
    { key: "sellingPreferences", done: hasSellingPreferences, weight: WEIGHTS.sellingPreferences },
  ];

  const percentage = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  const missing = checks.filter((c) => !c.done).map((c) => c.key);

  return { percentage, missing };
}
