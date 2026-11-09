// Translation for the English / 中文 switch. The English text is the key; the Chinese
// dictionary maps it. Anything without a translation simply stays in English, so missing
// entries never break a screen. Client-safe. The dictionary is fetched on demand (loadZh),
// so visitors reading English never download it.

import type * as zh from "./zh";
import { zhDates } from "./zh-dates";

export type Locale = "en" | "zh";
export const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
];
export const LOCALE_COOKIE = "lang";
/** Set by the proxy on /zh/… requests: the page is the Chinese version at its own address. */
export const URL_LOCALE_HEADER = "x-url-locale";

/** Public pages that also exist in Chinese under /zh (for search engines and shared links). */
const ZH_PAGES = ["/products", "/categories", "/about", "/register"];
export const hasZhPage = (path: string) => path === "/" || ZH_PAGES.some((p) => path === p || path.startsWith(`${p}/`));
/** "/products" → "/zh/products", "/" → "/zh". */
export const zhPath = (path: string) => (path === "/" ? "/zh" : `/zh${path}`);
/** "/zh/products" → "/products", anything else → null. */
export const stripZh = (path: string) => (path === "/zh" ? "/" : path.startsWith("/zh/") ? path.slice(3) : null);

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "zh";
}

export type Dictionary = Pick<typeof zh, "ZH" | "ZH_PATTERNS">;

let zhDict: Promise<Dictionary> | undefined;

/** The Chinese dictionary, loaded once (a failed download is retried next time). */
export function loadZh(): Promise<Dictionary> {
  zhDict ??= import("./zh").catch((err) => {
    zhDict = undefined;
    throw err;
  });
  return zhDict;
}

/** Translates `text` with `dict` (null = English). `{name}` placeholders are filled from `vars`. */
export function translate(dict: Dictionary | null, text: string, vars?: Record<string, string | number>): string {
  let out = text;
  if (dict) {
    const hit = dict.ZH[text];
    if (hit !== undefined) out = hit;
    else {
      // Messages with a variable part, e.g. "Jasmine rice deleted" → "已删除 Jasmine rice".
      for (const [re, to] of dict.ZH_PATTERNS) {
        if (re.test(text)) {
          out = text.replace(re, to);
          break;
        }
      }
      // Dates, times and durations inside the text, e.g. "Est. finish 2:44pm".
      out = zhDates(out);
    }
  }
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** BCP 47 tag for dates and numbers. */
export const intlLocale = (l: Locale) => (l === "zh" ? "zh-CN" : "en-AU");
