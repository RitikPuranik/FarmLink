"use client";

import * as React from "react";
import Link from "next/link";
import { Leaf } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { cn } from "@/lib/utils";

/**
 * The one navbar used across the whole logged-out -> logged-in journey:
 * landing page, login/register/forgot/reset password, and the signed-in
 * app shell. Brand always on the left, language switcher always in the
 * same spot on the right, plus an optional `right` slot for page-specific
 * actions (e.g. the logout button on authenticated pages).
 */
export function SiteHeader({ right, className }: { right?: React.ReactNode; className?: string }) {
  const { t } = useI18n();

  return (
    <header className={cn("border-b border-border bg-card", className)}>
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-primary">
          <Leaf className="h-5 w-5" aria-hidden />
          {t("app.name")}
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          {right}
        </div>
      </div>
    </header>
  );
}
