import { FpoMembership, MembershipStatus } from "@prisma/client";
import { MemberDirectoryRow } from "./membership.repository";
import { FpoPublicDTO } from "./fpo.types";

export interface MembershipDTO {
  publicId: string;
  status: MembershipStatus;
  requestedAt: string;
  joinedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  removedAt: string | null;
  // Plain reason string only (build spec section 18: "do not expose
  // internal administrative notes unnecessarily") — never a free-form
  // internal notes object.
  rejectionReason: string | null;
}

export function toMembershipDTO(m: FpoMembership): MembershipDTO {
  return {
    publicId: m.publicId,
    status: m.status,
    requestedAt: m.requestedAt.toISOString(),
    joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
    approvedAt: m.approvedAt ? m.approvedAt.toISOString() : null,
    rejectedAt: m.rejectedAt ? m.rejectedAt.toISOString() : null,
    removedAt: m.removedAt ? m.removedAt.toISOString() : null,
    rejectionReason: m.rejectionReason,
  };
}

/**
 * GET /api/farmers/me/fpo response shape — build spec section 21: "current
 * active FPO, membership status, joined date, FPO public information ...
 * if no FPO, return a valid empty state."
 */
export interface MyFpoDTO {
  hasFpo: boolean;
  membership: MembershipDTO | null;
  fpo: FpoPublicDTO | null;
}

/**
 * The FPO member directory row (build spec section 26): only what a
 * directory needs to display, never password/auth internals, exact farm
 * coordinates, or private verification information.
 */
export interface MemberDirectoryEntryDTO {
  farmerPublicId: string;
  name: string | null;
  village: string | null;
  district: string | null;
  status: MembershipStatus;
  joinedAt: string | null;
  primaryCrop: string | null;
}

export function toMemberDirectoryEntryDTO(row: MemberDirectoryRow): MemberDirectoryEntryDTO {
  const firstFarm = row.farmer.farms[0];
  const primary = row.farmer.farmerCrops.find((c) => c.isPrimary) ?? row.farmer.farmerCrops[0];
  return {
    farmerPublicId: row.farmer.user.publicId,
    name: row.farmer.user.fullName,
    village: firstFarm?.village ?? null,
    district: firstFarm?.district?.name ?? null,
    status: row.status,
    joinedAt: row.joinedAt ? row.joinedAt.toISOString() : null,
    primaryCrop: primary?.crop?.name ?? null,
  };
}
