import { NextFunction, Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { AuthenticationError, AuthorizationError } from "../../common/errors";
import { AuditService } from "../audit/audit.service";
import { AuthRepository } from "./auth.repository";
import { AuthenticatedUserContext } from "./auth.types";
import { verifyAccessToken } from "./auth.utils";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUserContext;
    }
  }
}

const BLOCKED_STATUSES = new Set(["SUSPENDED", "DEACTIVATED"]);

function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

/**
 * Builds the RBAC middleware set against a concrete AuthRepository. The
 * backend is authoritative here: role comes from a verified JWT + a fresh
 * account-status check, never from anything the client asserts about
 * itself (headers, body, query params).
 */
export function createAuthMiddleware(repo: AuthRepository, audit?: AuditService) {
  async function authenticate(req: Request, _res: Response, next: NextFunction) {
    try {
      const token = extractBearerToken(req);
      if (!token) {
        throw new AuthenticationError("Authentication is required.");
      }

      let payload;
      try {
        payload = verifyAccessToken(token);
      } catch {
        throw new AuthenticationError("Your session has expired. Please log in again.");
      }

      const user = await repo.findUserById(payload.sub);
      if (!user) {
        throw new AuthenticationError("Your session is no longer valid. Please log in again.");
      }
      if (BLOCKED_STATUSES.has(user.accountStatus)) {
        throw new AuthenticationError(
          user.accountStatus === "DEACTIVATED"
            ? "This account has been deactivated."
            : "This account is suspended. Please contact support.",
        );
      }

      // Only the minimal, non-sensitive identity is attached downstream.
      req.user = { id: user.id, publicId: user.publicId, role: user.role };
      next();
    } catch (err) {
      next(err);
    }
  }

  function requireRole(role: UserRole) {
    return requireAnyRole(role);
  }

  function requireAnyRole(...roles: UserRole[]) {
    const allowed = new Set(roles);
    return (req: Request, _res: Response, next: NextFunction) => {
      if (!req.user) {
        return next(new AuthenticationError("Authentication is required."));
      }
      if (!allowed.has(req.user.role)) {
        if (audit) {
          audit
            .record({
              actorUserId: req.user.id,
              action: "AUTHORIZATION_DENIED",
              entityType: "Route",
              entityId: req.originalUrl,
              metadata: { requiredRoles: [...allowed], actualRole: req.user.role },
              ...requestMeta(req),
            })
            .catch(() => {
              /* never let audit logging break the request */
            });
        }
        return next(new AuthorizationError());
      }
      next();
    };
  }

  return { authenticate, requireRole, requireAnyRole };
}
