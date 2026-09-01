import { createApp } from "../../src/app";
import { InMemoryAuthRepository } from "./inMemoryAuthRepository";
import { FakeAuditService } from "./fakeAuditService";
import { InMemoryReferenceDataRepository } from "./inMemoryReferenceDataRepository";
import { InMemoryFarmerProfileRepository } from "./inMemoryFarmerProfileRepository";
import { InMemoryFarmsRepository } from "./inMemoryFarmsRepository";
import { InMemoryFarmerCropRepository } from "./inMemoryFarmerCropRepository";
import { InMemoryFpoRepository } from "./inMemoryFpoRepository";
import { InMemoryFpoAdminRepository } from "./inMemoryFpoAdminRepository";
import { InMemoryFpoMembershipRepository } from "./inMemoryFpoMembershipRepository";
import { InMemoryAggregationGroupRepository } from "./inMemoryAggregationGroupRepository";
import { InMemoryCropLotRepository } from "./inMemoryCropLotRepository";
import { InMemoryQualityRepository, InMemoryQualityStandardRepository } from "./inMemoryQualityRepository";
import { QualityAIProvider } from "../../src/modules/quality/ai/quality-ai.provider";

export function buildTestApp(overrides: { qualityAiProvider?: QualityAIProvider } = {}) {
  const authRepository = new InMemoryAuthRepository();
  const auditService = new FakeAuditService();

  // Module 2 — same in-memory-fake-instead-of-a-live-database approach as
  // Module 1 (see InMemoryAuthRepository above and prisma/README-engines.md).
  const referenceDataRepository = new InMemoryReferenceDataRepository();
  const farmerProfileRepository = new InMemoryFarmerProfileRepository();
  farmerProfileRepository.setUsersRepository(authRepository);
  const farmsRepository = new InMemoryFarmsRepository(referenceDataRepository);
  const farmerCropRepository = new InMemoryFarmerCropRepository(referenceDataRepository, farmsRepository);

  // Module 3 — FPO Management & Farmer Aggregation. Same approach; the
  // membership repository additionally joins across the fakes above to
  // replicate the real Prisma `include` used by the member directory.
  const fpoRepository = new InMemoryFpoRepository(referenceDataRepository);
  const fpoAdminRepository = new InMemoryFpoAdminRepository();
  const fpoMembershipRepository = new InMemoryFpoMembershipRepository(
    referenceDataRepository,
    farmerProfileRepository,
    authRepository,
    farmsRepository,
    farmerCropRepository,
  );
  const aggregationGroupRepository = new InMemoryAggregationGroupRepository(referenceDataRepository);

  // Module 4 — Crop / Lot Management. Joins across the Module 2/3 fakes
  // above (crop/farm/fpo) the same way InMemoryAggregationGroupRepository
  // joins against reference data.
  const cropLotRepository = new InMemoryCropLotRepository(referenceDataRepository, farmsRepository, fpoRepository);

  // Module 5 — Quality Grading & Produce Assessment. Joins against the
  // Module 4 fake above (crop/farm/fpo already resolved there) the same
  // way it joins against reference data above.
  const qualityRepository = new InMemoryQualityRepository(cropLotRepository);
  const qualityStandardRepository = new InMemoryQualityStandardRepository();

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
    fpoRepository,
    fpoAdminRepository,
    fpoMembershipRepository,
    aggregationGroupRepository,
    cropLotRepository,
    qualityRepository,
    qualityStandardRepository,
    qualityAiProvider: overrides.qualityAiProvider,
  });

  return {
    app,
    authRepository,
    auditService,
    referenceDataRepository,
    farmerProfileRepository,
    farmsRepository,
    farmerCropRepository,
    fpoRepository,
    fpoAdminRepository,
    fpoMembershipRepository,
    aggregationGroupRepository,
    cropLotRepository,
    qualityRepository,
    qualityStandardRepository,
  };
}
