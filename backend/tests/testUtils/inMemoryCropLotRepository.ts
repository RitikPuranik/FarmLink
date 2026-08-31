import { randomUUID } from "crypto";
import type {
  CreateCropLotData,
  CropLotListFilters,
  CropLotRepository,
  TransitionMeta,
  UpdateCropLotData,
} from "../../src/modules/lots/lots.repository";
import { InMemoryReferenceDataRepository } from "./inMemoryReferenceDataRepository";
import { InMemoryFarmsRepository } from "./inMemoryFarmsRepository";
import { InMemoryFpoRepository } from "./inMemoryFpoRepository";

export interface FakeCropLot {
  id: string;
  publicId: string;
  lotNumber: string;
  ownerType: string;
  sourceType: string;
  farmerId: string | null;
  fpoId: string | null;
  cropId: string;
  farmId: string | null;
  variety: string | null;
  unit: string;
  quantityKg: number;
  availableQuantityKg: number;
  harvestDate: Date | null;
  availabilityDate: Date;
  originVillage: string | null;
  originTaluka: string | null;
  originDistrict: string;
  originState: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeLotStatusHistoryEntry {
  lotId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
  reason: string | null;
  createdAt: Date;
}

/** Mirrors InMemoryAggregationGroupRepository's pattern (joins against the
 * other in-memory fakes to fake Prisma's `include: {crop, farm, fpo}`). */
export class InMemoryCropLotRepository implements CropLotRepository {
  lots: FakeCropLot[] = [];
  history: FakeLotStatusHistoryEntry[] = [];

  constructor(
    private readonly referenceData: InMemoryReferenceDataRepository,
    private readonly farmsRepo: InMemoryFarmsRepository,
    private readonly fposRepo: InMemoryFpoRepository,
  ) {}

  private withRelations(lot: FakeCropLot) {
    const crop = this.referenceData.crops.find((c) => c.id === lot.cropId);
    const farm = lot.farmId ? this.farmsRepo.farms.find((f) => f.id === lot.farmId) ?? null : null;
    const fpo = lot.fpoId ? this.fposRepo.fpos.find((f) => f.id === lot.fpoId) ?? null : null;
    return { ...lot, crop, farm, fpo } as never;
  }

  async findById(id: string) {
    const lot = this.lots.find((l) => l.id === id);
    return lot ? this.withRelations(lot) : null;
  }

  async findByPublicId(publicId: string) {
    const lot = this.lots.find((l) => l.publicId === publicId);
    return lot ? this.withRelations(lot) : null;
  }

  private matches(lot: FakeCropLot, filters: CropLotListFilters) {
    if (filters.status && lot.status !== filters.status) return false;
    if (filters.cropId && lot.cropId !== filters.cropId) return false;
    if (filters.farmId && lot.farmId !== filters.farmId) return false;
    return true;
  }

  async listByFarmerId(farmerId: string, filters: CropLotListFilters, page: number, limit: number) {
    const matches = this.lots.filter((l) => l.farmerId === farmerId && this.matches(l, filters));
    matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = matches.length;
    const start = (page - 1) * limit;
    return { items: matches.slice(start, start + limit).map((l) => this.withRelations(l)), total } as never;
  }

  async listByFpoId(fpoId: string, filters: CropLotListFilters, page: number, limit: number) {
    const matches = this.lots.filter((l) => l.fpoId === fpoId && this.matches(l, filters));
    matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = matches.length;
    const start = (page - 1) * limit;
    return { items: matches.slice(start, start + limit).map((l) => this.withRelations(l)), total } as never;
  }

  async create(data: CreateCropLotData, actorUserId: string | null) {
    const now = new Date();
    const year = now.getFullYear();
    const sequence = this.lots.filter((l) => l.lotNumber.startsWith(`LOT-${year}-`)).length + 1;
    const lot: FakeCropLot = {
      id: randomUUID(),
      publicId: randomUUID(),
      lotNumber: `LOT-${year}-${String(sequence).padStart(6, "0")}`,
      ownerType: data.ownerType,
      sourceType: data.sourceType,
      farmerId: data.farmerId ?? null,
      fpoId: data.fpoId ?? null,
      cropId: data.cropId,
      farmId: data.farmId ?? null,
      variety: data.variety ?? null,
      unit: data.unit,
      quantityKg: data.quantityKg,
      availableQuantityKg: data.quantityKg,
      harvestDate: data.harvestDate ?? null,
      availabilityDate: data.availabilityDate,
      originVillage: data.originVillage ?? null,
      originTaluka: data.originTaluka ?? null,
      originDistrict: data.originDistrict,
      originState: data.originState,
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
    };
    this.lots.push(lot);
    this.history.push({ lotId: lot.id, fromStatus: null, toStatus: "DRAFT", changedBy: actorUserId, reason: null, createdAt: now });
    return this.withRelations(lot);
  }

  async updateDraft(id: string, data: UpdateCropLotData) {
    const lot = this.lots.find((l) => l.id === id);
    if (!lot) throw new Error("CropLot not found in fake repository.");
    if (data.cropId !== undefined) lot.cropId = data.cropId;
    if (data.farmId !== undefined) lot.farmId = data.farmId;
    if (data.variety !== undefined) lot.variety = data.variety;
    if (data.unit !== undefined) lot.unit = data.unit;
    if (data.quantityKg !== undefined) lot.quantityKg = data.quantityKg;
    if (data.availableQuantityKg !== undefined) lot.availableQuantityKg = data.availableQuantityKg;
    if (data.harvestDate !== undefined) lot.harvestDate = data.harvestDate;
    if (data.availabilityDate !== undefined) lot.availabilityDate = data.availabilityDate;
    if (data.originVillage !== undefined) lot.originVillage = data.originVillage;
    if (data.originTaluka !== undefined) lot.originTaluka = data.originTaluka;
    if (data.originDistrict !== undefined) lot.originDistrict = data.originDistrict;
    if (data.originState !== undefined) lot.originState = data.originState;
    lot.updatedAt = new Date();
    return this.withRelations(lot);
  }

  async deleteDraft(id: string) {
    this.lots = this.lots.filter((l) => l.id !== id);
    this.history = this.history.filter((h) => h.lotId !== id);
  }

  async transition(id: string, fromStatuses: string[], toStatus: string, meta: TransitionMeta) {
    const lot = this.lots.find((l) => l.id === id);
    if (!lot || !fromStatuses.includes(lot.status)) return null;
    lot.status = toStatus;
    lot.updatedAt = new Date();
    this.history.push({
      lotId: id,
      fromStatus: meta.fromStatus,
      toStatus,
      changedBy: meta.actorUserId,
      reason: meta.reason ?? null,
      createdAt: new Date(),
    });
    return this.withRelations(lot);
  }

  async getHistory(id: string) {
    return this.history
      .filter((h) => h.lotId === id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        changedBy: h.changedBy,
        reason: h.reason,
        createdAt: h.createdAt.toISOString(),
      })) as never;
  }

  async summarizeForFarmer(farmerId: string) {
    const mine = this.lots.filter((l) => l.farmerId === farmerId);
    const totalAvailableQuantityKg = mine
      .filter((l) => l.status === "AVAILABLE")
      .reduce((sum, l) => sum + l.availableQuantityKg, 0);
    return {
      totalLots: mine.length,
      draftLots: mine.filter((l) => l.status === "DRAFT").length,
      availableLots: mine.filter((l) => l.status === "AVAILABLE").length,
      cancelledLots: mine.filter((l) => l.status === "CANCELLED").length,
      totalAvailableQuantityKg: Math.round(totalAvailableQuantityKg * 100) / 100,
    };
  }

  async adjustAvailableQuantity(id: string, deltaKg: number) {
    const lot = this.lots.find((l) => l.id === id);
    if (!lot) return null;
    if (deltaKg < 0 && lot.availableQuantityKg < Math.abs(deltaKg)) return null;
    lot.availableQuantityKg += deltaKg;
    lot.updatedAt = new Date();
    return this.withRelations(lot);
  }
}
