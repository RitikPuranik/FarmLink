import { UserRole } from "@prisma/client";

/**
 * Single source of truth for "who can do what" at a glance. This does not
 * execute anything by itself — routes still enforce access via
 * authenticate()/requireRole()/requireAnyRole() — but keeping the policy
 * documented in one place (instead of scattered across controllers) is what
 * lets a reviewer answer "can a BUYER hit this?" without grepping the whole
 * codebase, and gives future modules a place to extend the table instead of
 * inventing their own convention.
 */
export const AUTHORIZATION_POLICY: Record<UserRole, { allow: string[]; deny: string[] }> = {
  FARMER: {
    allow: ["GET /api/auth/me", "POST /api/auth/logout", "future farmer endpoints"],
    deny: ["/api/admin/*", "self role modification", "verification approval"],
  },
  FPO_ADMIN: {
    allow: ["future FPO management endpoints"],
    deny: ["/api/admin/*"],
  },
  BUYER: {
    allow: ["future buyer endpoints"],
    deny: ["/api/admin/*"],
  },
  TRANSPORTER: {
    allow: ["future transporter endpoints"],
    deny: ["/api/admin/*"],
  },
  WAREHOUSE_OPERATOR: {
    allow: ["future warehouse endpoints"],
    deny: ["/api/admin/*"],
  },
  ADMIN: {
    allow: ["/api/admin/*", "verification management", "user management"],
    deny: [],
  },
  GOVERNMENT_VIEWER: {
    allow: ["authorized read-only dashboards later"],
    deny: ["user mutation", "verification mutation"],
  },
};
