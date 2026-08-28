import { createApp } from "../../src/app";
import { InMemoryAuthRepository } from "./inMemoryAuthRepository";
import { FakeAuditService } from "./fakeAuditService";
import { InMemoryReferenceDataRepository } from "./inMemoryReferenceDataRepository";
import { InMemoryFarmerProfileRepository } from "./inMemoryFarmerProfileRepository";
import { InMemoryFarmsRepository } from "./inMemoryFarmsRepository";
import { InMemoryFarmerCropRepository } from "./inMemoryFarmerCropRepository";

export function buildTestApp() {
  const authRepository = new InMemoryAuthRepository();
  const auditService = new FakeAuditService();

  // Module 2 — same in-memory-fake-instead-of-a-live-database approach as
  // Module 1 (see InMemoryAuthRepository above and prisma/README-engines.md).
  const referenceDataRepository = new InMemoryReferenceDataRepository();
  const farmerProfileRepository = new InMemoryFarmerProfileRepository();
  const farmsRepository = new InMemoryFarmsRepository(referenceDataRepository);
  const farmerCropRepository = new InMemoryFarmerCropRepository(referenceDataRepository, farmsRepository);

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

  const app = createApp({
    authRepository,
    auditService,
    prisma: fakePrisma,
    referenceDataRepository,
    farmerProfileRepository,
    farmsRepository,
    farmerCropRepository,
  });

  return {
    app,
    authRepository,
    auditService,
    referenceDataRepository,
    farmerProfileRepository,
    farmsRepository,
    farmerCropRepository,
  };
}
