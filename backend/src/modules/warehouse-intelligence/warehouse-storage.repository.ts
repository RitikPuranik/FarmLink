import { PrismaClient, QuantityUnit, StorageType } from "@prisma/client";
import { WarehouseStorageUnitWithRelations } from "./warehouse.types";

export interface CreateWarehouseStorageUnitData {
  warehouseId: string;
  code: string;
  storageType: StorageType;
  totalCapacity: number;
  // Defaults to totalCapacity when omitted — a freshly created unit starts
  // fully available, mirroring CropLot.create() seeding
  // availableQuantityKg from quantityKg.
  availableCapacity?: number;
  capacityUnit?: QuantityUnit;
  temperatureControlled?: boolean;
  minTemperature?: number | null;
  maxTemperature?: number | null;
  humidityControlled?: boolean;
  minHumidity?: number | null;
  maxHumidity?: number | null;
  // Module 9 Part 3 — declared storage-condition capability flags. Left
  // undefined (never defaulted to false) so a freshly created unit starts
  // with these genuinely unknown, exactly like a fresh
  // WarehouseCropCapability row starts with no configured guidance.
  ventilationAvailable?: boolean | null;
  coldStorageAvailable?: boolean | null;
  controlledAtmosphereAvailable?: boolean | null;
  pestControlAvailable?: boolean | null;
  moistureControlAvailable?: boolean | null;
}

export interface UpdateWarehouseStorageUnitData {
  code?: string;
  storageType?: StorageType;
  totalCapacity?: number;
  availableCapacity?: number;
  capacityUnit?: QuantityUnit;
  temperatureControlled?: boolean;
  minTemperature?: number | null;
  maxTemperature?: number | null;
  humidityControlled?: boolean;
  minHumidity?: number | null;
  maxHumidity?: number | null;
  // Module 9 Part 3 additions — see CreateWarehouseStorageUnitData above.
  ventilationAvailable?: boolean | null;
  coldStorageAvailable?: boolean | null;
  controlledAtmosphereAvailable?: boolean | null;
  pestControlAvailable?: boolean | null;
  moistureControlAvailable?: boolean | null;
  isActive?: boolean;
}

/**
 * Data-access boundary for WarehouseStorageUnit (Module 9 Part 1). No
 * capacity-allocation transactions here yet — availableCapacity is a plain
 * column update in Part 1, never a guarded/atomic decrement (that lands
 * alongside the reservation workflow in a future part, mirroring
 * CropLotRepository.adjustAvailableQuantity()'s own history).
 */
export interface WarehouseStorageRepository {
  findByPublicId(publicId: string): Promise<WarehouseStorageUnitWithRelations | null>;
  listByWarehouse(warehouseId: string): Promise<WarehouseStorageUnitWithRelations[]>;
  create(data: CreateWarehouseStorageUnitData): Promise<WarehouseStorageUnitWithRelations>;
  update(id: string, data: UpdateWarehouseStorageUnitData): Promise<WarehouseStorageUnitWithRelations>;
}

export class PrismaWarehouseStorageRepository implements WarehouseStorageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByPublicId(publicId: string) {
    return this.prisma.warehouseStorageUnit.findUnique({ where: { publicId } });
  }

  listByWarehouse(warehouseId: string) {
    return this.prisma.warehouseStorageUnit.findMany({
      where: { warehouseId },
      orderBy: { createdAt: "asc" },
    });
  }

  create(data: CreateWarehouseStorageUnitData) {
    return this.prisma.warehouseStorageUnit.create({
      data: {
        warehouseId: data.warehouseId,
        code: data.code,
        storageType: data.storageType,
        totalCapacity: data.totalCapacity,
        availableCapacity: data.availableCapacity ?? data.totalCapacity,
        capacityUnit: data.capacityUnit ?? "KG",
        temperatureControlled: data.temperatureControlled ?? false,
        minTemperature: data.minTemperature ?? null,
        maxTemperature: data.maxTemperature ?? null,
        humidityControlled: data.humidityControlled ?? false,
        minHumidity: data.minHumidity ?? null,
        maxHumidity: data.maxHumidity ?? null,
        ventilationAvailable: data.ventilationAvailable ?? null,
        coldStorageAvailable: data.coldStorageAvailable ?? null,
        controlledAtmosphereAvailable: data.controlledAtmosphereAvailable ?? null,
        pestControlAvailable: data.pestControlAvailable ?? null,
        moistureControlAvailable: data.moistureControlAvailable ?? null,
      },
    });
  }

  update(id: string, data: UpdateWarehouseStorageUnitData) {
    return this.prisma.warehouseStorageUnit.update({
      where: { id },
      data: {
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.storageType !== undefined ? { storageType: data.storageType } : {}),
        ...(data.totalCapacity !== undefined ? { totalCapacity: data.totalCapacity } : {}),
        ...(data.availableCapacity !== undefined ? { availableCapacity: data.availableCapacity } : {}),
        ...(data.capacityUnit !== undefined ? { capacityUnit: data.capacityUnit } : {}),
        ...(data.temperatureControlled !== undefined ? { temperatureControlled: data.temperatureControlled } : {}),
        ...(data.minTemperature !== undefined ? { minTemperature: data.minTemperature } : {}),
        ...(data.maxTemperature !== undefined ? { maxTemperature: data.maxTemperature } : {}),
        ...(data.humidityControlled !== undefined ? { humidityControlled: data.humidityControlled } : {}),
        ...(data.minHumidity !== undefined ? { minHumidity: data.minHumidity } : {}),
        ...(data.maxHumidity !== undefined ? { maxHumidity: data.maxHumidity } : {}),
        ...(data.ventilationAvailable !== undefined ? { ventilationAvailable: data.ventilationAvailable } : {}),
        ...(data.coldStorageAvailable !== undefined ? { coldStorageAvailable: data.coldStorageAvailable } : {}),
        ...(data.controlledAtmosphereAvailable !== undefined
          ? { controlledAtmosphereAvailable: data.controlledAtmosphereAvailable }
          : {}),
        ...(data.pestControlAvailable !== undefined ? { pestControlAvailable: data.pestControlAvailable } : {}),
        ...(data.moistureControlAvailable !== undefined
          ? { moistureControlAvailable: data.moistureControlAvailable }
          : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
  }
}
