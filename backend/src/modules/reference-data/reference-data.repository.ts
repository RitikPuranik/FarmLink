import { Crop, CropTranslation, District, Fpo, PrismaClient, State, Taluka } from "@prisma/client";

export type CropWithTranslations = Crop & { translations: CropTranslation[] };

/**
 * Read-mostly reference data: normalized location (State -> District ->
 * Taluka), the crop catalog + translations, and the minimal FPO directory.
 * Kept as its own repository/module (build spec section 64) so it can be
 * reused by farmers/farms/crops without those modules reaching into each
 * other's tables directly.
 */
export interface ReferenceDataRepository {
  listStates(): Promise<State[]>;
  findStateById(id: string): Promise<State | null>;

  listDistricts(stateId: string): Promise<District[]>;
  findDistrictById(id: string): Promise<District | null>;

  listTalukas(districtId: string): Promise<Taluka[]>;
  findTalukaById(id: string): Promise<Taluka | null>;

  listCrops(): Promise<CropWithTranslations[]>;
  findCropById(id: string): Promise<Crop | null>;
  findManyCropsByIds(ids: string[]): Promise<Crop[]>;

  listFpos(districtId?: string): Promise<Fpo[]>;
  findFpoById(id: string): Promise<Fpo | null>;
}

export class PrismaReferenceDataRepository implements ReferenceDataRepository {
  constructor(private readonly prisma: PrismaClient) {}

  listStates() {
    return this.prisma.state.findMany({ orderBy: { name: "asc" } });
  }

  findStateById(id: string) {
    return this.prisma.state.findUnique({ where: { id } });
  }

  listDistricts(stateId: string) {
    return this.prisma.district.findMany({ where: { stateId }, orderBy: { name: "asc" } });
  }

  findDistrictById(id: string) {
    return this.prisma.district.findUnique({ where: { id } });
  }

  listTalukas(districtId: string) {
    return this.prisma.taluka.findMany({ where: { districtId }, orderBy: { name: "asc" } });
  }

  findTalukaById(id: string) {
    return this.prisma.taluka.findUnique({ where: { id } });
  }

  listCrops() {
    return this.prisma.crop.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: { translations: true },
    });
  }

  findCropById(id: string) {
    return this.prisma.crop.findUnique({ where: { id } });
  }

  findManyCropsByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.crop.findMany({ where: { id: { in: ids } } });
  }

  listFpos(districtId?: string) {
    return this.prisma.fpo.findMany({
      where: { active: true, ...(districtId ? { districtId } : {}) },
      orderBy: { name: "asc" },
    });
  }

  findFpoById(id: string) {
    return this.prisma.fpo.findUnique({ where: { id } });
  }
}
