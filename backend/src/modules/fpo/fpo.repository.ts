import { FpoAccountStatus, FpoVerificationStatus, PrismaClient } from "@prisma/client";
import { CreateFpoData, FpoWithLocation, UpdateFpoStatusData } from "./fpo.types";

const LOCATION_INCLUDE = { state: true, district: true, taluka: true } as const;

export interface FpoSearchFilters {
  name?: string;
  stateId?: string;
  districtId?: string;
  /** Free-text state/district name match — build spec section 22's example
   * (`GET /api/fpos?district=Nashik`) filters by name, not id. */
  stateName?: string;
  districtName?: string;
  verificationStatus?: FpoVerificationStatus;
  accountStatus?: FpoAccountStatus;
  page: number;
  limit: number;
}

export interface FpoSearchResult {
  items: FpoWithLocation[];
  total: number;
}

/**
 * Data-access boundary for the FPO record itself. Ownership/authorization
 * (is this caller allowed to manage this FPO?) is never decided here — see
 * fpo.authorization.ts — this repository only reads and writes rows.
 */
export interface FpoRepository {
  findById(id: string): Promise<FpoWithLocation | null>;
  findByPublicId(publicId: string): Promise<FpoWithLocation | null>;
  search(filters: FpoSearchFilters): Promise<FpoSearchResult>;
  /** Lightweight read for the read-only government summary (build spec
   * section 42) — just enough to count FPOs per district without pulling
   * every full FPO row. */
  listAllForSummary(): Promise<{ id: string; districtName: string }[]>;
  create(data: CreateFpoData): Promise<FpoWithLocation>;
  updateStatus(id: string, data: UpdateFpoStatusData): Promise<FpoWithLocation>;
}

export class PrismaFpoRepository implements FpoRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string) {
    return this.prisma.fpo.findUnique({ where: { id }, include: LOCATION_INCLUDE });
  }

  findByPublicId(publicId: string) {
    return this.prisma.fpo.findUnique({ where: { publicId }, include: LOCATION_INCLUDE });
  }

  async search(filters: FpoSearchFilters) {
    const where = {
      ...(filters.name ? { name: { contains: filters.name, mode: "insensitive" as const } } : {}),
      ...(filters.stateId ? { stateId: filters.stateId } : {}),
      ...(filters.districtId ? { districtId: filters.districtId } : {}),
      ...(filters.stateName ? { state: { name: { contains: filters.stateName, mode: "insensitive" as const } } } : {}),
      ...(filters.districtName
        ? { district: { name: { contains: filters.districtName, mode: "insensitive" as const } } }
        : {}),
      ...(filters.verificationStatus ? { verificationStatus: filters.verificationStatus } : {}),
      ...(filters.accountStatus ? { accountStatus: filters.accountStatus } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.fpo.findMany({
        where,
        include: LOCATION_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.fpo.count({ where }),
    ]);

    return { items, total };
  }

  async listAllForSummary() {
    const rows = await this.prisma.fpo.findMany({ select: { id: true, district: { select: { name: true } } } });
    return rows.map((r) => ({ id: r.id, districtName: r.district.name }));
  }

  create(data: CreateFpoData) {
    return this.prisma.fpo.create({
      data: {
        name: data.name,
        legalName: data.legalName ?? null,
        registrationNumber: data.registrationNumber ?? null,
        organizationType: data.organizationType,
        phone: data.phone ?? null,
        email: data.email ?? null,
        village: data.village ?? null,
        pincode: data.pincode ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        stateId: data.stateId,
        districtId: data.districtId,
        talukaId: data.talukaId ?? null,
        verificationStatus: "PENDING",
        accountStatus: "ACTIVE",
        active: true,
      },
      include: LOCATION_INCLUDE,
    });
  }

  updateStatus(id: string, data: UpdateFpoStatusData) {
    return this.prisma.fpo.update({
      where: { id },
      data: {
        ...(data.verificationStatus !== undefined ? { verificationStatus: data.verificationStatus } : {}),
        ...(data.accountStatus !== undefined ? { accountStatus: data.accountStatus } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
      include: LOCATION_INCLUDE,
    });
  }
}
