import { randomUUID } from "crypto";
import type {
  AggregationGroupListFilters,
  AggregationGroupRepository,
  CreateAggregationGroupData,
  UpdateAggregationGroupData,
} from "../../src/modules/fpo/aggregation.repository";
import { InMemoryReferenceDataRepository } from "./inMemoryReferenceDataRepository";

export interface FakeAggregationGroup {
  id: string;
  publicId: string;
  fpoId: string;
  cropId: string;
  targetQuantity: number | null;
  estimatedQuantity: number | null;
  unit: string;
  status: string;
  targetDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class InMemoryAggregationGroupRepository implements AggregationGroupRepository {
  groups: FakeAggregationGroup[] = [];

  constructor(private readonly referenceData: InMemoryReferenceDataRepository) {}

  private withCrop(group: FakeAggregationGroup) {
    const crop = this.referenceData.crops.find((c) => c.id === group.cropId);
    return { ...group, crop } as never;
  }

  async findById(id: string) {
    const group = this.groups.find((g) => g.id === id);
    return group ? this.withCrop(group) : null;
  }

  async findByPublicId(publicId: string) {
    const group = this.groups.find((g) => g.publicId === publicId);
    return group ? this.withCrop(group) : null;
  }

  async listByFpoId(fpoId: string, filters: AggregationGroupListFilters) {
    let matches = this.groups.filter((g) => g.fpoId === fpoId);
    if (filters.cropId) matches = matches.filter((g) => g.cropId === filters.cropId);
    if (filters.status) matches = matches.filter((g) => g.status === filters.status);
    return matches
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((g) => this.withCrop(g)) as never;
  }

  async create(data: CreateAggregationGroupData) {
    const now = new Date();
    const group: FakeAggregationGroup = {
      id: randomUUID(),
      publicId: randomUUID(),
      fpoId: data.fpoId,
      cropId: data.cropId,
      targetQuantity: data.targetQuantity ?? null,
      estimatedQuantity: data.estimatedQuantity ?? null,
      unit: data.unit,
      status: "OPEN",
      targetDate: data.targetDate ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.groups.push(group);
    return this.withCrop(group);
  }

  async update(id: string, data: UpdateAggregationGroupData) {
    const group = this.groups.find((g) => g.id === id);
    if (!group) throw new Error(`AggregationGroup ${id} not found`);
    if (data.targetQuantity !== undefined) group.targetQuantity = data.targetQuantity;
    if (data.targetDate !== undefined) group.targetDate = data.targetDate;
    if (data.status !== undefined) group.status = data.status;
    if (data.estimatedQuantity !== undefined) group.estimatedQuantity = data.estimatedQuantity;
    group.updatedAt = new Date();
    return this.withCrop(group);
  }

  async transition(id: string, fromStatuses: string[], toStatus: string) {
    const group = this.groups.find((g) => g.id === id);
    if (!group || !fromStatuses.includes(group.status)) return null;
    group.status = toStatus;
    group.updatedAt = new Date();
    return this.withCrop(group);
  }

  async countActiveByFpoId(fpoId: string) {
    return this.groups.filter((g) => g.fpoId === fpoId && (g.status === "OPEN" || g.status === "READY")).length;
  }
}
