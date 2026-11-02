"use client";

import { createContext, use } from "react";
import { type Locale, translate } from "@/lib/i18n";

const LocaleContext = createContext<Locale>("en");

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useLocale() {
  return use(LocaleContext);
}

/** `const t = useT(); t("Save")` in client components. */
export function useT() {
  const locale = use(LocaleContext);
  return (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
}

/** `<T>Save</T>`: translated text that works inside server and client components alike. */
export function T({ children, vars }: { children: string; vars?: Record<string, string | number> }) {
  const locale = use(LocaleContext);
  return translate(locale, children, vars);
}

/** Translates its content when it's plain text (a label from a list, a formatted date…), else shows it as is. */
export function Tx({ children }: { children?: React.ReactNode }) {
  const locale = use(LocaleContext);
  return typeof children === "string" ? translate(locale, children) : children;
}
