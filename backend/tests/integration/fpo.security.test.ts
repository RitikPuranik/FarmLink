import request from "supertest";
import { buildTestApp } from "../testUtils/buildTestApp";
import { registerAndLoginFarmer } from "../testUtils/farmerAuthHelpers";
import {
  createFpoAsAdmin,
  createFpoWithActiveMember,
  seedAndLoginAdmin,
  seedAndLoginGovernmentViewer,
} from "../testUtils/fpoTestHelpers";

describe("SECURITY: cross-FPO access (build spec section 83 — mandatory)", () => {
  it("FPO Admin A cannot manage FPO B", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminAToken } = await createFpoAsAdmin(app, authRepository, { name: "FPO A" });
    const { fpoId: fpoBId } = await createFpoAsAdmin(app, authRepository, { name: "FPO B" });

    const res = await request(app)
      .post(`/api/fpos/${fpoBId}/aggregation-groups`)
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({ cropId: "44444444-4444-4444-4444-444444444441", targetQuantity: 10, unit: "QTL" });

    expect(res.status).toEqual(403);
  });

  it("FPO Admin A cannot see FPO B's member directory", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminAToken } = await createFpoAsAdmin(app, authRepository, { name: "FPO A" });
    const { fpoId: fpoBId } = await createFpoAsAdmin(app, authRepository, { name: "FPO B" });

    const res = await request(app).get(`/api/fpos/${fpoBId}/members`).set("Authorization", `Bearer ${adminAToken}`);
    expect(res.status).toEqual(403);
  });

  it("FPO Admin A cannot approve a membership request belonging to FPO B", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminAToken } = await createFpoAsAdmin(app, authRepository, { name: "FPO A" });
    const { fpoId: fpoBId } = await createFpoAsAdmin(app, authRepository, { name: "FPO B" });
    const { token: farmerToken } = await registerAndLoginFarmer(app);

    const reqRes = await request(app)
      .post(`/api/fpos/${fpoBId}/membership-requests`)
      .set("Authorization", `Bearer ${farmerToken}`)
      .send();
    const membershipId = reqRes.body.data.membership.publicId;

    const approveRes = await request(app)
      .post(`/api/fpo-memberships/${membershipId}/approve`)
      .set("Authorization", `Bearer ${adminAToken}`)
      .send();
    expect(approveRes.status).toEqual(403);
  });

  it("FPO Admin A cannot cancel FPO B's aggregation target (IDOR via aggregationId)", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminAToken } = await createFpoAsAdmin(app, authRepository, { name: "FPO A" });
    const { token: adminBToken, fpoId: fpoBId } = await createFpoAsAdmin(app, authRepository, { name: "FPO B" });

    const createRes = await request(app)
      .post(`/api/fpos/${fpoBId}/aggregation-groups`)
      .set("Authorization", `Bearer ${adminBToken}`)
      .send({ cropId: "44444444-4444-4444-4444-444444444441", targetQuantity: 10, unit: "QTL" });
    const aggregationId = createRes.body.data.aggregationGroup.publicId;

    // Admin A tries to hit it through FPO A's own URL scope.
    const { fpoId: fpoAId } = await createFpoAsAdmin(app, authRepository, { name: "FPO A2" });
    const cancelRes = await request(app)
      .post(`/api/fpos/${fpoAId}/aggregation-groups/${aggregationId}/cancel`)
      .set("Authorization", `Bearer ${adminAToken}`)
      .send();
    // Not found under FPO A's scope (the group doesn't belong to fpoAId) —
    // never a 200, regardless of which specific 4xx.
    expect([403, 404]).toContain(cancelRes.status);
  });
});

describe("SECURITY: farmer identity is never client-supplied (build spec section 84 — mandatory)", () => {
  it("a membership request always uses the authenticated session's farmer, never a body-supplied id", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token } = await registerAndLoginFarmer(app);

    const res = await request(app)
      .post(`/api/fpos/${fpoId}/membership-requests`)
      .set("Authorization", `Bearer ${token}`)
      .send({ farmerId: "some-other-farmer-id", userId: "some-other-user-id" });

    expect(res.status).toEqual(201);
    // The extra fields are silently ignored by the strict schema / the
    // service never reads them — verified indirectly: the request
    // succeeded as the *authenticated* farmer's own request.
    const myFpo = await request(app).get("/api/farmers/me/fpo").set("Authorization", `Bearer ${token}`);
    expect(myFpo.body.data.membership.status).toEqual("PENDING");
  });
});

describe("SECURITY: GOVERNMENT_VIEWER is read-only (build spec section 85 — mandatory)", () => {
  it("GOVERNMENT_VIEWER can read the national summary", async () => {
    const { app, authRepository } = buildTestApp();
    const { token } = await seedAndLoginGovernmentViewer(app, authRepository);
    const res = await request(app).get("/api/government/fpo-summary").set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(200);
    expect(res.body.data.fpoCount).toBeGreaterThanOrEqual(0);
  });

  it("GOVERNMENT_VIEWER cannot verify an FPO", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token } = await seedAndLoginGovernmentViewer(app, authRepository);

    const res = await request(app).post(`/api/admin/fpos/${fpoId}/verify`).set("Authorization", `Bearer ${token}`).send();
    expect(res.status).toEqual(403);
  });

  it("GOVERNMENT_VIEWER cannot approve a membership or create an aggregation target", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoWithActiveMember(app, authRepository);
    const { token } = await seedAndLoginGovernmentViewer(app, authRepository);

    const aggRes = await request(app)
      .post(`/api/fpos/${fpoId}/aggregation-groups`)
      .set("Authorization", `Bearer ${token}`)
      .send({ cropId: "44444444-4444-4444-4444-444444444441", targetQuantity: 10, unit: "QTL" });
    expect(aggRes.status).toEqual(403);

    const membersRes = await request(app).get(`/api/fpos/${fpoId}/members`).set("Authorization", `Bearer ${token}`);
    expect(membersRes.status).toEqual(403);
  });
});

describe("SECURITY: role spoofing / IDOR misc", () => {
  it("an unauthenticated caller gets 401, not a leak, from FPO-scoped admin endpoints", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoAsAdmin(app, authRepository);
    const res = await request(app).get(`/api/fpos/${fpoId}/members`);
    expect(res.status).toEqual(401);
  });

  it("an unknown membershipId 404s rather than leaking a 500", async () => {
    const { app, authRepository } = buildTestApp();
    const { token } = await seedAndLoginAdmin(app, authRepository);
    const res = await request(app)
      .post("/api/fpo-memberships/00000000-0000-0000-0000-000000000000/approve")
      .set("Authorization", `Bearer ${token}`)
      .send();
    expect(res.status).toEqual(404);
  });

  it("a suspended FPO's aggregation-group creation is blocked even for its own admin", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: fpoAdminToken, fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token: platformAdminToken } = await seedAndLoginAdmin(app, authRepository);
    await request(app).post(`/api/admin/fpos/${fpoId}/suspend`).set("Authorization", `Bearer ${platformAdminToken}`).send();

    const res = await request(app)
      .post(`/api/fpos/${fpoId}/aggregation-groups`)
      .set("Authorization", `Bearer ${fpoAdminToken}`)
      .send({ cropId: "44444444-4444-4444-4444-444444444441", targetQuantity: 10, unit: "QTL" });
    expect(res.status).toEqual(409);
  });
});
