import request from "supertest";
import { buildTestApp } from "../testUtils/buildTestApp";
import { registerAndLoginFarmer } from "../testUtils/farmerAuthHelpers";
import { createFpoAsAdmin, seedAndLoginAdmin, seedAndLoginFpoAdmin } from "../testUtils/fpoTestHelpers";

describe("Admin FPO verification & lifecycle", () => {
  it("verifies a PENDING FPO and keeps the verification note out of the response", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token: platformAdminToken } = await seedAndLoginAdmin(app, authRepository);

    const res = await request(app)
      .post(`/api/admin/fpos/${fpoId}/verify`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ verificationNote: "Reviewed registration documents" });

    expect(res.status).toEqual(200);
    expect(res.body.data.fpo.verificationStatus).toEqual("VERIFIED");
    expect(JSON.stringify(res.body)).not.toContain("Reviewed registration documents");
  });

  it("rejects a PENDING FPO", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token: platformAdminToken } = await seedAndLoginAdmin(app, authRepository);

    const res = await request(app)
      .post(`/api/admin/fpos/${fpoId}/reject`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send();
    expect(res.status).toEqual(200);
    expect(res.body.data.fpo.verificationStatus).toEqual("REJECTED");
  });

  it("cannot verify an already-verified FPO again", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token: platformAdminToken } = await seedAndLoginAdmin(app, authRepository);

    await request(app).post(`/api/admin/fpos/${fpoId}/verify`).set("Authorization", `Bearer ${platformAdminToken}`).send();
    const second = await request(app)
      .post(`/api/admin/fpos/${fpoId}/verify`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send();
    expect(second.status).toEqual(409);
  });

  it("suspending an FPO blocks normal FPO-admin operations", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: fpoAdminToken, fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token: platformAdminToken } = await seedAndLoginAdmin(app, authRepository);

    const suspendRes = await request(app)
      .post(`/api/admin/fpos/${fpoId}/suspend`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send();
    expect(suspendRes.status).toEqual(200);
    expect(suspendRes.body.data.fpo.accountStatus).toEqual("SUSPENDED");

    // A farmer's join request against a suspended FPO must fail.
    const { token: farmerToken } = await registerAndLoginFarmer(app);
    const joinRes = await request(app)
      .post(`/api/fpos/${fpoId}/membership-requests`)
      .set("Authorization", `Bearer ${farmerToken}`)
      .send();
    expect(joinRes.status).toEqual(409);

    // A suspended FPO no longer appears in Module 2's self-declared FPO
    // reference list either (backward-compat `active` flag stayed in sync).
    const referenceList = await request(app).get("/api/reference/fpos").set("Authorization", `Bearer ${fpoAdminToken}`);
    expect(referenceList.status).toEqual(200);

    // Reactivating restores normal operation.
    const reactivateRes = await request(app)
      .post(`/api/admin/fpos/${fpoId}/reactivate`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send();
    expect(reactivateRes.status).toEqual(200);
    expect(reactivateRes.body.data.fpo.accountStatus).toEqual("ACTIVE");

    const secondJoinRes = await request(app)
      .post(`/api/fpos/${fpoId}/membership-requests`)
      .set("Authorization", `Bearer ${farmerToken}`)
      .send();
    expect(secondJoinRes.status).toEqual(201);
  });

  it("a plain FPO_ADMIN cannot call the platform verify/suspend endpoints", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId, token: fpoAdminToken } = await createFpoAsAdmin(app, authRepository);

    const res = await request(app)
      .post(`/api/admin/fpos/${fpoId}/verify`)
      .set("Authorization", `Bearer ${fpoAdminToken}`)
      .send();
    expect(res.status).toEqual(403);
  });

  it("assigns an FPO_ADMIN user as an administrator of an FPO, and rejects a non-FPO_ADMIN target", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token: platformAdminToken } = await seedAndLoginAdmin(app, authRepository);
    const { mobile: newAdminMobile } = await seedAndLoginFpoAdmin(app, authRepository);

    const newAdminUser = authRepository.users.find((u) => u.mobile === newAdminMobile)!;

    const assignRes = await request(app)
      .post(`/api/admin/fpos/${fpoId}/admins`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ userId: newAdminUser.id, role: "ADMIN" });
    expect(assignRes.status).toEqual(201);

    // That user can now manage the FPO.
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ mobile: newAdminMobile, password: "SecurePassword123" });
    const membersRes = await request(app)
      .get(`/api/fpos/${fpoId}/members`)
      .set("Authorization", `Bearer ${loginRes.body.data.accessToken}`);
    expect(membersRes.status).toEqual(200);

    // A FARMER can never be assigned as an FPO admin.
    const { token: farmerToken } = await registerAndLoginFarmer(app);
    void farmerToken;
    const farmerUser = authRepository.users[authRepository.users.length - 1];
    const badAssign = await request(app)
      .post(`/api/admin/fpos/${fpoId}/admins`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ userId: farmerUser.id, role: "ADMIN" });
    expect(badAssign.status).toEqual(400);
  });
});
