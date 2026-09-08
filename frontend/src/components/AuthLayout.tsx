"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/Logo";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-shell">
        <aside className="auth-visual">
          <Link href="/" className="auth-brand">
            <span className="auth-brand-mark"><LogoMark className="h-6 w-6" /></span>
            <span>Anndata</span>
          </Link>
          <div className="auth-story auth-story-simple">
            <div className="auth-big-mark"><LogoMark className="h-14 w-14" /></div>
            <h2>Better farm decisions.<br /><em>Made simple.</em></h2>
            <div className="auth-mini-pills">
              <span>Prices</span><span>Buyers</span><span>Sales</span>
            </div>
          </div>
        </aside>

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
  );
}
