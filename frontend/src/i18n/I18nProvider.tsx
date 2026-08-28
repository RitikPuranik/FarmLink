"use client";

import * as React from "react";
import en from "@/i18n/en.json";
import hi from "@/i18n/hi.json";
import mr from "@/i18n/mr.json";

export type SupportedLanguage = "en" | "hi" | "mr";

const dictionaries: Record<SupportedLanguage, Record<string, string>> = { en, hi, mr };

const LANGUAGE_STORAGE_KEY = "farmlink.language";

interface I18nContextValue {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (key: string, vars?: Record<string, string>) => string;
}

const I18nContext = React.createContext<I18nContextValue | undefined>(undefined);

function interpolate(template: string, vars?: Record<string, string>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = React.useState<SupportedLanguage>("en");

  React.useEffect(() => {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "hi" || stored === "mr") {
      setLanguageState(stored);
    }
  }, []);

  const setLanguage = React.useCallback((lang: SupportedLanguage) => {
    setLanguageState(lang);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }, []);

  const t = React.useCallback(
    (key: string, vars?: Record<string, string>) => {
      const dict = dictionaries[language] ?? dictionaries.en;
      const template = dict[key] ?? dictionaries.en[key] ?? key;
      return interpolate(template, vars);
    },
    [language],
  );

  const value = React.useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within an I18nProvider");
  return ctx;
}
