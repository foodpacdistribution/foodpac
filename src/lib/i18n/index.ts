// Translation for the English / 中文 switch. The English text is the key; the Chinese
// dictionary maps it. Anything without a translation simply stays in English, so missing
// entries never break a screen. Client-safe.

import { ZH, ZH_PATTERNS } from "./zh";
import { zhDates } from "./zh-dates";

export type Locale = "en" | "zh";
export const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
];
export const LOCALE_COOKIE = "lang";

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "zh";
}

/** Translates `text` into `locale`. `{name}` placeholders are filled from `vars`. */
export function translate(locale: Locale, text: string, vars?: Record<string, string | number>): string {
  let out = text;
  if (locale === "zh") {
    const hit = ZH[text];
    if (hit !== undefined) out = hit;
    else {
      // Messages with a variable part, e.g. "Jasmine rice deleted" → "已删除 Jasmine rice".
      for (const [re, to] of ZH_PATTERNS) {
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
