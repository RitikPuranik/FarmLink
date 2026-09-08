import { PrismaClient } from "@prisma/client";
import { CreateServiceAreaData, ServiceAreaRecord } from "./transporter.types";

/**
 * Data-access boundary for TransporterServiceArea. Duplicate-prevention and
 * hierarchy validation (Part F/Q) happen in the service layer — this
 * repository only performs bounded reads/writes.
 */
export interface TransporterServiceAreaRepository {
  create(data: CreateServiceAreaData): Promise<ServiceAreaRecord>;
  findById(id: string): Promise<ServiceAreaRecord | null>;
  listByTransporter(transporterId: string): Promise<ServiceAreaRecord[]>;
  remove(id: string): Promise<void>;
}

export class PrismaTransporterServiceAreaRepository implements TransporterServiceAreaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(data: CreateServiceAreaData) {
    return this.prisma.transporterServiceArea.create({
      data: {
        transporterId: data.transporterId,
        areaType: data.areaType,
        state: data.state ?? null,
        district: data.district ?? null,
        city: data.city ?? null,
        pincode: data.pincode ?? null,
      },
    });
  }

  findById(id: string) {
    return this.prisma.transporterServiceArea.findUnique({ where: { id } });
  }

  listByTransporter(transporterId: string) {
    return this.prisma.transporterServiceArea.findMany({
      where: { transporterId },
      orderBy: { createdAt: "asc" },
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.transporterServiceArea.delete({ where: { id } });
  }
}
