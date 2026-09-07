import { Prisma, PrismaClient, WarehouseSourceType } from "@prisma/client";

export interface WarehouseSourceReferenceRecord {
  id: string;
  warehouseId: string;
  sourceType: WarehouseSourceType;
  providerId: string;
  externalId: string;
  sourceUpdatedAt: Date | null;
  lastSyncedAt: Date | null;
  metadata: Prisma.JsonValue | null;
}

export interface CreateWarehouseSourceReferenceData {
  warehouseId: string;
  sourceType: WarehouseSourceType;
  providerId: string;
  externalId: string;
  sourceUpdatedAt?: Date | null;
  lastSyncedAt?: Date | null;
  metadata?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

export interface UpdateWarehouseSourceReferenceData {
  sourceUpdatedAt?: Date | null;
  lastSyncedAt?: Date | null;
  metadata?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

/**
 * Data-access boundary for WarehouseSourceReference — the provenance /
 * idempotency table the sync service upserts against by (providerId,
 * externalId), never by anything else (Part 12 of the ingestion spec).
 */
export interface WarehouseSourceReferenceRepository {
  findByProviderExternalId(providerId: string, externalId: string): Promise<WarehouseSourceReferenceRecord | null>;
  listByWarehouse(warehouseId: string): Promise<WarehouseSourceReferenceRecord[]>;
  create(data: CreateWarehouseSourceReferenceData, client?: Prisma.TransactionClient): Promise<WarehouseSourceReferenceRecord>;
  update(id: string, data: UpdateWarehouseSourceReferenceData, client?: Prisma.TransactionClient): Promise<WarehouseSourceReferenceRecord>;
}

export class PrismaWarehouseSourceReferenceRepository implements WarehouseSourceReferenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByProviderExternalId(providerId: string, externalId: string) {
    return this.prisma.warehouseSourceReference.findUnique({
      where: { providerId_externalId: { providerId, externalId } },
    });
  }

  listByWarehouse(warehouseId: string) {
    return this.prisma.warehouseSourceReference.findMany({ where: { warehouseId }, orderBy: { createdAt: "asc" } });
  }

  create(data: CreateWarehouseSourceReferenceData, client: PrismaClient | Prisma.TransactionClient = this.prisma) {
    return client.warehouseSourceReference.create({
      data: {
        warehouseId: data.warehouseId,
        sourceType: data.sourceType,
        providerId: data.providerId,
        externalId: data.externalId,
        sourceUpdatedAt: data.sourceUpdatedAt ?? null,
        lastSyncedAt: data.lastSyncedAt ?? new Date(),
        metadata: data.metadata,
      },
    });
  }

  update(id: string, data: UpdateWarehouseSourceReferenceData, client: PrismaClient | Prisma.TransactionClient = this.prisma) {
    return client.warehouseSourceReference.update({
      where: { id },
      data: {
        ...(data.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: data.sourceUpdatedAt } : {}),
        ...(data.lastSyncedAt !== undefined ? { lastSyncedAt: data.lastSyncedAt } : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
      },
    });
  }
}
