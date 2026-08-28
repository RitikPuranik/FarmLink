import { randomUUID } from "crypto";
import type { CreateFarmData, FarmsRepository, UpdateFarmData } from "../../src/modules/farms/farms.repository";
import { InMemoryReferenceDataRepository } from "./inMemoryReferenceDataRepository";

export interface FakeFarm {
  id: string;
  farmerProfileId: string;
  name: string | null;
  village: string;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  stateId: string;
  districtId: string;
  talukaId: string;
  area: number;
  areaUnit: string;
  irrigationType: string;
  createdAt: Date;
  updatedAt: Date;
}

export class InMemoryFarmsRepository implements FarmsRepository {
  farms: FakeFarm[] = [];

  constructor(private readonly referenceData: InMemoryReferenceDataRepository) {}

  private withLocation(farm: FakeFarm) {
    const state = this.referenceData.states.find((s) => s.id === farm.stateId);
    const district = this.referenceData.districts.find((d) => d.id === farm.districtId);
    const taluka = this.referenceData.talukas.find((t) => t.id === farm.talukaId);
    return { ...farm, state, district, taluka } as never;
  }

  async findManyByFarmerProfileId(farmerProfileId: string) {
    return this.farms
      .filter((f) => f.farmerProfileId === farmerProfileId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((f) => this.withLocation(f)) as never;
  }

  async findById(id: string) {
    const farm = this.farms.find((f) => f.id === id);
    return (farm ? this.withLocation(farm) : null) as never;
  }

  async create(data: CreateFarmData) {
    const now = new Date();
    const farm: FakeFarm = {
      id: randomUUID(),
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
      createdAt: now,
      updatedAt: now,
    };
    this.farms.push(farm);
    return this.withLocation(farm);
  }

  async update(id: string, data: UpdateFarmData) {
    const farm = this.farms.find((f) => f.id === id);
    if (!farm) throw new Error("Farm not found in fake repository.");
    if (data.name !== undefined) farm.name = data.name ?? null;
    if (data.village !== undefined) farm.village = data.village;
    if (data.pincode !== undefined) farm.pincode = data.pincode ?? null;
    if (data.latitude !== undefined) farm.latitude = data.latitude ?? null;
    if (data.longitude !== undefined) farm.longitude = data.longitude ?? null;
    if (data.stateId !== undefined) farm.stateId = data.stateId;
    if (data.districtId !== undefined) farm.districtId = data.districtId;
    if (data.talukaId !== undefined) farm.talukaId = data.talukaId;
    if (data.area !== undefined) farm.area = data.area;
    if (data.areaUnit !== undefined) farm.areaUnit = data.areaUnit;
    if (data.irrigationType !== undefined) farm.irrigationType = data.irrigationType;
    farm.updatedAt = new Date();
    return this.withLocation(farm);
  }

  async delete(id: string) {
    this.farms = this.farms.filter((f) => f.id !== id);
  }

  async countByFarmerProfileId(farmerProfileId: string) {
    return this.farms.filter((f) => f.farmerProfileId === farmerProfileId).length;
  }
}
