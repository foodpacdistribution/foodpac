// Calendar-date helpers for "YYYY-MM-DD" strings (no timezone involved).

export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function prettyDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-AU", { ...opts, timeZone: "UTC" });
}
