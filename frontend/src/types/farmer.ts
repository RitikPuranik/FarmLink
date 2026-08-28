export type AreaUnit = "ACRE" | "HECTARE";

export type IrrigationType =
  | "RAINFED"
  | "CANAL"
  | "BOREWELL"
  | "DRIP"
  | "SPRINKLER"
  | "MIXED"
  | "OTHER"
  | "NOT_SPECIFIED";

export type FpoMembershipStatus = "NOT_A_MEMBER" | "MEMBER" | "PENDING";

export type LiquidityPreference = "URGENT" | "WITHIN_3_DAYS" | "WITHIN_1_WEEK" | "CAN_WAIT_2_WEEKS" | "FLEXIBLE";

export type CommunicationPreference = "IN_APP" | "SMS" | "WHATSAPP" | "VOICE";

export interface StateOption {
  id: string;
  name: string;
}

export interface DistrictOption {
  id: string;
  stateId: string;
  name: string;
}

export interface TalukaOption {
  id: string;
  districtId: string;
  name: string;
}

export interface CropOption {
  id: string;
  name: string;
  category: string | null;
  translations: Partial<Record<"en" | "hi" | "mr", string>>;
}

export interface FpoOption {
  id: string;
  name: string;
  districtId: string | null;
}

export interface IrrigationTypeOption {
  code: IrrigationType;
  labelKey: string;
}

export interface LanguageOption {
  code: "en" | "hi" | "mr";
  label: string;
}

export interface Farm {
  id: string;
  name: string | null;
  village: string;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  state: { id: string; name: string };
  district: { id: string; name: string };
  taluka: { id: string; name: string };
  area: number;
  areaUnit: AreaUnit;
  irrigationType: IrrigationType;
  createdAt: string;
  updatedAt: string;
}

export interface FarmerCrop {
  id: string;
  farmId: string;
  crop: CropOption;
  area: number;
  areaUnit: AreaUnit;
  isPrimary: boolean;
  typicalYield: number | null;
  yieldUnit: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FarmerProfile {
  userId: string;
  fpoMembershipStatus: FpoMembershipStatus | null;
  fpo: FpoOption | null;
  liquidityPreference: LiquidityPreference | null;
  willingToStore: boolean | null;
  communicationPreference: CommunicationPreference;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileCompletion {
  percentage: number;
  missing: string[];
}

export interface FarmerProfileAggregate {
  profile: FarmerProfile;
  farms: Farm[];
  crops: FarmerCrop[];
  completion: ProfileCompletion;
}

export interface CreateFarmInput {
  name?: string;
  village: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  stateId: string;
  districtId: string;
  talukaId: string;
  area: number;
  areaUnit: AreaUnit;
  irrigationType?: IrrigationType;
}

export type UpdateFarmInput = Partial<CreateFarmInput>;

export interface AddFarmerCropInput {
  farmId: string;
  cropId: string;
  area: number;
  areaUnit: AreaUnit;
  isPrimary?: boolean;
  typicalYield?: number;
  yieldUnit?: string;
}

export interface UpdateFarmerCropInput {
  area?: number;
  areaUnit?: AreaUnit;
  isPrimary?: boolean;
  typicalYield?: number | null;
  yieldUnit?: string | null;
}

export interface FarmerProfileInput {
  fpoMembershipStatus?: FpoMembershipStatus;
  fpoId?: string | null;
  liquidityPreference?: LiquidityPreference;
  willingToStore?: boolean;
  communicationPreference?: CommunicationPreference;
}
