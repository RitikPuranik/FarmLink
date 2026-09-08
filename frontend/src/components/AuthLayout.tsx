import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { LogoMark } from "@/components/Logo";

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#15150f] text-[#f8f4e9]">
      <div className="grid min-h-screen lg:grid-cols-[0.92fr_1.08fr]">
        {/* Brand panel */}
        <section className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between bg-[#1c1b12] p-12 xl:p-16">
          <div className="absolute inset-0 opacity-30">
            <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-[#e3b23c]/10 blur-3xl" />
            <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-[#6f7d3c]/20 blur-3xl" />
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#15150f]/60 to-transparent" />
          </div>

          <div className="relative z-10">
            <Link href="/" className="inline-flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[#e3b23c]/30 bg-[#e3b23c]/10">
                <LogoMark className="h-6 w-6 text-[#e3b23c]" />
              </span>
              <span className="font-display text-2xl font-bold tracking-tight text-[#f8f4e9]">
                Anndata
              </span>
            </Link>
          </div>

          <div className="relative z-10 max-w-xl py-16">
            <p className="mb-5 text-xs font-bold uppercase tracking-[0.22em] text-[#e3b23c]">
              Rooted in farming. Built for the future.
            </p>
            <h2 className="text-4xl font-extrabold leading-[1.08] tracking-[-0.035em] text-[#f8f4e9] xl:text-6xl">
              Better decisions.
              <br />
              Better markets.
              <br />
              <span className="text-[#e3b23c]">Better farming.</span>
            </h2>
            <p className="mt-6 max-w-lg text-base leading-7 text-[#f8f4e9]/60">
              Anndata brings farm management, market intelligence, buyers and
              selling decisions together in one simple place.
            </p>
          </div>

          <div className="relative z-10 flex items-center gap-2 text-sm text-[#f8f4e9]/45">
            <ShieldCheck className="h-4 w-4 text-[#e3b23c]" />
            <span>Your account stays protected.</span>
          </div>
        </section>

        {/* Form panel */}
        <section className="flex min-h-screen flex-col bg-[#f8f4e9] text-[#1c1b12]">
          <div className="flex items-center justify-between px-5 py-5 sm:px-8 lg:justify-end lg:px-12">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#1c1b12]/55 transition-colors hover:text-[#1c1b12] lg:hidden"
            >
              <LogoMark className="h-5 w-5 text-[#6f7d3c]" />
              <span>Anndata</span>
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#1c1b12]/50 transition-colors hover:text-[#1c1b12]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to home
            </Link>
          </div>

          <div className="flex flex-1 items-center justify-center px-5 pb-12 pt-4 sm:px-8 lg:px-12 lg:pt-0">
            <div className="w-full max-w-[460px]">
              <div className="mb-8">
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1c1b12] shadow-lg shadow-[#1c1b12]/10">
                  <LogoMark className="h-6 w-6 text-[#e3b23c]" />
                </div>
                <h1 className="text-3xl font-extrabold tracking-[-0.035em] text-[#1c1b12] sm:text-4xl">
                  {title}
                </h1>
                {subtitle && (
                  <p className="mt-3 max-w-md text-base leading-6 text-[#1c1b12]/55">
                    {subtitle}
                  </p>
                )}
              </div>

              <div className="rounded-[24px] border border-[#1c1b12]/10 bg-white p-5 shadow-[0_18px_60px_rgba(32,35,28,0.08)] sm:p-7">
                {children}
              </div>

              {footer && (
                <div className="mt-6 text-center text-sm text-[#1c1b12]/55">
                  {footer}
                </div>
              )}
            </div>
          </div>

          <div className="px-5 pb-5 text-center text-xs text-[#1c1b12]/35 sm:px-8">
            © {new Date().getFullYear()} Anndata
          </div>
        </section>
      </div>
    </main>
  );
}
