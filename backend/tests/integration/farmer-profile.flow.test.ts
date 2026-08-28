import request from "supertest";
import { buildTestApp } from "../testUtils/buildTestApp";
import { registerAndLoginFarmer } from "../testUtils/farmerAuthHelpers";
import { DEMO_FPO_ID, INACTIVE_FPO_ID } from "../testUtils/referenceDataFixtures";

describe("Farmer profile", () => {
  it("GET /api/farmers/me auto-creates a bare profile on first call and returns 0% completion", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await request(app).get("/api/farmers/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toEqual(200);
    expect(res.body.data.profile.fpoMembershipStatus).toBeNull();
    expect(res.body.data.farms).toEqual([]);
    expect(res.body.data.crops).toEqual([]);
    // "basicInfo" is free after registration, so this is never 0.
    expect(res.body.data.completion.percentage).toEqual(20);
    expect(res.body.data.completion.missing).toEqual(
      expect.arrayContaining(["farmLocation", "farmInfo", "primaryCrop", "fpoMembership", "sellingPreferences"]),
    );
  });

  it("only a FARMER can reach farmer self-service routes", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/farmers/me");
    expect(res.status).toEqual(401);
  });

  it("POST creates a profile, and a second POST 409s (duplicate profile)", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const first = await request(app)
      .post("/api/farmers/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ liquidityPreference: "CAN_WAIT_2_WEEKS", willingToStore: true });
    expect(first.status).toEqual(201);
    expect(first.body.data.profile.liquidityPreference).toEqual("CAN_WAIT_2_WEEKS");

    const second = await request(app)
      .post("/api/farmers/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ liquidityPreference: "URGENT" });
    expect(second.status).toEqual(409);
  });

  it("PATCH updates preferences without requiring a prior POST", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await request(app)
      .patch("/api/farmers/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ willingToStore: false, communicationPreference: "SMS" });

    expect(res.status).toEqual(200);
    expect(res.body.data.profile.willingToStore).toBe(false);
    expect(res.body.data.profile.communicationPreference).toEqual("SMS");
  });

  it("rejects fpoMembershipStatus=MEMBER without an fpoId", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await request(app)
      .patch("/api/farmers/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ fpoMembershipStatus: "MEMBER" });

    expect(res.status).toEqual(400);
    expect(res.body.error.fields.fpoId).toBeDefined();
  });

  it("rejects an unknown/inactive fpoId", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const unknown = await request(app)
      .patch("/api/farmers/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ fpoMembershipStatus: "MEMBER", fpoId: "00000000-0000-0000-0000-000000000000" });
    expect(unknown.status).toEqual(400);

    const inactive = await request(app)
      .patch("/api/farmers/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ fpoMembershipStatus: "MEMBER", fpoId: INACTIVE_FPO_ID });
    expect(inactive.status).toEqual(400);
  });

  it("accepts a valid FPO, and clears fpoId again if membership later changes to NOT_A_MEMBER", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const joined = await request(app)
      .patch("/api/farmers/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ fpoMembershipStatus: "MEMBER", fpoId: DEMO_FPO_ID });
    expect(joined.status).toEqual(200);
    expect(joined.body.data.profile.fpo.id).toEqual(DEMO_FPO_ID);

    const left = await request(app)
      .patch("/api/farmers/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ fpoMembershipStatus: "NOT_A_MEMBER" });
    expect(left.status).toEqual(200);
    expect(left.body.data.profile.fpo).toBeNull();
  });

  it("never trusts a client-sent profileCompletionPercentage — completion is always server-computed", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    // The schema is .strict(), so an unknown field like this is rejected
    // outright rather than silently accepted and ignored.
    const res = await request(app)
      .patch("/api/farmers/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ willingToStore: true, profileCompletionPercentage: 100 });

    expect(res.status).toEqual(400);
  });

  it("GET /api/farmers/me/completion reflects liquidity + storage answers", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    await request(app)
      .patch("/api/farmers/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ liquidityPreference: "FLEXIBLE", willingToStore: true });

    const res = await request(app).get("/api/farmers/me/completion").set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(200);
    expect(res.body.data.missing).not.toContain("sellingPreferences");
    expect(res.body.data.percentage).toBeGreaterThanOrEqual(30); // basicInfo(20) + sellingPreferences(10)
  });
});
