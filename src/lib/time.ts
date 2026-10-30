// Delivery times are stored as minutes/seconds after local midnight in the
// company timezone (single-depot business), so these helpers do the conversions.

export function todayIn(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Seconds since local midnight right now in `timeZone`. */
export function nowSecondsIn(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

export function formatClock(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.round(seconds / 60);
  const dayOffset = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}${dayOffset > 0 ? ` +${dayOffset}d` : ""}`;
}

export function formatMinutesClock(min: number | null | undefined) {
  return min === null || min === undefined ? "—" : formatClock(min * 60);
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function formatKm(metres: number | null | undefined) {
  if (metres === null || metres === undefined) return "—";
  return `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;
}

/** "HH:MM" (24h) ↔ minutes. */
export function minutesToInput(min: number | null | undefined) {
  if (min === null || min === undefined) return "";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function inputToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Parses a single time like "9", "9:30", "930", "9am", "1:15 pm", "13:00" → minutes.
 */
export function parseTime(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const suffix = m[3];
  if (min > 59) return null;
  if (suffix) {
    if (h < 1 || h > 12) return null;
    if (suffix.startsWith("p") && h !== 12) h += 12;
    if (suffix.startsWith("a") && h === 12) h = 0;
  } else if (h > 23) return null;
  return h * 60 + min;
}

/** Parses "9am-12pm", "09:00 – 12:00", "before 11am", "after 2pm" → window in minutes. */
export function parseTimeWindow(raw: string | null | undefined): { start: number | null; end: number | null } | null {
  if (!raw || !raw.trim()) return { start: null, end: null };
  const s = raw.trim().toLowerCase();
  const before = /^(before|by|until)\s+(.+)$/.exec(s);
  if (before) {
    const end = parseTime(before[2]);
    return end === null ? null : { start: null, end };
  }
  const after = /^(after|from)\s+(.+)$/.exec(s);
  if (after) {
    const start = parseTime(after[2]);
    return start === null ? null : { start, end: null };
  }
  const parts = s.split(/\s*(?:-|–|—|to)\s*/);
  if (parts.length !== 2) return null;
  let start = parseTime(parts[0]);
  const end = parseTime(parts[1]);
  // "1-4pm" means 1pm–4pm, but "9-12pm" stays 9am–12pm: inherit pm only if start stays before end.
  if (start !== null && end !== null && /p(m)?$/.test(parts[1]) && !/[ap](m)?$/.test(parts[0])) {
    if (start < 12 * 60 && start + 12 * 60 < end) start += 12 * 60;
  }
  if (start === null || end === null || start >= end) return null;
  return { start, end };
}
