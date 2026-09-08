import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { LogoMark } from "@/components/Logo";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#151515] px-4 py-6 text-[#242424] sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center justify-center">
        <section className="w-full max-w-[980px] overflow-hidden rounded-[30px] border border-white/10 bg-[#f8f4e9] shadow-[0_28px_100px_rgba(0,0,0,.35)]">
          <div className="grid lg:grid-cols-[.8fr_1.2fr]">
            <div className="relative hidden min-h-[620px] flex-col justify-between overflow-hidden bg-[#242424] p-10 text-[#f8f4e9] lg:flex xl:p-14">
              <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#d6b841]/10 blur-3xl" />
              <div className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-white/5 blur-3xl" />
              <Link href="/" className="relative z-10 inline-flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#d6b841] text-[#242424]"><LogoMark className="h-6 w-6" /></span>
                <span className="font-display text-2xl font-bold">Anndata</span>
              </Link>
              <div className="relative z-10">
                <p className="mb-4 text-xs font-bold uppercase tracking-[.2em] text-[#d6b841]">Every meal begins with a farmer.</p>
                <h2 className="text-5xl font-extrabold leading-[1.02] tracking-[-.04em] xl:text-6xl">Better decisions.<br/>Better markets.<br/><span className="text-[#d6b841]">Better farming.</span></h2>
                <p className="mt-6 max-w-md text-sm leading-6 text-white/55">Farm, market, quality, storage and trade intelligence — connected in one calm workspace.</p>
              </div>
              <div className="relative z-10 flex items-center gap-2 text-sm text-white/45"><ShieldCheck className="h-4 w-4 text-[#d6b841]"/>Secure account access</div>
            </div>
            <div className="bg-[#f8f4e9] px-5 py-6 sm:px-9 sm:py-9 lg:px-12 lg:py-12">
              <div className="mb-7 flex items-center justify-between">
                <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#242424]/55 hover:text-[#242424] lg:hidden"><LogoMark className="h-5 w-5 text-[#242424]"/>Anndata</Link>
                <Link href="/" className="ml-auto inline-flex items-center gap-2 text-sm font-semibold text-[#242424]/50 hover:text-[#242424]"><ArrowLeft className="h-4 w-4"/>Back to home</Link>
              </div>
              <div className="mx-auto w-full max-w-[470px]">
                <div className="mb-7"><div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#242424] text-[#d6b841]"><LogoMark className="h-6 w-6"/></div><h1 className="text-3xl font-extrabold tracking-[-.035em] sm:text-4xl">{title}</h1>{subtitle && <p className="mt-2 text-sm leading-6 text-[#242424]/55">{subtitle}</p>}</div>
                <div className="rounded-[24px] border border-[#242424]/10 bg-white p-5 shadow-[0_18px_60px_rgba(36,36,36,.08)] sm:p-7">{children}</div>
                {footer && <div className="mt-5 text-center text-sm text-[#242424]/55">{footer}</div>}
              </div>
            </div>
          </div>
          <div className="border-t border-[#242424]/10 bg-[#f8f4e9] px-5 py-3 text-center text-[11px] text-[#242424]/35">© {new Date().getFullYear()} Anndata</div>
        </section>
      </div>
    </main>
  );
}
