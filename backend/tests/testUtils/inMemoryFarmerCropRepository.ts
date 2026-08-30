import { randomUUID } from "crypto";
import type {
  CreateFarmerCropData,
  FarmerCropRepository,
  UpdateFarmerCropData,
} from "../../src/modules/crops/farmer-crop.repository";
import { InMemoryReferenceDataRepository } from "./inMemoryReferenceDataRepository";
import { InMemoryFarmsRepository } from "./inMemoryFarmsRepository";

export interface FakeFarmerCrop {
  id: string;
  farmerProfileId: string;
  farmId: string;
  cropId: string;
  area: number;
  areaUnit: string;
  isPrimary: boolean;
  typicalYield: number | null;
  yieldUnit: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class InMemoryFarmerCropRepository implements FarmerCropRepository {
  rows: FakeFarmerCrop[] = [];

  constructor(
    private readonly referenceData: InMemoryReferenceDataRepository,
    private readonly farms: InMemoryFarmsRepository,
  ) {}

  private withCrop(row: FakeFarmerCrop) {
    const crop = this.referenceData.crops.find((c) => c.id === row.cropId);
    const translations = this.referenceData.cropTranslations.filter((t) => t.cropId === row.cropId);
    const farm = this.farms.farms.find((f) => f.id === row.farmId);
    return { ...row, crop: crop ? { ...crop, translations } : undefined, farm } as never;
  }

  async findManyByFarmerProfileId(farmerProfileId: string) {
    return this.rows
      .filter((r) => r.farmerProfileId === farmerProfileId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => this.withCrop(r)) as never;
  }

  async findManyByFarmerProfileIds(farmerProfileIds: string[]) {
    return this.rows
      .filter((r) => farmerProfileIds.includes(r.farmerProfileId))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => this.withCrop(r)) as never;
  }

  async findManyByFarmId(farmId: string) {
    return this.rows.filter((r) => r.farmId === farmId) as never;
  }

  async findById(id: string) {
    const row = this.rows.find((r) => r.id === id);
    return (row ? this.withCrop(row) : null) as never;
  }

  async findByFarmAndCrop(farmId: string, cropId: string) {
    return (this.rows.find((r) => r.farmId === farmId && r.cropId === cropId) as never) ?? null;
  }

  async create(data: CreateFarmerCropData) {
    const now = new Date();
    const row: FakeFarmerCrop = {
      id: randomUUID(),
      farmerProfileId: data.farmerProfileId,
      farmId: data.farmId,
      cropId: data.cropId,
      area: data.area,
      areaUnit: data.areaUnit,
      isPrimary: data.isPrimary ?? false,
      typicalYield: data.typicalYield ?? null,
      yieldUnit: data.yieldUnit ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return this.withCrop(row);
  }

  async update(id: string, data: UpdateFarmerCropData) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error("FarmerCrop not found in fake repository.");
    if (data.area !== undefined) row.area = data.area;
    if (data.areaUnit !== undefined) row.areaUnit = data.areaUnit;
    if (data.typicalYield !== undefined) row.typicalYield = data.typicalYield ?? null;
    if (data.yieldUnit !== undefined) row.yieldUnit = data.yieldUnit ?? null;
    row.updatedAt = new Date();
    return this.withCrop(row);
  }

  async delete(id: string) {
    this.rows = this.rows.filter((r) => r.id !== id);
  }

  async setPrimary(farmId: string, farmerCropId: string) {
    for (const row of this.rows) {
      if (row.farmId === farmId) {
        row.isPrimary = row.id === farmerCropId;
      }
    }
    const updated = this.rows.find((r) => r.id === farmerCropId);
    if (!updated) throw new Error("FarmerCrop not found in fake repository.");
    return this.withCrop(updated);
  }
}
