// Delivery days in words, for the About and Delivery pages.

/** "Monday to Friday", or the days named one by one ("Monday, Wednesday" / "星期一、星期三"). */
export function weekdays(days: number[], locale: "en" | "zh", tr: (t: string) => string) {
  const sorted = [...days].sort();
  if (sorted.join() === "1,2,3,4,5") return tr("Monday to Friday");
  // 2026-11-09 is a Monday, so day n is 2026-11-(8+n).
  const name = (n: number) => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-AU", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 8 + n)));
  return sorted.map(name).join(locale === "zh" ? "、" : ", ");
}
