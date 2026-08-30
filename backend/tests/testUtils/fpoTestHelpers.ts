import request from "supertest";
import type { Express } from "express";
import { hashPassword } from "../../src/modules/auth/auth.utils";
import type { InMemoryAuthRepository } from "./inMemoryAuthRepository";
import { registerAndLoginFarmer } from "./farmerAuthHelpers";
import { MAHARASHTRA_STATE_ID, NASHIK_DISTRICT_ID, NIPHAD_TALUKA_ID } from "./referenceDataFixtures";

let mobileCounter = 9_700_000_000;

async function seedAndLogin(app: Express, authRepository: InMemoryAuthRepository, role: string) {
  const mobile = String(mobileCounter++);
  const password = "SecurePassword123";
  const passwordHash = await hashPassword(password);
  authRepository.seedUser({ mobile, passwordHash, role: role as never, accountStatus: "ACTIVE" });

  const loginRes = await request(app).post("/api/auth/login").send({ mobile, password });
  return { token: loginRes.body.data.accessToken as string, mobile };
}

export function seedAndLoginFpoAdmin(app: Express, authRepository: InMemoryAuthRepository) {
  return seedAndLogin(app, authRepository, "FPO_ADMIN");
}

export function seedAndLoginAdmin(app: Express, authRepository: InMemoryAuthRepository) {
  return seedAndLogin(app, authRepository, "ADMIN");
}

export function seedAndLoginGovernmentViewer(app: Express, authRepository: InMemoryAuthRepository) {
  return seedAndLogin(app, authRepository, "GOVERNMENT_VIEWER");
}

export const VALID_FPO_INPUT = {
  name: "Nashik Valley Growers",
  organizationType: "FPO",
  stateId: MAHARASHTRA_STATE_ID,
  districtId: NASHIK_DISTRICT_ID,
  talukaId: NIPHAD_TALUKA_ID,
  village: "Pimpalgaon",
};

/** Registers+logs in a fresh FPO_ADMIN and has them register a new FPO
 * (which auto-assigns them as its PRIMARY_ADMIN). Returns the admin's
 * token and the FPO's publicId. */
export async function createFpoAsAdmin(
  app: Express,
  authRepository: InMemoryAuthRepository,
  overrides: Partial<typeof VALID_FPO_INPUT> = {},
) {
  const { token } = await seedAndLoginFpoAdmin(app, authRepository);
  const res = await request(app)
    .post("/api/fpos")
    .set("Authorization", `Bearer ${token}`)
    .send({ ...VALID_FPO_INPUT, ...overrides });
  return { token, fpoId: res.body.data.fpo.publicId as string };
}

const VALID_FARM = {
  name: "Main Farm",
  village: "Pimpalgaon",
  stateId: MAHARASHTRA_STATE_ID,
  districtId: NASHIK_DISTRICT_ID,
  talukaId: NIPHAD_TALUKA_ID,
  area: 4,
  areaUnit: "ACRE",
};

/** Registers a fresh farmer, gives them a farm + one crop row, and returns
 * their token — used across membership/aggregation tests. */
export async function setupFarmerWithCrop(
  app: Express,
  overrides: Partial<{ cropId: string; area: number; areaUnit: string; typicalYield: number; yieldUnit: string }> = {},
) {
  const { token } = await registerAndLoginFarmer(app);
  const farmRes = await request(app).post("/api/farms").set("Authorization", `Bearer ${token}`).send(VALID_FARM);
  const farmId = farmRes.body.data.farm.id as string;

  if (overrides.cropId) {
    await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({
        farmId,
        cropId: overrides.cropId,
        area: overrides.area ?? 2,
        areaUnit: overrides.areaUnit ?? "ACRE",
        typicalYield: overrides.typicalYield,
        yieldUnit: overrides.yieldUnit,
      });
  }

  return { token, farmId };
}

/** Full happy-path setup: an FPO, a farmer who requests membership and
 * gets approved. Returns everything a test might need. */
export async function createFpoWithActiveMember(
  app: Express,
  authRepository: InMemoryAuthRepository,
  cropOverrides: Partial<{ cropId: string; area: number; areaUnit: string; typicalYield: number; yieldUnit: string }> = {},
) {
  const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);
  const { token: farmerToken } = await setupFarmerWithCrop(app, cropOverrides);

  const requestRes = await request(app)
    .post(`/api/fpos/${fpoId}/membership-requests`)
    .set("Authorization", `Bearer ${farmerToken}`)
    .send();
  const membershipId = requestRes.body.data.membership.publicId as string;

  await request(app)
    .post(`/api/fpo-memberships/${membershipId}/approve`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send();

  return { adminToken, fpoId, farmerToken, membershipId };
}
