"use client";

import * as React from "react";
import { Globe, ChevronDown } from "lucide-react";
import { useI18n, SupportedLanguage } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

const LANGUAGES: { code: SupportedLanguage; label: string }[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "mr", label: "मराठी" },
];

export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, setLanguage } = useI18n();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-bold uppercase tracking-wider backdrop-blur-md transition-all duration-300"
      >
        <Globe className="h-3.5 w-3.5" aria-hidden />
        {current.code}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-36 overflow-hidden rounded-xl border py-1 shadow-2xl"
        >
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              role="menuitem"
              onClick={() => {
                setLanguage(l.code);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-white/10",
                l.code === language ? "font-semibold" : "font-normal opacity-80",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
