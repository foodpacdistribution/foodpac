import "server-only";
import { emailEnabled, esc, officeEmail, sendEmail } from "./email";

// Emails the office when something goes wrong on the live site, so a problem is known before
// a driver or customer rings about it. The same error is sent once every few hours per server
// (with how often it came back since), and never more than a few emails an hour in all, so an
// outage is one email, not hundreds. Only on the live site: previews and local runs just log.

/** The same error (by fingerprint) is emailed again only after this long. */
const REPEAT_AFTER_MS = 6 * 60 * 60_000;
/** At most this many alert emails per server per hour, whatever the errors. */
const MAX_PER_HOUR = 5;
/** An alert never holds up the answer to the driver or customer for longer than this. */
const SEND_TIMEOUT_MS = 5000;

/** Not faults: the visitor went away, or an old page called an action a new release replaced. */
const NOISE = [/Failed to find Server Action/i, /\baborted\b/i, /ECONNRESET/, /NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/, /\bEPIPE\b/];

type Where = {
  /** What was going on: "Page", "Action", "Driver delivery", "Order sync"… */
  area: string;
  /** The page or API address, when there is one. */
  path?: string;
  /** Anything else that helps (the stuck query, the feed's message). */
  detail?: string;
};

const seen = new Map<string, { at: number; again: number }>();
let sentThisHour: number[] = [];

const messageOf = (err: unknown) => (err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err)) || "Unknown error";

/** Same error, same fingerprint: ids, numbers and quoted values don't make it a different one. */
export function fingerprint(area: string, err: unknown) {
  const m = messageOf(err)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\$\d+/g, "$n")
    .replace(/\d+/g, "<n>")
    .replace(/(["'`]).*?\1/g, "<v>")
    .slice(0, 200);
  return `${area}|${m}`;
}

/** Whether to email now, and how many times it came back since the last email. */
export function shouldSend(key: string, now = Date.now()): { send: false } | { send: true; again: number } {
  const prev = seen.get(key);
  if (prev && now - prev.at < REPEAT_AFTER_MS) {
    prev.again++;
    return { send: false };
  }
  sentThisHour = sentThisHour.filter((t) => now - t < 60 * 60_000);
  if (sentThisHour.length >= MAX_PER_HOUR) {
    if (prev) prev.again++;
    return { send: false };
  }
  sentThisHour.push(now);
  seen.set(key, { at: now, again: 0 });
  return { send: true, again: prev?.again ?? 0 };
}

/** For tests. */
export function resetReported() {
  seen.clear();
  sentThisHour = [];
}

const live = () => process.env.VERCEL_ENV === "production";
const alertTo = () => process.env.ALERT_EMAIL?.trim() || officeEmail();

/** Emails the office about an unexpected error on the live site. Never throws, never waits long. */
export async function reportError(err: unknown, where: Where): Promise<void> {
  try {
    const message = messageOf(err);
    if (NOISE.some((re) => re.test(message))) return;
    const to = alertTo();
    if (!live() || !to || !emailEnabled()) return;
    const decision = shouldSend(fingerprint(where.area, err));
    if (!decision.send) return;

    const when = new Date().toLocaleString("en-AU", { timeZone: "Australia/Brisbane", dateStyle: "medium", timeStyle: "short" });
    const stack = err instanceof Error && err.stack ? err.stack.split("\n").slice(1, 12).join("\n") : "";
    const digest = err && typeof err === "object" && "digest" in err ? String((err as { digest: unknown }).digest) : null;
    const rows: [string, string][] = [
      ["时间 When", `${when} (Brisbane)`],
      ["位置 Where", [where.area, where.path].filter(Boolean).join(" · ")],
      ["错误 Error", message],
      ...(where.detail ? ([["详情 Detail", where.detail]] as [string, string][]) : []),
      ...(decision.again ? ([["重复 Repeats", `${decision.again} more time(s) since the last email`]] as [string, string][]) : []),
      ...(digest ? ([["Digest", digest]] as [string, string][]) : []),
    ];
    const text = [...rows.map(([k, v]) => `${k}: ${v}`), stack && `\n${stack}`].filter(Boolean).join("\n");
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#0b2a1c">
<p style="margin:0 0 12px">网站出错了。同样的错误 6 小时内不会重复发邮件。<br>Something went wrong on the live site. The same error won't be emailed again for 6 hours.</p>
<table style="border-collapse:collapse">${rows
      .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#5f7268;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`)
      .join("")}</table>
${stack ? `<pre style="margin-top:12px;padding:10px;background:#faf6ee;font-size:12px;white-space:pre-wrap">${esc(stack)}</pre>` : ""}
</div>`;
    const subject = `网站出错 · ${where.area}: ${message.replace(/\s+/g, " ").slice(0, 80)}`;
    await Promise.race([sendEmail({ to, subject, html, text }), new Promise((r) => setTimeout(r, SEND_TIMEOUT_MS))]);
  } catch (e) {
    console.warn("[report-error] couldn't send the alert:", e);
  }
}
