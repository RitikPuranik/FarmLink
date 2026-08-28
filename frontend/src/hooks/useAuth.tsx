"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi, LoginPayload, RegisterPayload } from "@/services/authApi";
import { AuthUser } from "@/types/api";
import { ROLE_HOME_ROUTE } from "@/lib/roleRouting";

const ME_QUERY_KEY = ["auth", "me"];

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<AuthUser>;
  register: (payload: RegisterPayload) => Promise<AuthUser>;
  logout: () => Promise<void>;
  homeRoute: string;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // On first mount there's no in-memory access token yet — apiClient's
  // 401-retry-with-refresh path (lib/apiClient.ts) transparently uses the
  // httpOnly refresh cookie to re-establish the session, or fails cleanly
  // if there isn't one. Either way this resolves to a single, unambiguous
  // "authenticated" boolean — never contradictory state across the app.
  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: authApi.me,
    retry: false,
    staleTime: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (user) => queryClient.setQueryData(ME_QUERY_KEY, user),
  });

  const registerMutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (result) => result.user,
  });

  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => queryClient.setQueryData(ME_QUERY_KEY, null),
  });

  const user = meQuery.data ?? null;

  const value: AuthContextValue = {
    user,
    isAuthenticated: !!user,
    isLoading: meQuery.isLoading,
    login: (payload) => loginMutation.mutateAsync(payload),
    register: async (payload) => (await registerMutation.mutateAsync(payload)).user,
    logout: () => logoutMutation.mutateAsync(),
    homeRoute: user ? ROLE_HOME_ROUTE[user.role] : "/login",
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
