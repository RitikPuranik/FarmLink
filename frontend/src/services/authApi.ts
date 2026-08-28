import { apiRequest, setAccessToken } from "@/lib/apiClient";
import { AuthUser } from "@/types/api";

export interface RegisterPayload {
  fullName: string;
  mobile: string;
  email?: string;
  password: string;
  preferredLanguage: "en" | "hi" | "mr";
}

export interface LoginPayload {
  mobile: string;
  password: string;
}

export const authApi = {
  async register(payload: RegisterPayload) {
    return apiRequest<{ user: AuthUser }>("/api/auth/register", { method: "POST", body: payload });
  },

  async login(payload: LoginPayload) {
    const data = await apiRequest<{ user: AuthUser; accessToken: string }>("/api/auth/login", {
      method: "POST",
      body: payload,
      skipAuthRetry: true,
    });
    setAccessToken(data.accessToken);
    return data.user;
  },

  async me() {
    return apiRequest<AuthUser>("/api/auth/me");
  },

  async logout() {
    await apiRequest<null>("/api/auth/logout", { method: "POST", skipAuthRetry: true });
    setAccessToken(null);
  },

  async logoutAll() {
    await apiRequest<null>("/api/auth/logout-all", { method: "POST" });
    setAccessToken(null);
  },

  async changePassword(currentPassword: string, newPassword: string) {
    return apiRequest<null>("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
    });
  },

  async forgotPassword(mobile: string) {
    return apiRequest<null>("/api/auth/forgot-password", {
      method: "POST",
      body: { mobile },
      skipAuthRetry: true,
    });
  },

  async resetPassword(token: string, newPassword: string) {
    return apiRequest<null>("/api/auth/reset-password", {
      method: "POST",
      body: { token, newPassword },
      skipAuthRetry: true,
    });
  },
};
