import { randomUUID } from "crypto";
import type { CreateFpoData, FpoRepository, FpoSearchFilters, UpdateFpoStatusData } from "../../src/modules/fpo/fpo.repository";
import { InMemoryReferenceDataRepository } from "./inMemoryReferenceDataRepository";

export interface FakeFpo {
  id: string;
  publicId: string;
  name: string;
  legalName: string | null;
  registrationNumber: string | null;
  organizationType: string;
  phone: string | null;
  email: string | null;
  village: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  stateId: string;
  districtId: string;
  talukaId: string | null;
  verificationStatus: string;
  accountStatus: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Mirrors InMemoryFarmsRepository's pattern (build spec section 20 —
 * mimics Prisma's `include: {state, district, taluka}` by joining against
 * the shared in-memory reference-data fixtures). This is a deliberately
 * separate fixture set from InMemoryReferenceDataRepository.fpos (Module
 * 2's own minimal FPO list) — see that file's comment for why the two are
 * not unified in tests. */
export class InMemoryFpoRepository implements FpoRepository {
  fpos: FakeFpo[] = [];

  constructor(private readonly referenceData: InMemoryReferenceDataRepository) {}

  private withLocation(fpo: FakeFpo) {
    const state = this.referenceData.states.find((s) => s.id === fpo.stateId);
    const district = this.referenceData.districts.find((d) => d.id === fpo.districtId);
    const taluka = fpo.talukaId ? (this.referenceData.talukas.find((t) => t.id === fpo.talukaId) ?? null) : null;
    return { ...fpo, state, district, taluka } as never;
  }

  async findById(id: string) {
    const fpo = this.fpos.find((f) => f.id === id);
    return fpo ? this.withLocation(fpo) : null;
  }

  async findByPublicId(publicId: string) {
    const fpo = this.fpos.find((f) => f.publicId === publicId);
    return fpo ? this.withLocation(fpo) : null;
  }

  async search(filters: FpoSearchFilters) {
    let matches = this.fpos.slice();
    if (filters.name) {
      const needle = filters.name.toLowerCase();
      matches = matches.filter((f) => f.name.toLowerCase().includes(needle));
    }
    if (filters.stateId) matches = matches.filter((f) => f.stateId === filters.stateId);
    if (filters.districtId) matches = matches.filter((f) => f.districtId === filters.districtId);
    if (filters.stateName) {
      const needle = filters.stateName.toLowerCase();
      matches = matches.filter((f) => {
        const state = this.referenceData.states.find((s) => s.id === f.stateId);
        return state?.name.toLowerCase().includes(needle);
      });
    }
    if (filters.districtName) {
      const needle = filters.districtName.toLowerCase();
      matches = matches.filter((f) => {
        const district = this.referenceData.districts.find((d) => d.id === f.districtId);
        return district?.name.toLowerCase().includes(needle);
      });
    }
    if (filters.verificationStatus) matches = matches.filter((f) => f.verificationStatus === filters.verificationStatus);
    if (filters.accountStatus) matches = matches.filter((f) => f.accountStatus === filters.accountStatus);

    matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = matches.length;
    const start = (filters.page - 1) * filters.limit;
    const page = matches.slice(start, start + filters.limit);
    return { items: page.map((f) => this.withLocation(f)), total };
  }

  async listAllForSummary() {
    return this.fpos.map((f) => ({
      id: f.id,
      districtName: this.referenceData.districts.find((d) => d.id === f.districtId)?.name ?? "Unknown",
    }));
  }

  async create(data: CreateFpoData) {
    const now = new Date();
    const fpo: FakeFpo = {
      id: randomUUID(),
      publicId: randomUUID(),
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
      createdAt: now,
      updatedAt: now,
    };
    this.fpos.push(fpo);
    return this.withLocation(fpo);
  }

  async updateStatus(id: string, data: UpdateFpoStatusData) {
    const fpo = this.fpos.find((f) => f.id === id);
    if (!fpo) throw new Error(`Fpo ${id} not found`);
    if (data.verificationStatus !== undefined) fpo.verificationStatus = data.verificationStatus;
    if (data.accountStatus !== undefined) fpo.accountStatus = data.accountStatus;
    if (data.active !== undefined) fpo.active = data.active;
    fpo.updatedAt = new Date();
    return this.withLocation(fpo);
  }
}
