import { ServiceAreaType, TransporterVerificationStatus } from "@prisma/client";

/** Internal shape returned by TransporterRepository — never returned
 * directly from a controller (see toTransporterPublicDTO/toTransporterAdminViewDTO). */
export interface TransporterProfileRecord {
  id: string;
  publicId: string;
  userId: string;
  businessName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  verificationStatus: TransporterVerificationStatus;
  phoneVerified: boolean;
  isActive: boolean;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTransporterProfileData {
  userId: string;
  businessName?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export interface UpdateTransporterProfileData {
  businessName?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export interface ServiceAreaRecord {
  id: string;
  transporterId: string;
  areaType: ServiceAreaType;
  state: string | null;
  district: string | null;
  city: string | null;
  pincode: string | null;
  createdAt: Date;
}

export interface CreateServiceAreaData {
  transporterId: string;
  areaType: ServiceAreaType;
  state?: string | null;
  district?: string | null;
  city?: string | null;
  pincode?: string | null;
}

/**
 * Part S — Transporter DTO. Every field here is safe to show to anyone
 * (another farmer/buyer browsing discovery, not just the owning
 * transporter or an admin) — business contact info, not personal driver
 * PII, which never appears on any Transporter-level DTO.
 */
export interface TransporterPublicDTO {
  transporterId: string;
  businessName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  verificationStatus: TransporterVerificationStatus;
  isActive: boolean;
  serviceAreas: ServiceAreaDTO[];
  vehicleCount: number;
  createdAt: string;
}

/** Adds internal-only fields an admin (or the owning transporter, for
 * their own /me response) may see but that a public discovery listing
 * should not surface. */
export interface TransporterAdminViewDTO extends TransporterPublicDTO {
  userId: string;
  phoneVerified: boolean;
  updatedAt: string;
}

export interface ServiceAreaDTO {
  id: string;
  areaType: ServiceAreaType;
  state: string | null;
  district: string | null;
  city: string | null;
  pincode: string | null;
  createdAt: string;
}

export function toServiceAreaDTO(row: ServiceAreaRecord): ServiceAreaDTO {
  return {
    id: row.id,
    areaType: row.areaType,
    state: row.state,
    district: row.district,
    city: row.city,
    pincode: row.pincode,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toTransporterPublicDTO(
  row: TransporterProfileRecord,
  serviceAreas: ServiceAreaRecord[],
  vehicleCount: number,
): TransporterPublicDTO {
  return {
    transporterId: row.publicId,
    businessName: row.businessName,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    verificationStatus: row.verificationStatus,
    isActive: row.isActive,
    serviceAreas: serviceAreas.map(toServiceAreaDTO),
    vehicleCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toTransporterAdminViewDTO(
  row: TransporterProfileRecord,
  serviceAreas: ServiceAreaRecord[],
  vehicleCount: number,
): TransporterAdminViewDTO {
  return {
    ...toTransporterPublicDTO(row, serviceAreas, vehicleCount),
    userId: row.userId,
    phoneVerified: row.phoneVerified,
    updatedAt: row.updatedAt.toISOString(),
  };
}
