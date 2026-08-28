import { AreaUnit, Crop, CropTranslation, Farm, FarmerCrop, PrismaClient } from "@prisma/client";

export type FarmerCropWithCrop = FarmerCrop & { crop: Crop & { translations: CropTranslation[] }; farm: Farm };

const CROP_INCLUDE = { crop: { include: { translations: true } }, farm: true } as const;

export interface CreateFarmerCropData {
  farmerProfileId: string;
  farmId: string;
  cropId: string;
  area: number;
  areaUnit: AreaUnit;
  isPrimary?: boolean;
  typicalYield?: number | null;
  yieldUnit?: string | null;
}

export interface UpdateFarmerCropData {
  area?: number;
  areaUnit?: AreaUnit;
  typicalYield?: number | null;
  yieldUnit?: string | null;
}

/**
 * Data-access boundary for the farmer <-> crop relationship. Ownership
 * (build spec section 30: "backend must confirm the crop belongs to the
 * authenticated farmer") is enforced in CropsService by comparing
 * farmerCrop.farmerProfileId against the caller's own profile id — never
 * by trusting a farmerId/farmId the client supplies directly.
 */
export interface FarmerCropRepository {
  findManyByFarmerProfileId(farmerProfileId: string): Promise<FarmerCropWithCrop[]>;
  findManyByFarmId(farmId: string): Promise<FarmerCrop[]>;
  findById(id: string): Promise<FarmerCropWithCrop | null>;
  findByFarmAndCrop(farmId: string, cropId: string): Promise<FarmerCrop | null>;
  create(data: CreateFarmerCropData): Promise<FarmerCropWithCrop>;
  update(id: string, data: UpdateFarmerCropData): Promise<FarmerCropWithCrop>;
  delete(id: string): Promise<void>;

  /**
   * Atomically unsets whichever crop is currently primary for `farmId`
   * (if any) and sets `farmerCropId` as the new primary — build spec
   * section 20/45: "never leave the farm with two primary crops because
   * of a partial update".
   */
  setPrimary(farmId: string, farmerCropId: string): Promise<FarmerCropWithCrop>;
}

export class PrismaFarmerCropRepository implements FarmerCropRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findManyByFarmerProfileId(farmerProfileId: string) {
    return this.prisma.farmerCrop.findMany({
      where: { farmerProfileId },
      orderBy: { createdAt: "asc" },
      include: CROP_INCLUDE,
    });
  }

  findManyByFarmId(farmId: string) {
    return this.prisma.farmerCrop.findMany({ where: { farmId }, orderBy: { createdAt: "asc" } });
  }

  findById(id: string) {
    return this.prisma.farmerCrop.findUnique({ where: { id }, include: CROP_INCLUDE });
  }

  findByFarmAndCrop(farmId: string, cropId: string) {
    return this.prisma.farmerCrop.findUnique({ where: { farmId_cropId: { farmId, cropId } } });
  }

  create(data: CreateFarmerCropData) {
    return this.prisma.farmerCrop.create({
      data: {
        farmerProfileId: data.farmerProfileId,
        farmId: data.farmId,
        cropId: data.cropId,
        area: data.area,
        areaUnit: data.areaUnit,
        isPrimary: data.isPrimary ?? false,
        typicalYield: data.typicalYield ?? null,
        yieldUnit: data.yieldUnit ?? null,
      },
      include: CROP_INCLUDE,
    });
  }

  update(id: string, data: UpdateFarmerCropData) {
    return this.prisma.farmerCrop.update({
      where: { id },
      data: {
        ...(data.area !== undefined ? { area: data.area } : {}),
        ...(data.areaUnit !== undefined ? { areaUnit: data.areaUnit } : {}),
        ...(data.typicalYield !== undefined ? { typicalYield: data.typicalYield } : {}),
        ...(data.yieldUnit !== undefined ? { yieldUnit: data.yieldUnit } : {}),
      },
      include: CROP_INCLUDE,
    });
  }

  async delete(id: string) {
    await this.prisma.farmerCrop.delete({ where: { id } });
  }

  async setPrimary(farmId: string, farmerCropId: string): Promise<FarmerCropWithCrop> {
    await this.prisma.$transaction([
      this.prisma.farmerCrop.updateMany({
        where: { farmId, isPrimary: true, NOT: { id: farmerCropId } },
        data: { isPrimary: false },
      }),
      this.prisma.farmerCrop.update({
        where: { id: farmerCropId },
        data: { isPrimary: true },
      }),
    ]);
    // Re-fetch with the full include shape — $transaction's tuple typing
    // doesn't carry the `include` through cleanly, and this keeps the
    // return type identical to every other method on this repository.
    const updated = await this.findById(farmerCropId);
    if (!updated) {
      throw new Error("FarmerCrop disappeared mid-transaction — this should never happen.");
    }
    return updated;
  }
}
