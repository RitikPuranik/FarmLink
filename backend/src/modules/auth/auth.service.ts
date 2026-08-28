import { User } from "@prisma/client";
import {
  AuthenticationError,
  ConflictError,
  InvalidCredentialsError,
  ValidationError,
} from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuditService } from "../audit/audit.service";
import { AuthRepository } from "./auth.repository";
import {
  AuthTokens,
  AuthenticatedUserContext,
  LoginInput,
  PublicUserDTO,
  RegisterInput,
  RequestMeta,
} from "./auth.types";
import {
  generateSecureToken,
  hashPassword,
  hashToken,
  refreshTokenExpiryDate,
  signAccessToken,
  verifyPassword,
} from "./auth.utils";

const BLOCKED_LOGIN_STATUSES = new Set(["SUSPENDED", "DEACTIVATED"]);

function toPublicUserDTO(user: User): PublicUserDTO {
  return {
    id: user.publicId,
    fullName: user.fullName,
    mobile: user.mobile,
    email: user.email,
    role: user.role,
    accountStatus: user.accountStatus,
    preferredLanguage: user.preferredLanguage,
    verification: {
      phone: user.phoneVerificationStatus,
      email: user.emailVerificationStatus,
      identity: user.identityVerificationStatus,
    },
  };
}

function toAuthContext(user: User): AuthenticatedUserContext {
  return { id: user.id, publicId: user.publicId, role: user.role };
}

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterInput, meta: RequestMeta): Promise<{ user: PublicUserDTO }> {
    const existingByMobile = await this.repo.findUserByMobile(input.mobile);
    if (existingByMobile) {
      throw new ConflictError("This mobile number is already registered.", {
        mobile: "This mobile number is already registered.",
      });
    }

    if (input.email) {
      const existingByEmail = await this.repo.findUserByEmail(input.email);
      if (existingByEmail) {
        throw new ConflictError("This email is already registered.", {
          email: "This email is already registered.",
        });
      }
    }

    const passwordHash = await hashPassword(input.password);

    // role is deliberately hard-coded here — never taken from the caller.
    // See auth.schemas.ts (registerRequestSchema.strict()) for the first
    // line of defense against a client-supplied role.
    const user = await this.repo.createUser({
      fullName: input.fullName,
      mobile: input.mobile,
      email: input.email,
      passwordHash,
      role: "FARMER",
      preferredLanguage: input.preferredLanguage,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "USER_REGISTERED",
      entityType: "User",
      entityId: user.id,
      metadata: { role: user.role },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("signup_completed", user.publicId, { role: user.role });

    return { user: toPublicUserDTO(user) };
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<{ user: PublicUserDTO; tokens: AuthTokens }> {
    const user = await this.repo.findUserByMobile(input.mobile);

    if (!user) {
      trackEvent("login_failed", "anonymous", { reason: "no_account" });
      throw new InvalidCredentialsError();
    }

    const passwordValid = await verifyPassword(user.passwordHash, input.password);
    if (!passwordValid) {
      await this.audit.record({
        actorUserId: user.id,
        action: "USER_LOGIN_FAILED",
        entityType: "User",
        entityId: user.id,
        metadata: { reason: "bad_password" },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      trackEvent("login_failed", user.publicId, { reason: "bad_password" });
      throw new InvalidCredentialsError();
    }

    if (BLOCKED_LOGIN_STATUSES.has(user.accountStatus)) {
      await this.audit.record({
        actorUserId: user.id,
        action: "USER_LOGIN_FAILED",
        entityType: "User",
        entityId: user.id,
        metadata: { reason: "account_status", accountStatus: user.accountStatus },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      trackEvent("login_failed", user.publicId, { reason: "account_status" });
      throw new AuthenticationError(
        user.accountStatus === "DEACTIVATED"
          ? "This account has been deactivated."
          : "This account is suspended. Please contact support.",
      );
    }

    const tokens = await this.issueSession(user, meta);

    await this.repo.updateLastLogin(user.id);
    await this.audit.record({
      actorUserId: user.id,
      action: "USER_LOGIN",
      entityType: "User",
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("login_success", user.publicId, { role: user.role });

    return { user: toPublicUserDTO(user), tokens };
  }

  private async issueSession(user: User, meta: RequestMeta): Promise<AuthTokens> {
    const rawRefreshToken = generateSecureToken();
    const refreshTokenExpiresAt = refreshTokenExpiryDate();

    await this.repo.createSession({
      userId: user.id,
      tokenHash: hashToken(rawRefreshToken),
      expiresAt: refreshTokenExpiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });

    const accessToken = signAccessToken(toAuthContext(user));
    return { accessToken, refreshToken: rawRefreshToken, refreshTokenExpiresAt };
  }

  async refreshSession(
    rawRefreshToken: string,
    meta: RequestMeta,
  ): Promise<{ user: PublicUserDTO; tokens: AuthTokens }> {
    const tokenHash = hashToken(rawRefreshToken);
    const session = await this.repo.findSessionByTokenHash(tokenHash);

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new AuthenticationError("Your session has expired. Please log in again.");
    }

    const user = await this.repo.findUserById(session.userId);
    if (!user || BLOCKED_LOGIN_STATUSES.has(user.accountStatus)) {
      await this.repo.revokeSession(session.id);
      throw new AuthenticationError("Your session is no longer valid. Please log in again.");
    }

    // Rotate: invalidate the used refresh token and issue a fresh one. This
    // limits the blast radius if a refresh token is ever stolen.
    await this.repo.revokeSession(session.id);
    const tokens = await this.issueSession(user, meta);

    return { user: toPublicUserDTO(user), tokens };
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return; // idempotent — nothing to revoke
    await this.repo.revokeSessionByTokenHash(hashToken(rawRefreshToken));
  }

  async logoutAll(userId: string, meta: RequestMeta): Promise<void> {
    await this.repo.revokeAllSessions(userId);
    await this.audit.record({
      actorUserId: userId,
      action: "USER_LOGOUT_ALL",
      entityType: "User",
      entityId: userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  async getCurrentUser(userId: string): Promise<PublicUserDTO> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw new AuthenticationError("Your session is no longer valid. Please log in again.");
    }
    return toPublicUserDTO(user);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionTokenHash: string | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw new AuthenticationError("Your session is no longer valid. Please log in again.");
    }

    const currentValid = await verifyPassword(user.passwordHash, currentPassword);
    if (!currentValid) {
      throw new ValidationError("Please correct the highlighted fields", {
        currentPassword: "Current password is incorrect.",
      });
    }

    const newHash = await hashPassword(newPassword);
    await this.repo.updateUserPassword(userId, newHash);

    // Keep the session the request came in on; revoke every other session.
    const currentSession = currentSessionTokenHash
      ? await this.repo.findSessionByTokenHash(currentSessionTokenHash)
      : null;
    await this.repo.revokeAllSessions(userId, currentSession?.id);

    await this.audit.record({
      actorUserId: userId,
      action: "PASSWORD_CHANGED",
      entityType: "User",
      entityId: userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  async requestPasswordReset(mobile: string, meta: RequestMeta): Promise<void> {
    const user = await this.repo.findUserByMobile(mobile);
    // Deliberately silent on a miss — the controller always returns the
    // same generic message regardless of what happens here.
    if (!user) return;

    const rawToken = generateSecureToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await this.repo.createPasswordResetToken({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "PASSWORD_RESET_REQUESTED",
      entityType: "User",
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("password_reset_started", user.publicId);

    // SIH demo: delivery is mocked. In a real deployment this raw token is
    // sent via SMS/email and never logged or returned to the client. Kept
    // out of production; visible in development so the flow is testable
    // end-to-end without a paid SMS/email integration, and in test so the
    // integration suite can assert against a token it never receives over
    // the wire.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[MockDelivery] Password reset token for ${user.mobile}: ${rawToken}`);
    }
  }

  async resetPassword(rawToken: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const tokenRecord = await this.repo.findValidPasswordResetTokenByHash(tokenHash);

    if (!tokenRecord) {
      throw new ValidationError("Please correct the highlighted fields", {
        token: "This reset link is invalid or has expired.",
      });
    }

    const newHash = await hashPassword(newPassword);
    await this.repo.updateUserPassword(tokenRecord.userId, newHash);
    await this.repo.consumePasswordResetToken(tokenRecord.id);
    await this.repo.revokeAllSessions(tokenRecord.userId);

    await this.audit.record({
      actorUserId: tokenRecord.userId,
      action: "PASSWORD_RESET_COMPLETED",
      entityType: "User",
      entityId: tokenRecord.userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("password_reset_completed", tokenRecord.userId);
  }
}
