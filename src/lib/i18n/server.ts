import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { isLocale, type Locale, LOCALE_COOKIE, translate } from "./index";

/** The visitor's language (cookie), once per request. */
export const getLocale = cache(async (): Promise<Locale> => {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : "en";
});

/** Translator for server code that needs a plain string (metadata, emails…). */
export async function getT() {
  const locale = await getLocale();
  return (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
}
