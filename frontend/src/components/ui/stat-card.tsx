import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  href?: string;
  tone?: "default" | "accent" | "warning";
}) {
  const toneRing =
    tone === "accent" ? "bg-accent/15 text-accent-foreground" : tone === "warning" ? "bg-warning/15 text-warning-foreground" : "bg-primary/10 text-primary";

  const content = (
    <div className="group flex h-full flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        {icon && <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", toneRing)}>{icon}</span>}
      </div>
      <div className="mt-3">
        <div className="text-3xl font-bold tracking-tight text-foreground">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {href && (
        <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-primary opacity-80 transition-opacity group-hover:opacity-100">
          View <ArrowRight className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {content}
      </Link>
    );
  }
  return content;
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {breadcrumb && <div className="mb-1.5 text-sm text-muted-foreground">{breadcrumb}</div>}
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function QuickLinkCard({
  title,
  description,
  icon,
  href,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          {title}
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}
