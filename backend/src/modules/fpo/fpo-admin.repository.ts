import { FpoAdmin, FpoAdminRole, PrismaClient } from "@prisma/client";

export interface CreateFpoAdminData {
  fpoId: string;
  userId: string;
  role: FpoAdminRole;
}

/**
 * Data-access boundary for "who administers which FPO". This table is the
 * single source of truth build spec section 12/54 rely on: an FPO_ADMIN
 * User.role is never, on its own, sufficient to manage a specific FPO —
 * every FPO-scoped admin action must find an ACTIVE row here for
 * (userId, fpoId). See fpo.authorization.ts.
 */
export interface FpoAdminRepository {
  /** The one lookup every ownership check goes through. */
  findActiveByUserAndFpo(userId: string, fpoId: string): Promise<FpoAdmin | null>;
  findByFpoAndUser(fpoId: string, userId: string): Promise<FpoAdmin | null>;
  findById(id: string): Promise<FpoAdmin | null>;
  listByFpoId(fpoId: string): Promise<FpoAdmin[]>;
  create(data: CreateFpoAdminData): Promise<FpoAdmin>;
  setStatus(id: string, status: "ACTIVE" | "INACTIVE"): Promise<FpoAdmin>;
}

export class PrismaFpoAdminRepository implements FpoAdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findActiveByUserAndFpo(userId: string, fpoId: string) {
    return this.prisma.fpoAdmin.findFirst({ where: { userId, fpoId, status: "ACTIVE" } });
  }

  findByFpoAndUser(fpoId: string, userId: string) {
    return this.prisma.fpoAdmin.findUnique({ where: { fpoId_userId: { fpoId, userId } } });
  }

  findById(id: string) {
    return this.prisma.fpoAdmin.findUnique({ where: { id } });
  }

  listByFpoId(fpoId: string) {
    return this.prisma.fpoAdmin.findMany({ where: { fpoId }, orderBy: { createdAt: "asc" } });
  }

  create(data: CreateFpoAdminData) {
    return this.prisma.fpoAdmin.create({
      data: { fpoId: data.fpoId, userId: data.userId, role: data.role, status: "ACTIVE" },
    });
  }

  setStatus(id: string, status: "ACTIVE" | "INACTIVE") {
    return this.prisma.fpoAdmin.update({ where: { id }, data: { status } });
  }
}
