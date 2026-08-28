import { CommunicationPreference, FarmerProfile, FpoMembershipStatus, LiquidityPreference } from "@prisma/client";
import { FpoDTO } from "../reference-data/reference-data.service";
import { FarmDTO } from "../farms/farms.types";
import { FarmerCropDTO } from "../crops/crops.types";
import { CompletionResult } from "./completion";

export interface FarmerProfileDTO {
  userId: string;
  fpoMembershipStatus: FpoMembershipStatus | null;
  fpo: FpoDTO | null;
  liquidityPreference: LiquidityPreference | null;
  willingToStore: boolean | null;
  communicationPreference: CommunicationPreference;
  createdAt: string;
  updatedAt: string;
}

export function toFarmerProfileDTO(profile: FarmerProfile, fpo: FpoDTO | null): FarmerProfileDTO {
  return {
    userId: profile.userId,
    fpoMembershipStatus: profile.fpoMembershipStatus,
    fpo,
    liquidityPreference: profile.liquidityPreference,
    willingToStore: profile.willingToStore,
    communicationPreference: profile.communicationPreference,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

// Mirrors the response shape sketched in build spec section 57.
export interface FarmerProfileAggregateDTO {
  profile: FarmerProfileDTO;
  farms: FarmDTO[];
  crops: FarmerCropDTO[];
  completion: CompletionResult;
}
