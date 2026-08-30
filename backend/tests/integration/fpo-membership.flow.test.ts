import request from "supertest";
import { buildTestApp } from "../testUtils/buildTestApp";
import { registerAndLoginFarmer } from "../testUtils/farmerAuthHelpers";
import { createFpoAsAdmin, createFpoWithActiveMember, setupFarmerWithCrop } from "../testUtils/fpoTestHelpers";
import { ONION_CROP_ID } from "../testUtils/referenceDataFixtures";

describe("FPO membership workflow", () => {
  it("a farmer can request membership and an FPO admin can approve it", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token: farmerToken } = await registerAndLoginFarmer(app);

    const requestRes = await request(app)
      .post(`/api/fpos/${fpoId}/membership-requests`)
      .set("Authorization", `Bearer ${farmerToken}`)
      .send();
    expect(requestRes.status).toEqual(201);
    expect(requestRes.body.data.membership.status).toEqual("PENDING");

    const membershipId = requestRes.body.data.membership.publicId;
    const approveRes = await request(app)
      .post(`/api/fpo-memberships/${membershipId}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();

    expect(approveRes.status).toEqual(200);
    expect(approveRes.body.data.membership.status).toEqual("ACTIVE");
    expect(approveRes.body.data.membership.joinedAt).toBeTruthy();

    const myFpo = await request(app).get("/api/farmers/me/fpo").set("Authorization", `Bearer ${farmerToken}`);
    expect(myFpo.status).toEqual(200);
    expect(myFpo.body.data.hasFpo).toBe(true);
    expect(myFpo.body.data.fpo.publicId).toEqual(fpoId);
  });

  it("never trusts a client-supplied farmerId — identity always comes from the session", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token: farmerAToken } = await registerAndLoginFarmer(app);
    const { token: farmerBToken } = await registerAndLoginFarmer(app);

    // Farmer A tries to submit a request "as" farmer B by injecting a body
    // field the endpoint doesn't even accept.
    const res = await request(app)
      .post(`/api/fpos/${fpoId}/membership-requests`)
      .set("Authorization", `Bearer ${farmerAToken}`)
      .send({ farmerId: "farmer-b-id" });

    expect(res.status).toEqual(201);

    // Confirm the request belongs to farmer A, not farmer B — farmer B has
    // no pending request of their own.
    const farmerBView = await request(app).get("/api/farmers/me/fpo").set("Authorization", `Bearer ${farmerBToken}`);
    expect(farmerBView.body.data.hasFpo).toBe(false);
    expect(farmerBView.body.data.membership).toBeNull();
  });

  it("returns a valid empty state for a farmer with no FPO", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);
    const res = await request(app).get("/api/farmers/me/fpo").set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(200);
    expect(res.body.data.hasFpo).toBe(false);
    expect(res.body.data.fpo).toBeNull();
  });

  it("409s a duplicate pending request to the same FPO", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token } = await registerAndLoginFarmer(app);

    await request(app).post(`/api/fpos/${fpoId}/membership-requests`).set("Authorization", `Bearer ${token}`).send();
    const second = await request(app)
      .post(`/api/fpos/${fpoId}/membership-requests`)
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(second.status).toEqual(409);
  });

  it("409s a second FPO membership request once the farmer is already ACTIVE elsewhere", async () => {
    const { app, authRepository } = buildTestApp();
    const { farmerToken } = await createFpoWithActiveMember(app, authRepository);
    const { fpoId: secondFpoId } = await createFpoAsAdmin(app, authRepository, { name: "Another FPO" });

    const res = await request(app)
      .post(`/api/fpos/${secondFpoId}/membership-requests`)
      .set("Authorization", `Bearer ${farmerToken}`)
      .send();

    expect(res.status).toEqual(409);
  });

  it("a farmer cannot approve their own membership request", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token: farmerToken } = await registerAndLoginFarmer(app);

    const requestRes = await request(app)
      .post(`/api/fpos/${fpoId}/membership-requests`)
      .set("Authorization", `Bearer ${farmerToken}`)
      .send();
    const membershipId = requestRes.body.data.membership.publicId;

    const approveRes = await request(app)
      .post(`/api/fpo-memberships/${membershipId}/approve`)
      .set("Authorization", `Bearer ${farmerToken}`)
      .send();

    expect(approveRes.status).toEqual(403);
  });

  it("rejecting a request stores the reason and moves PENDING -> REJECTED", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token: farmerToken } = await registerAndLoginFarmer(app);

    const requestRes = await request(app)
      .post(`/api/fpos/${fpoId}/membership-requests`)
      .set("Authorization", `Bearer ${farmerToken}`)
      .send();
    const membershipId = requestRes.body.data.membership.publicId;

    const rejectRes = await request(app)
      .post(`/api/fpo-memberships/${membershipId}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Membership criteria not met" });

    expect(rejectRes.status).toEqual(200);
    expect(rejectRes.body.data.membership.status).toEqual("REJECTED");
    expect(rejectRes.body.data.membership.rejectionReason).toEqual("Membership criteria not met");
  });

  it("rejects an invalid state transition: approving an already-approved membership", async () => {
    const { app, authRepository } = buildTestApp();
    const { adminToken, membershipId } = await createFpoWithActiveMember(app, authRepository);

    const res = await request(app)
      .post(`/api/fpo-memberships/${membershipId}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();

    expect(res.status).toEqual(409);
  });

  it("removes an active member without deleting the historical row", async () => {
    const { app, authRepository } = buildTestApp();
    const { adminToken, membershipId, fpoId } = await createFpoWithActiveMember(app, authRepository);

    const removeRes = await request(app)
      .post(`/api/fpo-memberships/${membershipId}/remove`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();
    expect(removeRes.status).toEqual(200);
    expect(removeRes.body.data.membership.status).toEqual("REMOVED");

    // Removing again must not corrupt state (build spec section 93).
    const secondRemove = await request(app)
      .post(`/api/fpo-memberships/${membershipId}/remove`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();
    expect(secondRemove.status).toEqual(409);

    const directory = await request(app)
      .get(`/api/fpos/${fpoId}/members`)
      .query({ status: "REMOVED" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(directory.body.data.items.length).toEqual(1);
  });

  it("suspend then reactivate a member", async () => {
    const { app, authRepository } = buildTestApp();
    const { adminToken, membershipId } = await createFpoWithActiveMember(app, authRepository);

    const suspendRes = await request(app)
      .post(`/api/fpo-memberships/${membershipId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();
    expect(suspendRes.body.data.membership.status).toEqual("SUSPENDED");

    const reactivateRes = await request(app)
      .post(`/api/fpo-memberships/${membershipId}/reactivate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();
    expect(reactivateRes.body.data.membership.status).toEqual("ACTIVE");
  });

  it("member directory returns village/crop info and hides auth internals", async () => {
    const { app, authRepository } = buildTestApp();
    const { adminToken, fpoId } = await createFpoWithActiveMember(app, authRepository, {
      cropId: ONION_CROP_ID,
      area: 2,
      areaUnit: "ACRE",
    });

    const res = await request(app).get(`/api/fpos/${fpoId}/members`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toEqual(200);
    expect(res.body.data.items.length).toEqual(1);
    const entry = res.body.data.items[0];
    expect(entry.village).toEqual("Pimpalgaon");
    expect(entry.primaryCrop).toEqual("Onion");
    expect(entry.passwordHash).toBeUndefined();
  });

  it("ordinary farmers cannot see the member directory", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoWithActiveMember(app, authRepository);
    const { token: strangerToken } = await registerAndLoginFarmer(app);

    const res = await request(app).get(`/api/fpos/${fpoId}/members`).set("Authorization", `Bearer ${strangerToken}`);
    expect(res.status).toEqual(403);
  });

  it("setupFarmerWithCrop helper actually attaches the crop (sanity check)", async () => {
    const { app } = buildTestApp();
    const { token } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID, area: 3, areaUnit: "ACRE" });
    const res = await request(app).get("/api/farmers/me/crops").set("Authorization", `Bearer ${token}`);
    expect(res.body.data.crops.length).toEqual(1);
  });
});
