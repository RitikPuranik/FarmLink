import { createApp } from "../../src/app";
import { InMemoryAuthRepository } from "./inMemoryAuthRepository";
import { FakeAuditService } from "./fakeAuditService";

export function buildTestApp() {
  const authRepository = new InMemoryAuthRepository();
  const auditService = new FakeAuditService();

  // The admin listing route is the only thing that touches `prisma`
  // directly (see modules/users/users.routes.ts) — a minimal fake is
  // enough since it's a straight passthrough to `findMany`.
  const fakePrisma = {
    user: {
      findMany: async () =>
        authRepository.users.map((u) => ({
          publicId: u.publicId,
          fullName: u.fullName,
          mobile: u.mobile,
          email: u.email,
          role: u.role,
          accountStatus: u.accountStatus,
          createdAt: u.createdAt,
        })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const app = createApp({ authRepository, auditService, prisma: fakePrisma });

  return { app, authRepository, auditService };
}
