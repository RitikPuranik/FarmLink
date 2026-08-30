import { AggregationGroupStatus, QuantityUnit } from "@prisma/client";
import { AggregationGroupWithCrop } from "./aggregation.repository";

/** One crop's pooled estimate across an FPO's active members — build spec
 * section 28/72/73. Never a guarantee of production or a commitment (build
 * spec section 74/97: this is *estimated* supply only). */
export interface CropAggregationRowDTO {
  cropId: string;
  cropName: string;
  farmerCount: number;
  totalArea: number;
  areaUnit: "ACRE";
  estimatedQuantity: number | null;
  quantityUnit: "QTL";
  // How many of farmerCount actually contributed to estimatedQuantity —
  // present so a partial estimate (some farmers missing yield data) is
  // never silently indistinguishable from a complete one (build spec
  // section 30: never invent, never hide that a number is incomplete).
  estimateCoverage: { farmersWithEstimate: number; totalFarmers: number };
  calculatedAt: string;
}

export interface CropAggregationMemberRowDTO {
  farmerPublicId: string;
  name: string | null;
  area: number;
  areaUnit: "ACRE";
  estimatedQuantity: number | null;
  quantityUnit: "QTL";
}

export interface AggregationGroupDTO {
  publicId: string;
  crop: { id: string; name: string };
  targetQuantity: number | null;
  estimatedQuantity: number | null;
  gapQuantity: number | null;
  unit: QuantityUnit;
  status: AggregationGroupStatus;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toAggregationGroupDTO(
  group: AggregationGroupWithCrop,
  liveEstimatedQuantity: number | null,
): AggregationGroupDTO {
  const gapQuantity =
    group.targetQuantity !== null && liveEstimatedQuantity !== null
      ? Math.max(0, group.targetQuantity - liveEstimatedQuantity)
      : null;
  return {
    publicId: group.publicId,
    crop: { id: group.crop.id, name: group.crop.name },
    targetQuantity: group.targetQuantity,
    estimatedQuantity: liveEstimatedQuantity,
    gapQuantity,
    unit: group.unit,
    status: group.status,
    targetDate: group.targetDate ? group.targetDate.toISOString() : null,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export interface FpoAnalyticsDTO {
  memberCount: number;
  activeMemberCount: number;
  pendingMemberships: number;
  cropCount: number;
  estimatedTotalSupply: { value: number; unit: "QTL" };
  topCrops: { crop: string; estimatedQuantity: number }[];
  activeAggregationGroups: number;
  calculatedAt: string;
}

export interface GovernmentFpoSummaryDTO {
  fpoCount: number;
  totalMemberCount: number;
  districtWise: { district: string; fpoCount: number }[];
  cropWiseEstimatedSupply: { crop: string; estimatedQuantity: number; quantityUnit: "QTL" }[];
  calculatedAt: string;
}
