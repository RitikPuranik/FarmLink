import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("mb-1.5 block text-sm font-medium text-foreground", className)} {...props} />
  );
}

export function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 text-sm text-destructive">
      {children}
    </p>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8", className)}
      {...props}
    />
  );
}

type AlertVariant = "error" | "success" | "info";

const alertClasses: Record<AlertVariant, string> = {
  error: "bg-destructive/10 text-destructive border-destructive/20",
  success: "bg-primary/10 text-primary border-primary/20",
  info: "bg-secondary text-secondary-foreground border-border",
};

export function Alert({
  variant = "info",
  className,
  children,
}: {
  variant?: AlertVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn("rounded-lg border px-4 py-3 text-sm", alertClasses[variant], className)}
    >
      {children}
    </div>
  );
}
