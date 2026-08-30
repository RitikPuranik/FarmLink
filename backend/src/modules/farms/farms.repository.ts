import { AreaUnit, District, Farm, IrrigationType, PrismaClient, State, Taluka } from "@prisma/client";

export type FarmWithLocation = Farm & { state: State; district: District; taluka: Taluka };

const LOCATION_INCLUDE = { state: true, district: true, taluka: true } as const;

export interface CreateFarmData {
  farmerProfileId: string;
  name?: string | null;
  village: string;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  stateId: string;
  districtId: string;
  talukaId: string;
  area: number;
  areaUnit: AreaUnit;
  irrigationType?: IrrigationType;
}

export type UpdateFarmData = Partial<Omit<CreateFarmData, "farmerProfileId">>;

/**
 * Data-access boundary for farms. Every method below is scoped to a single
 * farm/farmer by id — ownership itself (build spec section 29/37/48: "only
 * the owning farmer may access their own farms", "never trust a client-
 * supplied farmerId") is enforced in FarmsService by comparing
 * farm.farmerProfileId against the caller's own resolved profile id, never
 * by taking a farmerId from the request.
 */
export interface FarmsRepository {
  findManyByFarmerProfileId(farmerProfileId: string): Promise<FarmWithLocation[]>;
  /**
   * Batch lookup across many farmers at once — added for Module 3's FPO
   * member directory (village/district column), so listing N members costs
   * one query instead of N (build spec section 25/59). Purely additive;
   * findManyByFarmerProfileId above is unchanged and still used everywhere
   * it always was.
   */
  findManyByFarmerProfileIds(farmerProfileIds: string[]): Promise<FarmWithLocation[]>;
  findById(id: string): Promise<FarmWithLocation | null>;
  create(data: CreateFarmData): Promise<FarmWithLocation>;
  update(id: string, data: UpdateFarmData): Promise<FarmWithLocation>;
  delete(id: string): Promise<void>;
  countByFarmerProfileId(farmerProfileId: string): Promise<number>;
}

export class PrismaFarmsRepository implements FarmsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findManyByFarmerProfileId(farmerProfileId: string) {
    return this.prisma.farm.findMany({
      where: { farmerProfileId },
      orderBy: { createdAt: "asc" },
      include: LOCATION_INCLUDE,
    });
  }

  findManyByFarmerProfileIds(farmerProfileIds: string[]) {
    if (farmerProfileIds.length === 0) return Promise.resolve([]);
    return this.prisma.farm.findMany({
      where: { farmerProfileId: { in: farmerProfileIds } },
      orderBy: { createdAt: "asc" },
      include: LOCATION_INCLUDE,
    });
  }

  findById(id: string) {
    return this.prisma.farm.findUnique({ where: { id }, include: LOCATION_INCLUDE });
  }

  create(data: CreateFarmData) {
    return this.prisma.farm.create({
      data: {
        farmerProfileId: data.farmerProfileId,
        name: data.name ?? null,
        village: data.village,
        pincode: data.pincode ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        stateId: data.stateId,
        districtId: data.districtId,
        talukaId: data.talukaId,
        area: data.area,
        areaUnit: data.areaUnit,
        irrigationType: data.irrigationType ?? "NOT_SPECIFIED",
      },
      include: LOCATION_INCLUDE,
    });
  }

  update(id: string, data: UpdateFarmData) {
    return this.prisma.farm.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.village !== undefined ? { village: data.village } : {}),
        ...(data.pincode !== undefined ? { pincode: data.pincode } : {}),
        ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
        ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
        ...(data.stateId !== undefined ? { stateId: data.stateId } : {}),
        ...(data.districtId !== undefined ? { districtId: data.districtId } : {}),
        ...(data.talukaId !== undefined ? { talukaId: data.talukaId } : {}),
        ...(data.area !== undefined ? { area: data.area } : {}),
        ...(data.areaUnit !== undefined ? { areaUnit: data.areaUnit } : {}),
        ...(data.irrigationType !== undefined ? { irrigationType: data.irrigationType } : {}),
      },
      include: LOCATION_INCLUDE,
    });
  }

  async delete(id: string) {
    await this.prisma.farm.delete({ where: { id } });
  }

  countByFarmerProfileId(farmerProfileId: string) {
    return this.prisma.farm.count({ where: { farmerProfileId } });
  }
}
