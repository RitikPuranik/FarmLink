import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { AuthenticationError } from "../../common/errors";
import { AuthService } from "./auth.service";
import {
  ChangePasswordRequestBody,
  ForgotPasswordRequestBody,
  LoginRequestBody,
  RegisterRequestBody,
  ResetPasswordRequestBody,
} from "./auth.schemas";
import { REFRESH_COOKIE_NAME, clearRefreshCookie, hashToken, setRefreshCookie } from "./auth.utils";
import { RequestMeta } from "./auth.types";

function meta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

export function createAuthController(authService: AuthService) {
  async function register(req: Request, res: Response) {
    const body = req.body as RegisterRequestBody;
    const { user } = await authService.register(
      {
        fullName: body.fullName,
        mobile: body.mobile,
        email: body.email,
        password: body.password,
        preferredLanguage: body.preferredLanguage,
      },
      meta(req),
    );
    return sendSuccess(res, { user }, "Account created successfully.", 201);
  }

  async function login(req: Request, res: Response) {
    const body = req.body as LoginRequestBody;
    const { user, tokens } = await authService.login(body, meta(req));
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
    return sendSuccess(res, { user, accessToken: tokens.accessToken }, "Logged in successfully.");
  }

  async function refresh(req: Request, res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!rawRefreshToken) {
      throw new AuthenticationError("Your session has expired. Please log in again.");
    }
    const { user, tokens } = await authService.refreshSession(rawRefreshToken, meta(req));
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
    return sendSuccess(res, { user, accessToken: tokens.accessToken }, "Session refreshed.");
  }

  async function me(req: Request, res: Response) {
    const user = await authService.getCurrentUser(req.user!.id);
    return sendSuccess(res, user, "Current user retrieved.");
  }

  async function logout(req: Request, res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    await authService.logout(rawRefreshToken);
    clearRefreshCookie(res);
    return sendSuccess(res, null, "Logged out successfully.");
  }

  async function logoutAll(req: Request, res: Response) {
    await authService.logoutAll(req.user!.id, meta(req));
    clearRefreshCookie(res);
    return sendSuccess(res, null, "Logged out of all sessions.");
  }

  async function changePassword(req: Request, res: Response) {
    const body = req.body as ChangePasswordRequestBody;
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    const currentSessionTokenHash = rawRefreshToken ? hashToken(rawRefreshToken) : undefined;

    await authService.changePassword(
      req.user!.id,
      body.currentPassword,
      body.newPassword,
      currentSessionTokenHash,
      meta(req),
    );
    return sendSuccess(res, null, "Password changed successfully.");
  }

  async function forgotPassword(req: Request, res: Response) {
    const body = req.body as ForgotPasswordRequestBody;
    await authService.requestPasswordReset(body.mobile, meta(req));
    // Always the same response, regardless of whether the account exists.
    return sendSuccess(res, null, "If an account exists, reset instructions have been sent.");
  }

  async function resetPassword(req: Request, res: Response) {
    const body = req.body as ResetPasswordRequestBody;
    await authService.resetPassword(body.token, body.newPassword, meta(req));
    return sendSuccess(res, null, "Password has been reset. Please log in with your new password.");
  }

  return { register, login, refresh, me, logout, logoutAll, changePassword, forgotPassword, resetPassword };
}
