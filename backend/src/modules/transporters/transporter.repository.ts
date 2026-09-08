import { PrismaClient, TransporterVerificationStatus } from "@prisma/client";
import {
  CreateTransporterProfileData,
  ServiceAreaRecord,
  TransporterProfileRecord,
  UpdateTransporterProfileData,
} from "./transporter.types";

export interface TransporterSearchFilters {
  state?: string;
  district?: string;
  verificationStatus?: TransporterVerificationStatus;
  isActive?: boolean;
  /** Internal transporter ids to restrict the search to (Part N discovery
   * pre-filters by vehicle attributes at the vehicle repository, then this
   * repository applies the transporter-level filters against that set). */
  transporterIds?: string[];
  page: number;
  limit: number;
}

export interface TransporterSearchResult {
  items: TransporterProfileRecord[];
  total: number;
}

/**
 * Data-access boundary for TransporterProfile + its owned service areas.
 * Ownership/authorization is never decided here (see transporter.authorization.ts) —
 * this repository only reads and writes rows.
 */
export interface TransporterRepository {
  findById(id: string): Promise<TransporterProfileRecord | null>;
  findByUserId(userId: string): Promise<TransporterProfileRecord | null>;
  findByPublicId(publicId: string): Promise<TransporterProfileRecord | null>;
  create(data: CreateTransporterProfileData): Promise<TransporterProfileRecord>;
  updateProfile(id: string, data: UpdateTransporterProfileData): Promise<TransporterProfileRecord>;
  updateVerificationStatus(
    id: string,
    status: TransporterVerificationStatus,
  ): Promise<TransporterProfileRecord>;
  search(filters: TransporterSearchFilters): Promise<TransporterSearchResult>;
  countVehicles(transporterId: string): Promise<number>;
  countVehiclesForMany(transporterIds: string[]): Promise<Record<string, number>>;
  listServiceAreas(transporterId: string): Promise<ServiceAreaRecord[]>;
  listServiceAreasForMany(transporterIds: string[]): Promise<Record<string, ServiceAreaRecord[]>>;
}

export class PrismaTransporterRepository implements TransporterRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string) {
    return this.prisma.transporterProfile.findUnique({ where: { id } });
  }

  findByUserId(userId: string) {
    return this.prisma.transporterProfile.findUnique({ where: { userId } });
  }

  findByPublicId(publicId: string) {
    return this.prisma.transporterProfile.findUnique({ where: { publicId } });
  }

  create(data: CreateTransporterProfileData) {
    return this.prisma.transporterProfile.create({
      data: {
        userId: data.userId,
        businessName: data.businessName ?? null,
        contactName: data.contactName ?? null,
        contactPhone: data.contactPhone ?? null,
        contactEmail: data.contactEmail ?? null,
      },
    });
  }

  updateProfile(id: string, data: UpdateTransporterProfileData) {
    return this.prisma.transporterProfile.update({
      where: { id },
      data: {
        ...(data.businessName !== undefined ? { businessName: data.businessName } : {}),
        ...(data.contactName !== undefined ? { contactName: data.contactName } : {}),
        ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone } : {}),
        ...(data.contactEmail !== undefined ? { contactEmail: data.contactEmail } : {}),
      },
    });
  }

  updateVerificationStatus(id: string, status: TransporterVerificationStatus) {
    return this.prisma.transporterProfile.update({ where: { id }, data: { verificationStatus: status } });
  }

  async search(filters: TransporterSearchFilters): Promise<TransporterSearchResult> {
    const where = {
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...(filters.verificationStatus ? { verificationStatus: filters.verificationStatus } : {}),
      ...(filters.transporterIds ? { id: { in: filters.transporterIds } } : {}),
      ...(filters.state || filters.district
        ? {
            serviceAreas: {
              some: {
                ...(filters.state ? { state: { equals: filters.state, mode: "insensitive" as const } } : {}),
                ...(filters.district
                  ? { district: { equals: filters.district, mode: "insensitive" as const } }
                  : {}),
              },
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.transporterProfile.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.transporterProfile.count({ where }),
    ]);

    return { items, total };
  }

  countVehicles(transporterId: string) {
    return this.prisma.vehicle.count({ where: { transporterId } });
  }

  async countVehiclesForMany(transporterIds: string[]): Promise<Record<string, number>> {
    if (transporterIds.length === 0) return {};
    const rows = await this.prisma.vehicle.groupBy({
      by: ["transporterId"],
      where: { transporterId: { in: transporterIds } },
      _count: { _all: true },
    });
    return Object.fromEntries(
      rows.map((r: { transporterId: string; _count: { _all: number } }) => [r.transporterId, r._count._all]),
    );
  }

  listServiceAreas(transporterId: string) {
    return this.prisma.transporterServiceArea.findMany({
      where: { transporterId },
      orderBy: { createdAt: "asc" },
    });
  }

  async listServiceAreasForMany(transporterIds: string[]): Promise<Record<string, ServiceAreaRecord[]>> {
    if (transporterIds.length === 0) return {};
    const rows = await this.prisma.transporterServiceArea.findMany({
      where: { transporterId: { in: transporterIds } },
      orderBy: { createdAt: "asc" },
    });
    const grouped: Record<string, ServiceAreaRecord[]> = {};
    for (const row of rows) {
      (grouped[row.transporterId] ??= []).push(row);
    }
    return grouped;
  }
}
