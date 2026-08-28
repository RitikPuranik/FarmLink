import { AccountStatus, Language, PrismaClient, Session, User, UserRole } from "@prisma/client";

export interface CreateUserData {
  fullName: string;
  mobile: string;
  email?: string;
  passwordHash: string;
  role: UserRole;
  preferredLanguage: Language;
}

export interface CreateSessionData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

export interface CreatePasswordResetTokenData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Data-access boundary for the auth module. Keeping this as an interface
 * (rather than calling Prisma directly from the service) means:
 *  - business logic in AuthService has no Prisma-specific code in it
 *  - tests can inject an in-memory fake instead of a live database
 *  - future modules get a single, well-known place that talks to the
 *    users/sessions tables
 */
export interface AuthRepository {
  findUserByMobile(mobile: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  createUser(data: CreateUserData): Promise<User>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  updateLastLogin(userId: string): Promise<void>;
  updateAccountStatus(userId: string, status: AccountStatus): Promise<void>;

  createSession(data: CreateSessionData): Promise<Session>;
  findSessionByTokenHash(tokenHash: string): Promise<Session | null>;
  touchSession(sessionId: string): Promise<void>;
  revokeSession(sessionId: string): Promise<void>;
  revokeSessionByTokenHash(tokenHash: string): Promise<void>;
  revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void>;

  createPasswordResetToken(data: CreatePasswordResetTokenData): Promise<void>;
  findValidPasswordResetTokenByHash(tokenHash: string): Promise<{ id: string; userId: string } | null>;
  consumePasswordResetToken(tokenId: string): Promise<void>;
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findUserByMobile(mobile: string) {
    return this.prisma.user.findUnique({ where: { mobile } });
  }

  findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  createUser(data: CreateUserData) {
    return this.prisma.user.create({
      data: {
        fullName: data.fullName,
        mobile: data.mobile,
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
        preferredLanguage: data.preferredLanguage,
        accountStatus: "PENDING_VERIFICATION",
        phoneVerificationStatus: "PENDING",
        emailVerificationStatus: "PENDING",
        identityVerificationStatus: "PENDING",
      },
    });
  }

  async updateUserPassword(userId: string, passwordHash: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async updateLastLogin(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }

  async updateAccountStatus(userId: string, status: AccountStatus) {
    await this.prisma.user.update({ where: { id: userId }, data: { accountStatus: status } });
  }

  createSession(data: CreateSessionData) {
    return this.prisma.session.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        userAgent: data.userAgent,
        ipAddress: data.ipAddress,
      },
    });
  }

  findSessionByTokenHash(tokenHash: string) {
    return this.prisma.session.findFirst({ where: { tokenHash, revokedAt: null } });
  }

  async touchSession(sessionId: string) {
    await this.prisma.session.update({ where: { id: sessionId }, data: { lastUsedAt: new Date() } });
  }

  async revokeSession(sessionId: string) {
    await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  }

  async revokeSessionByTokenHash(tokenHash: string) {
    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string) {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  async createPasswordResetToken(data: CreatePasswordResetTokenData) {
    await this.prisma.passwordResetToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      },
    });
  }

  async findValidPasswordResetTokenByHash(tokenHash: string) {
    const token = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userId: true },
    });
    return token;
  }

  async consumePasswordResetToken(tokenId: string) {
    await this.prisma.passwordResetToken.update({
      where: { id: tokenId },
      data: { usedAt: new Date() },
    });
  }
}
