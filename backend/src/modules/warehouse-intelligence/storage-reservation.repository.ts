import { PrismaClient, QuantityUnit, StorageReservationStatus } from "@prisma/client";
import { StorageReservationWithRelations } from "./warehouse.types";

export interface CreatePendingReservationData {
  warehouseId: string;
  storageUnitId?: string | null;
  lotId: string;
  quantity: number;
  unit?: QuantityUnit;
  reservedFrom: Date;
  reservedUntil?: Date | null;
}

/**
 * Data-access boundary for StorageReservation (Module 9 Part 1 foundation
 * only). create() always writes a PENDING row and nothing else — no
 * capacity check, no atomic decrement of WarehouseStorageUnit.
 * availableCapacity, no concurrency-safe transaction. Those are explicitly
 * out of scope for this part; updateStatus() is a plain column write for
 * the same reason, not a guarded state-machine transition like
 * CropLotRepository.transition().
 */
export interface StorageReservationRepository {
  findByPublicId(publicId: string): Promise<StorageReservationWithRelations | null>;
  listByLot(lotId: string): Promise<StorageReservationWithRelations[]>;
  listByWarehouse(warehouseId: string, status?: StorageReservationStatus): Promise<StorageReservationWithRelations[]>;
  create(data: CreatePendingReservationData): Promise<StorageReservationWithRelations>;
  updateStatus(id: string, status: StorageReservationStatus): Promise<StorageReservationWithRelations>;
}

export class PrismaStorageReservationRepository implements StorageReservationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByPublicId(publicId: string) {
    return this.prisma.storageReservation.findUnique({ where: { publicId } });
  }

  listByLot(lotId: string) {
    return this.prisma.storageReservation.findMany({
      where: { lotId },
      orderBy: { createdAt: "desc" },
    });
  }

  listByWarehouse(warehouseId: string, status?: StorageReservationStatus) {
    return this.prisma.storageReservation.findMany({
      where: { warehouseId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  create(data: CreatePendingReservationData) {
    return this.prisma.storageReservation.create({
      data: {
        warehouseId: data.warehouseId,
        storageUnitId: data.storageUnitId ?? null,
        lotId: data.lotId,
        quantity: data.quantity,
        unit: data.unit ?? "KG",
        status: "PENDING",
        reservedFrom: data.reservedFrom,
        reservedUntil: data.reservedUntil ?? null,
      },
    });
  }

  updateStatus(id: string, status: StorageReservationStatus) {
    return this.prisma.storageReservation.update({
      where: { id },
      data: { status },
    });
  }
}
