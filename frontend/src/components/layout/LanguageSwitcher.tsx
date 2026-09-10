"use client";

import * as React from "react";
import { Globe, ChevronDown, Search, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { LANGUAGE_OPTIONS } from "@/i18n/languages";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, setLanguage, isTranslating } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  React.useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const current = LANGUAGE_OPTIONS.find((l) => l.code === language) ?? {
    code: language,
    englishName: language.toUpperCase(),
    nativeName: language.toUpperCase(),
  };

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGUAGE_OPTIONS;
    return LANGUAGE_OPTIONS.filter(
      (l) =>
        l.englishName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div ref={ref} className={cn("relative inline-block", className)} translate="no">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-bold uppercase tracking-wider backdrop-blur-md transition-all duration-300"
      >
        {isTranslating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Globe className="h-3.5 w-3.5" aria-hidden />
        )}
        {current.code}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-xl border shadow-2xl backdrop-blur-md"
        >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search language…"
              className="w-full bg-transparent text-sm outline-none placeholder:opacity-60"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3.5 py-3 text-sm opacity-60">No language found.</div>
            )}
            {filtered.map((l) => (
              <button
                key={l.code}
                role="menuitem"
                onClick={() => {
                  setLanguage(l.code);
                  setOpen(false);
                  setQuery("");
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-white/10",
                  l.code === language ? "font-semibold" : "font-normal opacity-80",
                )}
              >
                <span>{l.nativeName}</span>
                <span className="text-xs opacity-60">{l.englishName}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
