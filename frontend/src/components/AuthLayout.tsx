"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { SiteHeader } from "@/components/layout/SiteHeader";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="auth-page">
        <div className="auth-shell">
          <section className="auth-form-side">
            <div className="auth-form-top">
              <Link href="/" className="mobile-brand"><span><LogoMark className="h-5 w-5" /></span> Anndata</Link>
              <Link href="/" className="back-home"><ArrowLeft className="h-4 w-4" /> Home</Link>
            </div>
            <div className="auth-form-wrap">
              <div className="auth-heading">
                <span className="mobile-form-mark"><LogoMark className="h-6 w-6" /></span>
                <p className="auth-kicker">Anndata</p>
                <h1>{title}</h1>
                {subtitle && <p>{subtitle}</p>}
              </div>
              <div className="auth-card">{children}</div>
              {footer && <div className="auth-footer">{footer}</div>}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

