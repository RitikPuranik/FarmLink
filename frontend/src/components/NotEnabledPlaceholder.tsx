"use client";

import { useI18n } from "@/i18n/I18nProvider";

export function NotEnabledPlaceholder() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4 text-center">
      <p className="text-lg text-muted-foreground">{t("dashboard.notEnabled")}</p>
    </div>
  );
}
