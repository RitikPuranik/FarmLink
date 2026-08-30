import { randomUUID } from "crypto";
import type { CreateFpoAdminData, FpoAdminRepository } from "../../src/modules/fpo/fpo-admin.repository";

export interface FakeFpoAdmin {
  id: string;
  fpoId: string;
  userId: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export class InMemoryFpoAdminRepository implements FpoAdminRepository {
  admins: FakeFpoAdmin[] = [];

  async findActiveByUserAndFpo(userId: string, fpoId: string) {
    return (this.admins.find((a) => a.userId === userId && a.fpoId === fpoId && a.status === "ACTIVE") as never) ?? null;
  }

  async findByFpoAndUser(fpoId: string, userId: string) {
    return (this.admins.find((a) => a.fpoId === fpoId && a.userId === userId) as never) ?? null;
  }

  async findById(id: string) {
    return (this.admins.find((a) => a.id === id) as never) ?? null;
  }

  async listByFpoId(fpoId: string) {
    return this.admins
      .filter((a) => a.fpoId === fpoId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) as never;
  }

  async create(data: CreateFpoAdminData) {
    const now = new Date();
    const admin: FakeFpoAdmin = {
      id: randomUUID(),
      fpoId: data.fpoId,
      userId: data.userId,
      role: data.role,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
    this.admins.push(admin);
    return admin as never;
  }

  async setStatus(id: string, status: "ACTIVE" | "INACTIVE") {
    const admin = this.admins.find((a) => a.id === id);
    if (!admin) throw new Error(`FpoAdmin ${id} not found`);
    admin.status = status;
    admin.updatedAt = new Date();
    return admin as never;
  }
}
