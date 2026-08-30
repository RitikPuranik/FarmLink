import {
  District,
  Fpo,
  FpoAccountStatus,
  FpoAdmin,
  FpoAdminRole,
  FpoAdminStatus,
  FpoOrganizationType,
  FpoVerificationStatus,
  State,
  Taluka,
} from "@prisma/client";

export type FpoWithLocation = Fpo & { state: State; district: District; taluka: Taluka | null };

export interface CreateFpoData {
  name: string;
  legalName?: string | null;
  registrationNumber?: string | null;
  organizationType: FpoOrganizationType;
  phone?: string | null;
  email?: string | null;
  village?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  stateId: string;
  districtId: string;
  talukaId?: string | null;
}

export interface UpdateFpoStatusData {
  verificationStatus?: FpoVerificationStatus;
  accountStatus?: FpoAccountStatus;
  // Kept in lockstep with accountStatus by the service layer — see the
  // `active` field's comment in schema.prisma.
  active?: boolean;
}

/**
 * The address/contact/registration shape any authenticated caller may see —
 * used for both search results and the details endpoint. Deliberately
 * excludes: internal id (publicId is the external handle), precise lat/
 * long ("private operational coordinates", build spec section 24),
 * registrationNumber (a would-be identity document number, not needed for
 * public discovery), and anything about who administers the FPO.
 */
export interface FpoPublicDTO {
  publicId: string;
  name: string;
  organizationType: FpoOrganizationType;
  village: string | null;
  district: { id: string; name: string };
  state: { id: string; name: string };
  verificationStatus: FpoVerificationStatus;
  phone: string | null;
  email: string | null;
  memberCount: number;
  createdAt: string;
}

/**
 * The fuller shape an FPO's own admin (or a platform ADMIN) sees — adds
 * account/registration internals that are meaningless or sensitive to a
 * farmer browsing FPOs.
 */
export interface FpoAdminViewDTO extends FpoPublicDTO {
  legalName: string | null;
  registrationNumber: string | null;
  accountStatus: FpoAccountStatus;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  taluka: { id: string; name: string } | null;
  updatedAt: string;
}

export function toFpoPublicDTO(fpo: FpoWithLocation, memberCount: number): FpoPublicDTO {
  return {
    publicId: fpo.publicId,
    name: fpo.name,
    organizationType: fpo.organizationType,
    village: fpo.village,
    district: { id: fpo.district.id, name: fpo.district.name },
    state: { id: fpo.state.id, name: fpo.state.name },
    verificationStatus: fpo.verificationStatus,
    phone: fpo.phone,
    email: fpo.email,
    memberCount,
    createdAt: fpo.createdAt.toISOString(),
  };
}

export function toFpoAdminViewDTO(fpo: FpoWithLocation, memberCount: number): FpoAdminViewDTO {
  return {
    ...toFpoPublicDTO(fpo, memberCount),
    legalName: fpo.legalName,
    registrationNumber: fpo.registrationNumber,
    accountStatus: fpo.accountStatus,
    pincode: fpo.pincode,
    latitude: fpo.latitude,
    longitude: fpo.longitude,
    taluka: fpo.taluka ? { id: fpo.taluka.id, name: fpo.taluka.name } : null,
    updatedAt: fpo.updatedAt.toISOString(),
  };
}

export interface FpoAdminDTO {
  id: string;
  userId: string;
  role: FpoAdminRole;
  status: FpoAdminStatus;
  createdAt: string;
}

export function toFpoAdminDTO(admin: FpoAdmin): FpoAdminDTO {
  return {
    id: admin.id,
    userId: admin.userId,
    role: admin.role,
    status: admin.status,
    createdAt: admin.createdAt.toISOString(),
  };
}
