"use client";

import { createContext, use, useMemo } from "react";
import { type Dictionary, type Locale, loadZh, translate } from "@/lib/i18n";

const LocaleContext = createContext<{ locale: Locale; dict: Dictionary | null }>({ locale: "en", dict: null });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  // Only 中文 pages wait for the dictionary; English ones never load it.
  const dict = locale === "zh" ? use(loadZh()) : null;
  const value = useMemo(() => ({ locale, dict }), [locale, dict]);
  return <LocaleContext value={value}>{children}</LocaleContext>;
}

export function useLocale() {
  return use(LocaleContext).locale;
}

/** `const t = useT(); t("Save")` in client components. */
export function useT() {
  const { dict } = use(LocaleContext);
  return (text: string, vars?: Record<string, string | number>) => translate(dict, text, vars);
}

/** `<T>Save</T>`: translated text that works inside server and client components alike. */
export function T({ children, vars }: { children: string; vars?: Record<string, string | number> }) {
  return translate(use(LocaleContext).dict, children, vars);
}

/** Translates its content when it's plain text (a label from a list, a formatted date…), else shows it as is. */
export function Tx({ children }: { children?: React.ReactNode }) {
  const { dict } = use(LocaleContext);
  return typeof children === "string" ? translate(dict, children) : children;
}
