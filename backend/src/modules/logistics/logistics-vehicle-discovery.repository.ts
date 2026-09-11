import { PrismaClient, TransporterVerificationStatus, VehicleStatus, VehicleVerificationStatus } from "@prisma/client";

/**
 * Step 7/22 — a read-only query surface over Module 15's own Vehicle /
 * TransporterProfile tables, used only to enumerate *candidate* vehicles
 * for a logistics request's "available providers" listing. This does not
 * duplicate Module 15's models or its own repositories (VehicleRepository/
 * TransporterRepository already own writes and per-owner reads) — it is
 * the same "thin wrapper over deps.prisma for a cross-module read" pattern
 * MarketIntelligenceRepository/BuyerMatchingService already use elsewhere
 * in this codebase for read-only queries that span module boundaries.
 */

export interface VehicleCandidateRow {
  vehicleId: string;
  vehiclePublicId: string;
  vehicleType: string;
  capacityKg: number;
  capabilities: string[];
  isRefrigerated: boolean;
  status: string;
  verificationStatus: string;
  availabilityStatus: string;
  transporterId: string;
  transporterPublicId: string;
  transporterIsActive: boolean;
  transporterVerificationStatus: string;
  transporterBusinessName: string | null;
}

export interface CandidateFilters {
  minimumCapacityKg: number;
}

export class LogisticsVehicleDiscoveryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * A deliberately loose DB-level filter (capacity floor only, plus a
   * bounded row cap) — every finer-grained rule (refrigeration, specific
   * capability list, verification, exact conflict windows) is evaluated
   * afterward by VehicleEligibilityService so every rejection reason is
   * explicit and explainable (Step 5), rather than silently filtered out
   * of the SQL where clause.
   */
  async findCandidates(filters: CandidateFilters): Promise<VehicleCandidateRow[]> {
    const rows = await this.prisma.vehicle.findMany({
      where: { capacityKg: { gte: filters.minimumCapacityKg } },
      include: { transporter: true },
      take: 200,
      orderBy: { capacityKg: "asc" },
    });

    return rows.map((row: {
      id: string;
      publicId: string;
      vehicleType: VehicleStatus | string;
      capacityKg: unknown;
      capabilities: string[];
      isRefrigerated: boolean;
      status: VehicleStatus;
      verificationStatus: VehicleVerificationStatus;
      availabilityStatus: string;
      transporterId: string;
      transporter: {
        publicId: string;
        isActive: boolean;
        verificationStatus: TransporterVerificationStatus;
        businessName: string | null;
      };
    }) => ({
      vehicleId: row.id,
      vehiclePublicId: row.publicId,
      vehicleType: String(row.vehicleType),
      capacityKg: typeof row.capacityKg === "number" ? row.capacityKg : Number(row.capacityKg),
      capabilities: row.capabilities,
      isRefrigerated: row.isRefrigerated,
      status: row.status,
      verificationStatus: row.verificationStatus,
      availabilityStatus: row.availabilityStatus,
      transporterId: row.transporterId,
      transporterPublicId: row.transporter.publicId,
      transporterIsActive: row.transporter.isActive,
      transporterVerificationStatus: row.transporter.verificationStatus,
      transporterBusinessName: row.transporter.businessName,
    }));
  }
}
