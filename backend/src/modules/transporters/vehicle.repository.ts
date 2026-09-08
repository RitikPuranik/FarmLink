import {
  PrismaClient,
  VehicleAvailabilityStatus,
  VehicleStatus,
  VehicleType,
  VehicleVerificationStatus,
} from "@prisma/client";
import { CreateVehicleData, UpdateVehicleData, VehicleDiscoveryFilters, VehicleRecord } from "./vehicle.types";

export interface VehicleListFilters {
  transporterId: string;
  page: number;
  limit: number;
}

export interface VehicleDiscoveryQuery extends VehicleDiscoveryFilters {
  transporterIds?: string[];
}

export interface VehiclePage {
  items: VehicleRecord[];
  total: number;
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

/** Re-exported so the service layer can recognize a race-condition duplicate
 * on create() without repeating Prisma's error-shape check itself. */
export { isUniqueConstraintError };

/**
 * Data-access boundary for Vehicle. Ownership/authorization is never
 * decided here (see transporter.authorization.ts) — this repository only
 * performs bounded reads/writes, never an unbounded fleet load.
 */
export interface VehicleRepository {
  create(data: CreateVehicleData): Promise<VehicleRecord>;
  findById(id: string): Promise<VehicleRecord | null>;
  findByPublicId(publicId: string): Promise<VehicleRecord | null>;
  findByNormalizedRegistrationNumber(normalized: string): Promise<VehicleRecord | null>;
  listByTransporter(filters: VehicleListFilters): Promise<VehiclePage>;
  discover(query: VehicleDiscoveryQuery): Promise<string[]>;
  update(id: string, data: UpdateVehicleData): Promise<VehicleRecord>;
  updateStatus(id: string, status: VehicleStatus): Promise<VehicleRecord>;
  updateAvailability(id: string, status: VehicleAvailabilityStatus): Promise<VehicleRecord>;
  updateVerification(id: string, status: VehicleVerificationStatus): Promise<VehicleRecord>;
  isRegistrationTaken(normalized: string): Promise<boolean>;
}

export class PrismaVehicleRepository implements VehicleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateVehicleData): Promise<VehicleRecord> {
    return this.prisma.vehicle.create({
      data: {
        transporterId: data.transporterId,
        registrationNumber: data.registrationNumber,
        normalizedRegistrationNumber: data.normalizedRegistrationNumber,
        vehicleType: data.vehicleType,
        capacityUnit: data.capacityUnit,
        capacityKg: data.capacityKg,
        capabilities: data.capabilities,
        isRefrigerated: data.isRefrigerated,
      },
    });
  }

  findById(id: string) {
    return this.prisma.vehicle.findUnique({ where: { id } });
  }

  findByPublicId(publicId: string) {
    return this.prisma.vehicle.findUnique({ where: { publicId } });
  }

  findByNormalizedRegistrationNumber(normalized: string) {
    return this.prisma.vehicle.findUnique({ where: { normalizedRegistrationNumber: normalized } });
  }

  async isRegistrationTaken(normalized: string): Promise<boolean> {
    const existing = await this.prisma.vehicle.findUnique({
      where: { normalizedRegistrationNumber: normalized },
      select: { id: true },
    });
    return existing !== null;
  }

  async listByTransporter(filters: VehicleListFilters): Promise<VehiclePage> {
    const where = { transporterId: filters.transporterId };
    const [items, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.vehicle.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Part N — returns the distinct transporterIds of vehicles matching the
   * discovery filters, for TransporterService.listTransporters to
   * intersect with transporter-level filters (state/district/verified).
   * Deliberately returns ids only, not ranked/scored vehicles.
   */
  async discover(query: VehicleDiscoveryQuery): Promise<string[]> {
    const where = {
      ...(query.transporterIds ? { transporterId: { in: query.transporterIds } } : {}),
      ...(query.vehicleType ? { vehicleType: query.vehicleType } : {}),
      ...(query.minimumCapacityKg !== undefined ? { capacityKg: { gte: query.minimumCapacityKg } } : {}),
      ...(query.refrigerated !== undefined ? { isRefrigerated: query.refrigerated } : {}),
      ...(query.availabilityStatus ? { availabilityStatus: query.availabilityStatus } : {}),
      ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
    };

    const rows = await this.prisma.vehicle.findMany({
      where,
      select: { transporterId: true },
      distinct: ["transporterId"],
    });
    return rows.map((r: { transporterId: string }) => r.transporterId);
  }

  update(id: string, data: UpdateVehicleData) {
    return this.prisma.vehicle.update({
      where: { id },
      data: {
        ...(data.vehicleType !== undefined ? { vehicleType: data.vehicleType } : {}),
        ...(data.capacityUnit !== undefined ? { capacityUnit: data.capacityUnit } : {}),
        ...(data.capacityKg !== undefined ? { capacityKg: data.capacityKg } : {}),
        ...(data.capabilities !== undefined ? { capabilities: data.capabilities } : {}),
        ...(data.isRefrigerated !== undefined ? { isRefrigerated: data.isRefrigerated } : {}),
      },
    });
  }

  updateStatus(id: string, status: VehicleStatus) {
    return this.prisma.vehicle.update({ where: { id }, data: { status } });
  }

  updateAvailability(id: string, status: VehicleAvailabilityStatus) {
    return this.prisma.vehicle.update({
      where: { id },
      data: { availabilityStatus: status, availabilityUpdatedAt: new Date() },
    });
  }

  updateVerification(id: string, status: VehicleVerificationStatus) {
    return this.prisma.vehicle.update({ where: { id }, data: { verificationStatus: status } });
  }
}

export type { VehicleType };
