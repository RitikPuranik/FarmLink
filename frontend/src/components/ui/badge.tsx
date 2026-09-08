import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "accent";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  success: "bg-primary/10 text-primary",
  warning: "bg-warning/15 text-warning-foreground",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-blue-500/10 text-blue-700",
  accent: "bg-accent/15 text-accent-foreground",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold leading-none",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Best-effort status -> tone mapping shared across lots/offers/assessments/etc. */
export function toneForStatus(status: string): BadgeTone {
  const positive = ["AVAILABLE", "ACTIVE", "VERIFIED", "ACCEPTED", "COMPLETED", "APPROVED", "SUITABLE", "ELIGIBLE", "FRESH", "A"];
  const negative = ["CANCELLED", "REJECTED", "SUSPENDED", "WITHDRAWN", "EXPIRED", "UNSUITABLE", "UNAVAILABLE", "FULL", "OUTDATED", "REMOVED", "D", "INSUFFICIENT_DATA"];
  const warning = ["PENDING", "DRAFT", "PARTIALLY_COMMITTED", "UNDER_REVIEW", "LIMITED", "STALE", "CONDITIONALLY_SUITABLE", "RECENT", "B", "C", "COUNTERED", "UNKNOWN"];
  if (positive.includes(status)) return "success";
  if (negative.includes(status)) return "destructive";
  if (warning.includes(status)) return "warning";
  return "neutral";
}
