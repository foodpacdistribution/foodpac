// Dates, clock times and durations in Chinese order. The app formats these in English
// ("Mon, 2 Nov 2026", "7:53 pm", "1h 05m"); this rewrites them wherever they appear in a string.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS: Record<string, string> = { Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六", Sun: "周日" };

const MON = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
const WD = "(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*";

const DATE = new RegExp(`\\b(?:${WD},? )?(\\d{1,2}) ${MON}(?:,? (\\d{4}))?\\b`, "g");
const CLOCK = /\b(\d{1,2}):(\d{2}) ?([ap]m)\b/gi;
const HOURS = /\b(\d+)h (\d{2})m\b/g;
// "45m" (no space; "120 m" is a distance) or "34 min".
const MINUTES = /\b(\d+)(?:m| ?mins?)\b/g;
const AGO = /\b(\d+) ?min ago\b/g;
const WEEKDAY_ONLY = new RegExp(`^${WD}$`);

export function zhDates(text: string): string {
  const wd = WEEKDAY_ONLY.exec(text);
  if (wd) return WEEKDAYS[wd[1]];
  return text
    .replace(DATE, (_, w: string | undefined, d: string, m: string, y: string | undefined) =>
      `${y ? `${y}年` : ""}${MONTHS.indexOf(m) + 1}月${d}日${w ? ` ${WEEKDAYS[w]}` : ""}`,
    )
    .replace(CLOCK, (_, h: string, m: string, ap: string) => {
      const h24 = (Number(h) % 12) + (ap.toLowerCase() === "pm" ? 12 : 0);
      return `${h24}:${m}`;
    })
    .replace(HOURS, (_, h: string, m: string) => `${h}小时${Number(m)}分`)
    .replace(AGO, "$1 分钟前")
    .replace(MINUTES, "$1 分钟");
}
