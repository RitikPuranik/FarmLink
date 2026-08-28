import request from "supertest";
import { buildTestApp } from "../testUtils/buildTestApp";
import { hashPassword } from "../../src/modules/auth/auth.utils";

const FARMER_REGISTRATION = {
  fullName: "Ramesh Patil",
  mobile: "9876543210",
  password: "SecurePassword123",
  preferredLanguage: "en",
};

async function loginAsFarmer(app: import("express").Express) {
  await request(app).post("/api/auth/register").send(FARMER_REGISTRATION);
  const res = await request(app)
    .post("/api/auth/login")
    .send({ mobile: FARMER_REGISTRATION.mobile, password: FARMER_REGISTRATION.password });
  return res.body.data.accessToken as string;
}

async function seedAdmin(authRepository: import("../testUtils/inMemoryAuthRepository").InMemoryAuthRepository) {
  const passwordHash = await hashPassword("AdminPassword123");
  return authRepository.seedUser({
    mobile: "9000000000",
    passwordHash,
    role: "ADMIN",
    accountStatus: "ACTIVE",
  });
}

describe("SECURITY: role-based access control", () => {
  it("a FARMER cannot access an ADMIN-only endpoint (403, not 404 or 500)", async () => {
    const { app } = buildTestApp();
    const token = await loginAsFarmer(app);

    const res = await request(app).get("/api/admin/users").set("Authorization", `Bearer ${token}`);

    expect(res.status).toEqual(403);
    expect(res.body.error.code).toEqual("AUTHORIZATION_ERROR");
  });

  it("an unauthenticated caller gets 401, not 403, from an ADMIN-only endpoint", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toEqual(401);
  });

  it("an ADMIN can access the ADMIN-only endpoint", async () => {
    const { app, authRepository } = buildTestApp();
    await seedAdmin(authRepository);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ mobile: "9000000000", password: "AdminPassword123" });
    expect(loginRes.status).toEqual(200);

    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${loginRes.body.data.accessToken}`);

    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body.data.users)).toBe(true);
  });

  it("a raw cURL-style request with a forged role in a header is ignored — role always comes from the verified token", async () => {
    const { app } = buildTestApp();
    const token = await loginAsFarmer(app);

    const res = await request(app)
      .get("/api/admin/users")
      // Attempt to smuggle a privileged role via a header the backend never reads for authz.
      .set("Authorization", `Bearer ${token}`)
      .set("X-User-Role", "ADMIN")
      .set("X-Role", "ADMIN");

    expect(res.status).toEqual(403);
  });

  it("a suspended user's still-valid access token is rejected on a protected endpoint", async () => {
    const { app, authRepository } = buildTestApp();
    const token = await loginAsFarmer(app);
    const user = authRepository.users[0];
    await authRepository.updateAccountStatus(user.id, "SUSPENDED");

    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

    expect([401, 403]).toContain(res.status);
  });
});

describe("SECURITY: privilege escalation prevention", () => {
  it("there is no generic PATCH /api/users/:userId endpoint a client could use to rewrite their own role", async () => {
    const { app } = buildTestApp();
    const token = await loginAsFarmer(app);

    const res = await request(app)
      .patch("/api/users/some-other-user-id")
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "ADMIN" });

    expect(res.status).toEqual(404);
  });

  it("register never assigns a client-requested role even when disguised as extra JSON keys", async () => {
    const { app, authRepository } = buildTestApp();
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        ...FARMER_REGISTRATION,
        mobile: "9123456780",
        role: "ADMIN",
        isAdmin: true,
        accountStatus: "ACTIVE",
      });

    // Whole request rejected — nothing gets created with an escalated role.
    expect(res.status).toEqual(400);
    expect(authRepository.users.find((u) => u.mobile === "9123456780")).toBeUndefined();
  });
});

describe("SECURITY: input sanitization", () => {
  it("rejects an oversized request body instead of processing it", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...FARMER_REGISTRATION, fullName: "A".repeat(200_000) });

    // Either the body-size limit (413) or field validation (400) — never a 500.
    expect([400, 413]).toContain(res.status);
    expect(res.status).not.toEqual(500);
  });

  it("does not choke on a prototype-pollution-style payload", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/auth/register")
      .send(JSON.parse('{"__proto__": {"polluted": true}, "fullName": "X", "mobile": "9876500000", "password": "SecurePassword123"}'));

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(res.status).not.toEqual(500);
  });
});
