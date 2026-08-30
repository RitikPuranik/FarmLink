import { randomUUID } from "crypto";
import type {
  AuthRepository,
  CreatePasswordResetTokenData,
  CreateSessionData,
  CreateUserData,
} from "../../src/modules/auth/auth.repository";

// Mirrors the Prisma `User` shape closely enough for the auth module's own
// logic to exercise fully, without needing a generated Prisma client in
// this sandbox. Field-for-field with prisma/schema.prisma's User model.
export interface FakeUser {
  id: string;
  publicId: string;
  fullName: string;
  mobile: string;
  email: string | null;
  passwordHash: string;
  role: string;
  accountStatus: string;
  phoneVerificationStatus: string;
  emailVerificationStatus: string;
  identityVerificationStatus: string;
  preferredLanguage: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  userAgent?: string;
  ipAddress?: string;
}

interface FakeResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export class InMemoryAuthRepository implements AuthRepository {
  users: FakeUser[] = [];
  sessions: FakeSession[] = [];
  resetTokens: FakeResetToken[] = [];

  /** Test helper — not part of the AuthRepository interface. */
  seedUser(overrides: Partial<FakeUser> & Pick<FakeUser, "mobile" | "passwordHash">): FakeUser {
    const now = new Date();
    const user: FakeUser = {
      id: randomUUID(),
      publicId: randomUUID(),
      fullName: "Test User",
      email: null,
      role: "FARMER",
      accountStatus: "ACTIVE",
      phoneVerificationStatus: "PENDING",
      emailVerificationStatus: "PENDING",
      identityVerificationStatus: "PENDING",
      preferredLanguage: "en",
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.users.push(user);
    return user;
  }

  async findUserByMobile(mobile: string) {
    return (this.users.find((u) => u.mobile === mobile) as never) ?? null;
  }

  async findUserByEmail(email: string) {
    return (this.users.find((u) => u.email === email) as never) ?? null;
  }

  async findUserById(id: string) {
    return (this.users.find((u) => u.id === id) as never) ?? null;
  }

  async findManyByIds(ids: string[]) {
    return this.users.filter((u) => ids.includes(u.id)) as never;
  }

  async createUser(data: CreateUserData) {
    const now = new Date();
    const user: FakeUser = {
      id: randomUUID(),
      publicId: randomUUID(),
      fullName: data.fullName,
      mobile: data.mobile,
      email: data.email ?? null,
      passwordHash: data.passwordHash,
      role: data.role,
      accountStatus: "PENDING_VERIFICATION",
      phoneVerificationStatus: "PENDING",
      emailVerificationStatus: "PENDING",
      identityVerificationStatus: "PENDING",
      preferredLanguage: data.preferredLanguage,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(user);
    return user as never;
  }

  async updateUserPassword(userId: string, passwordHash: string) {
    const user = this.users.find((u) => u.id === userId);
    if (user) user.passwordHash = passwordHash;
  }

  async updateLastLogin(userId: string) {
    const user = this.users.find((u) => u.id === userId);
    if (user) user.lastLoginAt = new Date();
  }

  async updateAccountStatus(userId: string, status: string) {
    const user = this.users.find((u) => u.id === userId);
    if (user) user.accountStatus = status;
  }

  async createSession(data: CreateSessionData) {
    const now = new Date();
    const session: FakeSession = {
      id: randomUUID(),
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      createdAt: now,
      revokedAt: null,
      lastUsedAt: null,
      userAgent: data.userAgent,
      ipAddress: data.ipAddress,
    };
    this.sessions.push(session);
    return session as never;
  }

  async findSessionByTokenHash(tokenHash: string) {
    return (this.sessions.find((s) => s.tokenHash === tokenHash && !s.revokedAt) as never) ?? null;
  }

  async touchSession(sessionId: string) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (session) session.lastUsedAt = new Date();
  }

  async revokeSession(sessionId: string) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (session) session.revokedAt = new Date();
  }

  async revokeSessionByTokenHash(tokenHash: string) {
    for (const session of this.sessions) {
      if (session.tokenHash === tokenHash && !session.revokedAt) {
        session.revokedAt = new Date();
      }
    }
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string) {
    for (const session of this.sessions) {
      if (session.userId === userId && !session.revokedAt && session.id !== exceptSessionId) {
        session.revokedAt = new Date();
      }
    }
  }

  async createPasswordResetToken(data: CreatePasswordResetTokenData) {
    this.resetTokens.push({
      id: randomUUID(),
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      usedAt: null,
    });
  }

  async findValidPasswordResetTokenByHash(tokenHash: string) {
    const token = this.resetTokens.find(
      (t) => t.tokenHash === tokenHash && !t.usedAt && t.expiresAt > new Date(),
    );
    return token ? { id: token.id, userId: token.userId } : null;
  }

  async consumePasswordResetToken(tokenId: string) {
    const token = this.resetTokens.find((t) => t.id === tokenId);
    if (token) token.usedAt = new Date();
  }
}
