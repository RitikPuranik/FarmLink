"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/layout/SiteHeader";

export function TopNav() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = React.useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      router.push("/login");
    }
  }

  return (
    <SiteHeader
      right={
        user && (
          <Button
            variant="ghost"
            className="w-auto px-3 py-2 text-sm"
            isLoading={loggingOut}
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {t("nav.logout")}
          </Button>
        )
      }
    />
  );
}
