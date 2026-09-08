import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) { return <label className={cn("field-label", className)} {...props} />; }
export function FieldError({ children }: { children?: string }) { return children ? <p role="alert" className="field-error">{children}</p> : null; }
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("surface-card", className)} {...props} />; }
const alertClasses = { error: "alert-error", success: "alert-success", info: "alert-info" };
export function Alert({ variant = "info", className, children }: { variant?: "error" | "success" | "info"; className?: string; children: React.ReactNode }) { return <div role={variant === "error" ? "alert" : "status"} className={cn("alert-box", alertClasses[variant], className)}>{children}</div>; }
