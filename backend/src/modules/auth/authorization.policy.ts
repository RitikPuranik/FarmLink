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
    allow: ["FPO-scoped endpoints under /api/fpos/:fpoId/* where an active FpoAdmin row exists for that FPO (see modules/fpo/fpo.authorization.ts) — role alone is never sufficient"],
    deny: ["/api/admin/*", "any other FPO's data"],
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
    allow: ["authorized read-only dashboards later", "GET /api/government/fpo-summary (aggregate only, no individual farmer records)"],
    deny: ["user mutation", "verification mutation", "any FPO/membership/aggregation write"],
  },
};
