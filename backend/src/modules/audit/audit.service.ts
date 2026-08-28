import { PrismaClient } from "@prisma/client";

export type AuditAction =
  | "USER_REGISTERED"
  | "USER_LOGIN"
  | "USER_LOGIN_FAILED"
  | "USER_LOGOUT"
  | "USER_LOGOUT_ALL"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_COMPLETED"
  | "ACCOUNT_SUSPENDED"
  | "ACCOUNT_REACTIVATED"
  | "ROLE_CHANGED"
  | "VERIFICATION_CHANGED"
  | "AUTHORIZATION_DENIED"
  // Module 2 — Farmer & Farm Profile Management
  | "FARMER_PROFILE_CREATED"
  | "FARMER_PROFILE_UPDATED"
  | "FARM_CREATED"
  | "FARM_UPDATED"
  | "FARM_DELETED"
  | "CROP_ADDED"
  | "CROP_UPDATED"
  | "CROP_REMOVED"
  | "FPO_ASSOCIATED"
  | "PREFERENCE_UPDATED";

export interface AuditEvent {
  actorUserId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditService {
  record(event: AuditEvent): Promise<void>;
}

// Metadata is logged for operational visibility, so we defensively strip
// anything that looks like a secret even though callers shouldn't pass one.
const FORBIDDEN_METADATA_KEYS = new Set([
  "password",
  "passwordHash",
  "otp",
  "token",
  "tokenHash",
  "refreshToken",
  "accessToken",
  "jwtSecret",
]);

function sanitizeMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return undefined;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !FORBIDDEN_METADATA_KEYS.has(key)));
}

export class PrismaAuditService implements AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(event: AuditEvent): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: event.actorUserId ?? null,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        metadata: sanitizeMetadata(event.metadata),
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
      },
    });
  }
}
