import { FarmerCropRepository } from "../crops/farmer-crop.repository";
import { AreaUnit, convertKgToQuantity, estimateFarmerCropQuantityKg } from "./unit-conversion";
import { FpoRepository } from "./fpo.repository";
import { FpoMembershipRepository } from "./membership.repository";
import { GovernmentFpoSummaryDTO } from "./aggregation.types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Build spec section 42: a read-only, aggregate-only view for
 * GOVERNMENT_VIEWER — FPO counts, member counts, district-wise FPO
 * statistics, and crop-wise aggregate supply nationally. Deliberately
 * never returns individual farmer records (build spec: "do not expose
 * unnecessary individual farmer records").
 */
export class GovernmentFpoService {
  constructor(
    private readonly fpoRepo: FpoRepository,
    private readonly memberships: FpoMembershipRepository,
    private readonly farmerCrops: FarmerCropRepository,
  ) {}

  async getSummary(): Promise<GovernmentFpoSummaryDTO> {
    const fpos = await this.fpoRepo.listAllForSummary();

    const districtCounts = new Map<string, number>();
    for (const fpo of fpos) {
      districtCounts.set(fpo.districtName, (districtCounts.get(fpo.districtName) ?? 0) + 1);
    }

    const counts = await this.memberships.countActiveGroupedByFpoIds(fpos.map((f) => f.id));
    const totalMemberCount = Object.values(counts).reduce((sum, n) => sum + n, 0);

    const activeFarmerIds = await this.memberships.listAllActiveFarmerProfileIds();
    const cropRows = activeFarmerIds.length > 0 ? await this.farmerCrops.findManyByFarmerProfileIds(activeFarmerIds) : [];

    const cropTotalsKg = new Map<string, { name: string; quantityKg: number }>();
    for (const row of cropRows) {
      const estimate = estimateFarmerCropQuantityKg({
        area: row.area,
        areaUnit: row.areaUnit as AreaUnit,
        typicalYield: row.typicalYield,
        yieldUnit: row.yieldUnit,
      });
      if (estimate.estimatedQuantityKg === null) continue;
      const bucket = cropTotalsKg.get(row.cropId) ?? { name: row.crop.name, quantityKg: 0 };
      bucket.quantityKg += estimate.estimatedQuantityKg;
      cropTotalsKg.set(row.cropId, bucket);
    }

    return {
      fpoCount: fpos.length,
      totalMemberCount,
      districtWise: Array.from(districtCounts.entries())
        .map(([district, fpoCount]) => ({ district, fpoCount }))
        .sort((a, b) => b.fpoCount - a.fpoCount),
      cropWiseEstimatedSupply: Array.from(cropTotalsKg.values())
        .map((c) => ({ crop: c.name, estimatedQuantity: round2(convertKgToQuantity(c.quantityKg, "QTL")), quantityUnit: "QTL" as const }))
        .sort((a, b) => b.estimatedQuantity - a.estimatedQuantity),
      calculatedAt: new Date().toISOString(),
    };
  }
}
