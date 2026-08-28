"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/hooks/useAuth";
import { UserRole } from "@/types/api";

/**
 * Renders `children` only when the authenticated user's role matches
 * `role`. Anyone else authenticated gets bounced to their own home route
 * (spec section 31 — role-aware routing) rather than seeing another role's
 * placeholder. This is UX-layer only; the backend independently enforces
 * the real authorization boundary on every API call.
 */
export function RoleProtectedPage({ role, children }: { role: UserRole; children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <RoleCheck role={role}>
        <TopNav />
        {children}
      </RoleCheck>
    </ProtectedRoute>
  );
}

function RoleCheck({ role, children }: { role: UserRole; children: React.ReactNode }) {
  const { user, homeRoute } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (user && user.role !== role) {
      router.replace(homeRoute);
    }
  }, [user, role, homeRoute, router]);

  if (!user || user.role !== role) return null;
  return <>{children}</>;
}
