import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import {
  changePasswordRateLimiter,
  loginRateLimiter,
  passwordResetRateLimiter,
  registerRateLimiter,
} from "../../middleware/rateLimiters";
import { AuthService } from "./auth.service";
import { createAuthMiddleware } from "./auth.middleware";
import { AuthRepository } from "./auth.repository";
import { AuditService } from "../audit/audit.service";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerRequestSchema,
  resetPasswordSchema,
} from "./auth.schemas";
import { createAuthController } from "./auth.controller";

export function createAuthRouter(authService: AuthService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createAuthController(authService);
  const { authenticate } = createAuthMiddleware(repo, audit);

  /**
   * @openapi
   * /api/auth/register:
   *   post:
   *     summary: Register a new farmer account
   *     description: Public registration always assigns role=FARMER server-side. The client cannot request a different role.
   *     tags: [Auth]
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [fullName, mobile, password]
   *             properties:
   *               fullName: { type: string }
   *               mobile: { type: string, example: "9876543210" }
   *               email: { type: string }
   *               password: { type: string, format: password }
   *               preferredLanguage: { type: string, enum: [en, hi, mr] }
   *     responses:
   *       201: { description: Account created, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: Mobile or email already registered, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/register",
    registerRateLimiter(),
    validateBody(registerRequestSchema),
    asyncHandler(controller.register),
  );

  /**
   * @openapi
   * /api/auth/login:
   *   post:
   *     summary: Log in with mobile number and password
   *     tags: [Auth]
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [mobile, password]
   *             properties:
   *               mobile: { type: string }
   *               password: { type: string, format: password }
   *     responses:
   *       200: { description: Logged in, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Invalid credentials or blocked account, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/login", loginRateLimiter(), validateBody(loginSchema), asyncHandler(controller.login));

  /**
   * @openapi
   * /api/auth/refresh:
   *   post:
   *     summary: Exchange the refresh session cookie for a new access token
   *     tags: [Auth]
   *     security: []
   *     responses:
   *       200: { description: Session refreshed, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Refresh session invalid or expired, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/refresh", asyncHandler(controller.refresh));

  /**
   * @openapi
   * /api/auth/me:
   *   get:
   *     summary: Get the authenticated user's profile
   *     tags: [Auth]
   *     responses:
   *       200: { description: Current user, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Not authenticated, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/me", authenticate, asyncHandler(controller.me));

  /**
   * @openapi
   * /api/auth/logout:
   *   post:
   *     summary: Log out the current session (idempotent)
   *     tags: [Auth]
   *     security: []
   *     responses:
   *       200: { description: Logged out, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.post("/logout", asyncHandler(controller.logout));

  /**
   * @openapi
   * /api/auth/logout-all:
   *   post:
   *     summary: Revoke every active session for the authenticated user
   *     tags: [Auth]
   *     responses:
   *       200: { description: All sessions revoked, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Not authenticated, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/logout-all", authenticate, asyncHandler(controller.logoutAll));

  /**
   * @openapi
   * /api/auth/change-password:
   *   post:
   *     summary: Change the authenticated user's password
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [currentPassword, newPassword]
   *             properties:
   *               currentPassword: { type: string, format: password }
   *               newPassword: { type: string, format: password }
   *     responses:
   *       200: { description: Password changed, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Validation error / wrong current password, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       401: { description: Not authenticated, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/change-password",
    authenticate,
    changePasswordRateLimiter(),
    validateBody(changePasswordSchema),
    asyncHandler(controller.changePassword),
  );

  /**
   * @openapi
   * /api/auth/forgot-password:
   *   post:
   *     summary: Request a password reset (response is identical whether or not the account exists)
   *     tags: [Auth]
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [mobile]
   *             properties:
   *               mobile: { type: string }
   *     responses:
   *       200: { description: Generic acknowledgement, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.post(
    "/forgot-password",
    passwordResetRateLimiter(),
    validateBody(forgotPasswordSchema),
    asyncHandler(controller.forgotPassword),
  );

  /**
   * @openapi
   * /api/auth/reset-password:
   *   post:
   *     summary: Complete a password reset using a single-use token
   *     tags: [Auth]
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [token, newPassword]
   *             properties:
   *               token: { type: string }
   *               newPassword: { type: string, format: password }
   *     responses:
   *       200: { description: Password reset, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid or expired token, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/reset-password",
    passwordResetRateLimiter(),
    validateBody(resetPasswordSchema),
    asyncHandler(controller.resetPassword),
  );

  return router;
}
