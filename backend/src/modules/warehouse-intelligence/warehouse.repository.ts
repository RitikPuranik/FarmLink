import { PrismaClient, StorageType, VerificationStatus, WarehouseOwnerType, WarehouseStatus } from "@prisma/client";
import { WarehouseWithCapacity, WarehouseWithRelations } from "./warehouse.types";

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;

// Shared by findNearbyCandidates()/findByPublicIdWithCapacity() below —
// always active storage units, always the crop attached to a capability
// row, never anything beyond what the availability service needs (avoids
// pulling reservations/rates into a read path that doesn't use them).
const CAPACITY_INCLUDE = {
  storageUnits: { where: { isActive: true } },
  capabilities: { where: { isActive: true }, include: { crop: true } },
} as const;

export interface BoundingBoxFilters {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
  /** Omitted entirely (rather than defaulted to ACTIVE) so an ADMIN caller
   * can pass no status filter and see every operational state — see
   * WarehouseAvailabilityService.searchNearby()'s own authorization
   * comment for why non-admins always pass "ACTIVE" here. */
  status?: WarehouseStatus;
  isActiveOnly?: boolean;
  /** Scopes the eagerly-loaded capabilities to one crop so the include
   * above never has to load a warehouse's entire capability list for
   * every candidate — see WarehouseCapabilityRepository.findCompatible()
   * for the equivalent single-warehouse query this mirrors. */
  cropId?: string;
}

export interface CreateWarehouseData {
  ownerType: WarehouseOwnerType;
  ownerUserId?: string | null;
  ownerFpoId?: string | null;
  name: string;
  warehouseType: StorageType;
  state: string;
  district: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface UpdateWarehouseData {
  name?: string;
  warehouseType?: StorageType;
  state?: string;
  district?: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  verificationStatus?: VerificationStatus;
  status?: WarehouseStatus;
  isActive?: boolean;
}

export interface WarehouseListFilters {
  ownerUserId?: string;
  ownerFpoId?: string;
  state?: string;
  district?: string;
  status?: WarehouseStatus;
  verificationStatus?: VerificationStatus;
}

export interface WarehouseListResult {
  items: WarehouseWithRelations[];
  total: number;
}

/**
 * Data-access boundary for the Warehouse model (Module 9 Part 1). Ownership
 * legality (exactly one of ownerUserId/ownerFpoId, matching ownerType) and
 * any authorization decision are never enforced here — that belongs to a
 * future service layer, exactly as CropLotRepository leaves farmer/fpo
 * pairing legality to lots.service.ts. This repository only reads and
 * writes rows, with bounded list pagination.
 */
export interface WarehouseRepository {
  findById(id: string): Promise<WarehouseWithRelations | null>;
  findByPublicId(publicId: string): Promise<WarehouseWithRelations | null>;
  list(filters: WarehouseListFilters, page: number, limit: number): Promise<WarehouseListResult>;
  create(data: CreateWarehouseData): Promise<WarehouseWithRelations>;
  update(id: string, data: UpdateWarehouseData): Promise<WarehouseWithRelations>;

  // ---------------------------------------------------------------------
  // Module 9 Part 2 additions
  // ---------------------------------------------------------------------

  /** Warehouse + active storage units + (optionally crop-scoped) active
   * capability rows in one round trip, for the availability/detail
   * endpoints. Never used for list/search — see findNearbyCandidates(). */
  findByPublicIdWithCapacity(publicId: string, cropId?: string): Promise<WarehouseWithCapacity | null>;

  /**
   * Bounding-box candidate query for nearby search: the WHERE clause does
   * the coarse filtering in SQL (never "load every warehouse and filter
   * in memory" — see this repository's own Repository Performance
   * requirement), bounded by `limit`, before the service does the exact
   * Haversine pass and radius cut. Rows with a null latitude/longitude
   * can never satisfy a numeric range filter, so they are excluded
   * automatically.
   */
  findNearbyCandidates(bbox: BoundingBoxFilters, limit: number): Promise<WarehouseWithCapacity[]>;
}

export class PrismaWarehouseRepository implements WarehouseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string) {
    return this.prisma.warehouse.findUnique({ where: { id } });
  }

  findByPublicId(publicId: string) {
    return this.prisma.warehouse.findUnique({ where: { publicId } });
  }

  async list(filters: WarehouseListFilters, page: number, limit: number): Promise<WarehouseListResult> {
    const safePage = Math.max(1, Math.trunc(page) || 1);
    const safeLimit = Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(limit) || DEFAULT_LIST_LIMIT));

    const where = {
      ...(filters.ownerUserId ? { ownerUserId: filters.ownerUserId } : {}),
      ...(filters.ownerFpoId ? { ownerFpoId: filters.ownerFpoId } : {}),
      ...(filters.state ? { state: filters.state } : {}),
      ...(filters.district ? { district: filters.district } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.verificationStatus ? { verificationStatus: filters.verificationStatus } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.warehouse.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.warehouse.count({ where }),
    ]);
    return { items, total };
  }

  create(data: CreateWarehouseData) {
    return this.prisma.warehouse.create({
      data: {
        ownerType: data.ownerType,
        ownerUserId: data.ownerUserId ?? null,
        ownerFpoId: data.ownerFpoId ?? null,
        name: data.name,
        warehouseType: data.warehouseType,
        state: data.state,
        district: data.district,
        address: data.address ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
      },
    });
  }

  update(id: string, data: UpdateWarehouseData) {
    return this.prisma.warehouse.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.warehouseType !== undefined ? { warehouseType: data.warehouseType } : {}),
        ...(data.state !== undefined ? { state: data.state } : {}),
        ...(data.district !== undefined ? { district: data.district } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
        ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
        ...(data.verificationStatus !== undefined ? { verificationStatus: data.verificationStatus } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
  }

  findByPublicIdWithCapacity(publicId: string, cropId?: string) {
    return this.prisma.warehouse.findUnique({
      where: { publicId },
      include: cropId
        ? { ...CAPACITY_INCLUDE, capabilities: { where: { isActive: true, cropId }, include: { crop: true } } }
        : CAPACITY_INCLUDE,
    }) as unknown as Promise<WarehouseWithCapacity | null>;
  }

  findNearbyCandidates(bbox: BoundingBoxFilters, limit: number) {
    const safeLimit = Math.min(MAX_LIST_LIMIT * 2, Math.max(1, Math.trunc(limit) || MAX_LIST_LIMIT));

    return this.prisma.warehouse.findMany({
      where: {
        latitude: { gte: bbox.minLatitude, lte: bbox.maxLatitude },
        longitude: { gte: bbox.minLongitude, lte: bbox.maxLongitude },
        ...(bbox.status ? { status: bbox.status } : {}),
        ...(bbox.isActiveOnly ? { isActive: true } : {}),
      },
      include: bbox.cropId
        ? { ...CAPACITY_INCLUDE, capabilities: { where: { isActive: true, cropId: bbox.cropId }, include: { crop: true } } }
        : CAPACITY_INCLUDE,
      // Deterministic pre-sort: createdAt is stable and cheap to index on,
      // exact tie-breaking (distance/capacity/canAccommodate) happens once
      // in the service after the Haversine pass, per this part's
      // documented sort order.
      orderBy: { createdAt: "asc" },
      take: safeLimit,
    }) as unknown as Promise<WarehouseWithCapacity[]>;
  }
}
