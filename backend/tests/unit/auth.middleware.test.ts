import { Request, Response } from "express";
import { createAuthMiddleware } from "../../src/modules/auth/auth.middleware";
import { signAccessToken } from "../../src/modules/auth/auth.utils";
import { AuthenticationError, AuthorizationError } from "../../src/common/errors";
import { InMemoryAuthRepository } from "../testUtils/inMemoryAuthRepository";
import { FakeAuditService } from "../testUtils/fakeAuditService";

function fakeReq(headers: Record<string, string> = {}): Request {
  return { headers, ip: "127.0.0.1", originalUrl: "/api/admin/users" } as unknown as Request;
}

const fakeRes = {} as Response;

describe("authenticate()", () => {
  it("rejects a request with no Authorization header", async () => {
    const repo = new InMemoryAuthRepository();
    const { authenticate } = createAuthMiddleware(repo);
    const next = jest.fn();

    await authenticate(fakeReq(), fakeRes, next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
  });

  it("rejects an invalid/garbage token", async () => {
    const repo = new InMemoryAuthRepository();
    const { authenticate } = createAuthMiddleware(repo);
    const next = jest.fn();

    await authenticate(fakeReq({ authorization: "Bearer not-a-real-jwt" }), fakeRes, next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
  });

  it("rejects a token for a user that no longer exists", async () => {
    const repo = new InMemoryAuthRepository();
    const token = signAccessToken({ id: "ghost-id", publicId: "ghost-public", role: "FARMER" });
    const { authenticate } = createAuthMiddleware(repo);
    const next = jest.fn();

    await authenticate(fakeReq({ authorization: `Bearer ${token}` }), fakeRes, next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
  });

  it("rejects a valid token belonging to a SUSPENDED account", async () => {
    const repo = new InMemoryAuthRepository();
    const user = repo.seedUser({ mobile: "9876543210", passwordHash: "x", accountStatus: "SUSPENDED" });
    const token = signAccessToken({ id: user.id, publicId: user.publicId, role: "FARMER" });
    const { authenticate } = createAuthMiddleware(repo);
    const next = jest.fn();
    const req = fakeReq({ authorization: `Bearer ${token}` });

    await authenticate(req, fakeRes, next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    expect(req.user).toBeUndefined();
  });

  it("rejects a valid token belonging to a DEACTIVATED account", async () => {
    const repo = new InMemoryAuthRepository();
    const user = repo.seedUser({ mobile: "9876543211", passwordHash: "x", accountStatus: "DEACTIVATED" });
    const token = signAccessToken({ id: user.id, publicId: user.publicId, role: "FARMER" });
    const { authenticate } = createAuthMiddleware(repo);
    const next = jest.fn();

    await authenticate(fakeReq({ authorization: `Bearer ${token}` }), fakeRes, next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
  });

  it("attaches only a sanitized user context on success", async () => {
    const repo = new InMemoryAuthRepository();
    const user = repo.seedUser({ mobile: "9876543212", passwordHash: "x", accountStatus: "ACTIVE" });
    const token = signAccessToken({ id: user.id, publicId: user.publicId, role: "FARMER" });
    const { authenticate } = createAuthMiddleware(repo);
    const next = jest.fn();
    const req = fakeReq({ authorization: `Bearer ${token}` });

    await authenticate(req, fakeRes, next);

    expect(next).toHaveBeenCalledWith(); // called with no error
    expect(req.user).toEqual({ id: user.id, publicId: user.publicId, role: "FARMER" });
    expect(req.user).not.toHaveProperty("passwordHash");
  });
});

describe("requireRole() / requireAnyRole()", () => {
  it("blocks a FARMER from an ADMIN-only route", () => {
    const repo = new InMemoryAuthRepository();
    const audit = new FakeAuditService();
    const { requireRole } = createAuthMiddleware(repo, audit);
    const next = jest.fn();
    const req = fakeReq();
    req.user = { id: "u1", publicId: "p1", role: "FARMER" };

    requireRole("ADMIN")(req, fakeRes, next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
  });

  it("allows an ADMIN through an ADMIN-only route", () => {
    const repo = new InMemoryAuthRepository();
    const { requireRole } = createAuthMiddleware(repo);
    const next = jest.fn();
    const req = fakeReq();
    req.user = { id: "u1", publicId: "p1", role: "ADMIN" };

    requireRole("ADMIN")(req, fakeRes, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("requireAnyRole allows any of the listed roles", () => {
    const repo = new InMemoryAuthRepository();
    const { requireAnyRole } = createAuthMiddleware(repo);
    const next = jest.fn();
    const req = fakeReq();
    req.user = { id: "u1", publicId: "p1", role: "BUYER" };

    requireAnyRole("ADMIN", "BUYER", "FPO_ADMIN")(req, fakeRes, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("rejects when there is no authenticated user at all", () => {
    const repo = new InMemoryAuthRepository();
    const { requireRole } = createAuthMiddleware(repo);
    const next = jest.fn();

    requireRole("ADMIN")(fakeReq(), fakeRes, next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
  });

  it("records an AUTHORIZATION_DENIED audit event on a 403", () => {
    const repo = new InMemoryAuthRepository();
    const audit = new FakeAuditService();
    const { requireRole } = createAuthMiddleware(repo, audit);
    const next = jest.fn();
    const req = fakeReq();
    req.user = { id: "u1", publicId: "p1", role: "FARMER" };

    requireRole("ADMIN")(req, fakeRes, next);

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0].action).toEqual("AUTHORIZATION_DENIED");
  });
});
