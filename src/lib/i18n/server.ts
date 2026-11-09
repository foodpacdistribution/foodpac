import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { isLocale, loadZh, type Locale, LOCALE_COOKIE, translate, URL_LOCALE_HEADER, zhPath } from "./index";

/**
 * The language the address itself asks for: "zh" on /zh/… pages (the proxy rewrites them to the
 * normal page and sets this header), otherwise null. Search engines index each language here.
 */
export const getUrlLocale = cache(async (): Promise<Locale | null> => {
  const v = (await headers()).get(URL_LOCALE_HEADER);
  return isLocale(v) ? v : null;
});

/** The visitor's language: the /zh address if they're on one, else their saved choice (cookie). */
export const getLocale = cache(async (): Promise<Locale> => {
  const fromUrl = await getUrlLocale();
  if (fromUrl) return fromUrl;
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : "en";
});

/**
 * Canonical address and language alternates (hreflang) for a public page, so Google indexes the
 * English page and its /zh twin as one page in two languages.
 */
export async function languageAlternates(path: string) {
  const zh = (await getUrlLocale()) === "zh";
  return { canonical: zh ? zhPath(path) : path, languages: { "en-AU": path, "zh-CN": zhPath(path), "x-default": path } };
}

/** Translator for server code that needs a plain string (metadata, emails…). */
export async function getT() {
  const locale = await getLocale();
  const dict = locale === "zh" ? await loadZh() : null;
  return (text: string, vars?: Record<string, string | number>) => translate(dict, text, vars);
}
