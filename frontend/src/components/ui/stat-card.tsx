import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({ label, value, hint, icon, href, tone = "default", dataTour }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode; href?: string; tone?: "default" | "accent" | "warning"; dataTour?: string }) {
  const content = <div data-tour={dataTour} className={cn("stat-card", tone === "accent" && "accent", tone === "warning" && "warning")}>
    <div className="stat-top"><span>{label}</span>{icon && <span className="stat-icon">{icon}</span>}</div>
    <strong>{value}</strong>{hint && <small>{hint}</small>}{href && <span className="stat-link">Open <ArrowUpRight className="h-3.5 w-3.5" /></span>}
  </div>;
  return href ? <Link href={href} className="block h-full">{content}</Link> : content;
}

export function PageHeader({ title, description, actions, breadcrumb }: { title: string; description?: string; actions?: React.ReactNode; breadcrumb?: React.ReactNode }) {
  return <div className="page-header"><div>{breadcrumb && <div className="breadcrumb">{breadcrumb}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

export function QuickLinkCard({ title, description, icon, href }: { title: string; description: string; icon: React.ReactNode; href: string }) {
  return <Link href={href} className="quick-card"><span className="quick-icon">{icon}</span><span className="quick-copy"><b>{title}</b><small>{description}</small></span><ArrowRight className="quick-arrow" /></Link>;
}
