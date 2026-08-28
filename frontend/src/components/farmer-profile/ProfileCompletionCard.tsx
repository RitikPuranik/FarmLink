"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Card } from "@/components/ui/primitives";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ProfileCompletion } from "@/types/farmer";

export function ProfileCompletionCard({
  completion,
  showLinkToProfile,
}: {
  completion: ProfileCompletion;
  showLinkToProfile?: boolean;
}) {
  const { t } = useI18n();
  const isComplete = completion.percentage >= 100;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t("completion.title")}</h2>
        {isComplete && (
          <span className="flex items-center gap-1 text-sm font-medium text-primary">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {t("completion.complete")}
          </span>
        )}
      </div>

      <p className="mt-1 text-2xl font-semibold">{completion.percentage}%</p>
      <ProgressBar value={completion.percentage} className="mt-2" />

      {!isComplete && completion.missing.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-muted-foreground">{t("completion.missing")}</p>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {completion.missing.map((key) => (
              <li key={key}>{t(`completion.missingItem.${key}`)}</li>
            ))}
          </ul>
        </div>
      )}

      {showLinkToProfile && !isComplete && (
        <Link
          href="/profile"
          className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
        >
          {t("completion.completeProfile")} →
        </Link>
      )}
    </Card>
  );
}
