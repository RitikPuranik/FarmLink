import { AccountStatus, Language, UserRole, VerificationStatus } from "@prisma/client";

/** Sanitized identity attached to req.user by the authenticate() middleware. */
export interface AuthenticatedUserContext {
  id: string;
  publicId: string;
  role: UserRole;
}

/** Full sanitized user shape returned from GET /api/auth/me and similar. */
export interface PublicUserDTO {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
  preferredLanguage: Language;
  verification: {
    phone: VerificationStatus;
    email: VerificationStatus;
    identity: VerificationStatus;
  };
}

export interface RegisterInput {
  fullName: string;
  mobile: string;
  email?: string;
  password: string;
  preferredLanguage: Language;
}

export interface LoginInput {
  mobile: string;
  password: string;
}

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/** The roles the public registration endpoint is ever allowed to assign. */
export const PUBLIC_REGISTRATION_ROLE: UserRole = "FARMER";

/** Roles that must never be assignable through self-service endpoints. */
export const PRIVILEGED_ROLES: UserRole[] = [
  "ADMIN",
  "GOVERNMENT_VIEWER",
  "FPO_ADMIN",
  "BUYER",
  "TRANSPORTER",
  "WAREHOUSE_OPERATOR",
];
