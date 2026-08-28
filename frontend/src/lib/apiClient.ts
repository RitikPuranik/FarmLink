import { ApiRequestError, ApiResponse } from "@/types/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Held in module scope (not localStorage/sessionStorage — see auth.utils.ts
// on the backend for why refresh tokens are httpOnly-cookie-only). This is
// intentionally simple: a page reload clears it, and getCurrentUser() on
// mount re-establishes it via the refresh cookie.
let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  skipAuthRetry?: boolean;
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    credentials: "include", // sends the httpOnly refresh cookie
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;

  if (!json) {
    throw new ApiRequestError(
      res.status,
      "NETWORK_ERROR",
      "We couldn't connect to the server. Please try again.",
    );
  }

  if (!json.success) {
    throw new ApiRequestError(res.status, json.error.code, json.error.message, json.error.fields);
  }

  return json.data;
}

/**
 * On a 401, attempt exactly one refresh (deduplicated across concurrent
 * requests via refreshInFlight) and retry the original request once. Never
 * retries a second time — that's how infinite refresh loops happen (spec
 * section 47).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (err) {
    const isAuthError = err instanceof ApiRequestError && err.status === 401;
    if (!isAuthError || options.skipAuthRetry) throw err;

    if (!refreshInFlight) {
      refreshInFlight = refreshSession().finally(() => {
        refreshInFlight = null;
      });
    }
    const refreshed = await refreshInFlight;
    if (!refreshed) throw err;

    return rawRequest<T>(path, { ...options, skipAuthRetry: true });
  }
}

async function refreshSession(): Promise<boolean> {
  try {
    const data = await rawRequest<{ accessToken: string }>("/api/auth/refresh", {
      method: "POST",
      skipAuthRetry: true,
    });
    setAccessToken(data.accessToken);
    return true;
  } catch {
    setAccessToken(null);
    return false;
  }
}
