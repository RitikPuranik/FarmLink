"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import LandingPage from "@/components/marketing/LandingPage";

export default function RootPage() {
  const { isAuthenticated, isLoading, homeRoute } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) router.replace(homeRoute);
  }, [isLoading, isAuthenticated, homeRoute, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#15150f]">
        <Loader2 className="h-8 w-8 animate-spin text-[#e3b23c]" aria-hidden />
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#15150f]">
        <Loader2 className="h-8 w-8 animate-spin text-[#e3b23c]" aria-hidden />
      </div>
    );
  }

  return <LandingPage />;
}
