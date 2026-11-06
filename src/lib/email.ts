import "server-only";
import { SITE, type SiteInfo } from "@/app/(site)/site-info";
import { siteUrl } from "./site-url";

// Email through Resend (https://resend.com). Set RESEND_API_KEY to turn it on; without it
// nothing is sent and the app works as before. Until a domain is verified in Resend, mail can
// only come from onboarding@resend.dev and go to the Resend account's own address, so office
// notifications work straight away and customer emails start once EMAIL_FROM uses your domain.

const RESEND_URL = "https://api.resend.com/emails";

export const emailEnabled = () => !!process.env.RESEND_API_KEY;

/** Where notifications for the office go (new orders, enquiries, sign-ups). */
export const officeEmail = () => process.env.OFFICE_EMAIL?.trim() || null;

const from = () => process.env.EMAIL_FROM?.trim() || "Foodpac Distribution <onboarding@resend.dev>";

export type Email = { to: string | string[]; subject: string; html: string; text: string; replyTo?: string };

/**
 * Sends one email. Never throws: an email is a courtesy and must not undo or block the order,
 * sign-up or message that triggered it. Returns whether Resend accepted it.
 */
export async function sendEmail(msg: Email): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: from(), to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.warn(`[email] Resend refused "${msg.subject}" (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return res.ok;
  } catch (err) {
    console.warn(`[email] couldn't send "${msg.subject}":`, (err as Error).message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Escapes text from customers, orders and forms before it goes into an email's HTML. */
export const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const C = { ink: "#0b2a1c", muted: "#5f7268", line: "#ece6da", cream: "#faf6ee", green: "#113a27", orange: "#e0620c" };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Wraps already-escaped HTML in the Foodpac email: logo header, white card, footer with the
 * company's details. Tables and inline styles only, since that's what every mail client renders.
 * `preview` is the line inboxes show next to the subject.
 */
export function layout(opts: { preview?: string; heading: string; body: string; button?: { label: string; url: string }; footer?: string; site?: SiteInfo }) {
  const base = siteUrl();
  const site = opts.site ?? SITE;
  const button = opts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px"><tr><td style="border-radius:999px;background:${C.orange}">
<a href="${esc(opts.button.url)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${esc(opts.button.label)} &rarr;</a></td></tr></table>`
    : "";
  const contact = [site.phone && esc(site.phone), site.email && `<a href="mailto:${esc(site.email)}" style="color:${C.muted}">${esc(site.email)}</a>`]
    .filter(Boolean)
    .join(" &nbsp;·&nbsp; ");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:${C.cream};-webkit-text-size-adjust:100%">
${opts.preview ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.cream}">${esc(opts.preview)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="background:#ffffff;border-radius:18px 18px 0 0;padding:22px 32px 18px;border-bottom:3px solid ${C.orange}">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle"><a href="${esc(base)}" style="text-decoration:none"><img src="${esc(base)}/brand/foodpac-logo.png" width="150" height="54" alt="Foodpac Distribution" style="display:block;border:0;width:150px;height:auto"></a></td>
<td style="vertical-align:middle;padding-left:14px"><span style="display:block;border-left:1px solid ${C.line};padding-left:14px;font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:.22em;color:${C.green}">DISTRIBUTION</span></td>
</tr></table>
</td></tr>
<tr><td style="background:#ffffff;padding:30px 32px 32px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink}">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:${C.green}">${esc(opts.heading)}</h1>
${opts.body}${button}
${opts.footer ? `<p style="margin:26px 0 0;font-size:13px;color:${C.muted}">${opts.footer}</p>` : ""}
</td></tr>
<tr><td style="background:${C.green};border-radius:0 0 18px 18px;padding:22px 32px;font-family:${FONT};font-size:12px;line-height:1.7;color:#c9d8ce">
<strong style="color:#ffffff;font-size:13px">${esc(site.name)}</strong><br>
${esc(site.tagline)} Serving ${esc(site.serviceArea)} &nbsp;·&nbsp; ${esc(site.hours)}<br>
${contact ? `${contact}<br>` : ""}<a href="${esc(base)}" style="color:#ffffff;text-decoration:underline">${esc(base.replace(/^https?:\/\//, ""))}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

/** Order details and similar facts: label → value rows on a cream panel (values already escaped). */
export const rows = (items: [string, string][]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:${C.cream};border-radius:12px"><tr><td style="padding:6px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5">${items
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:10px 16px 10px 0;color:${C.muted};white-space:nowrap;vertical-align:top;width:1%;${i ? `border-top:1px solid ${C.line}` : ""}">${esc(k)}</td><td style="padding:10px 0;vertical-align:top;${i ? `border-top:1px solid ${C.line}` : ""}">${v}</td></tr>`,
    )
    .join("")}</table></td></tr></table>`;

/** A mailto link in the brand colour (mail clients otherwise show default blue). */
export const mailto = (address: string) => `<a href="mailto:${esc(address)}" style="color:${C.green};font-weight:600">${esc(address)}</a>`;

/** A short note on a cream panel (e.g. bank details, the customer's message). */
export const note = (html: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="padding:14px 18px;background:${C.cream};border-left:3px solid ${C.orange};border-radius:8px;font-size:14px;line-height:1.6">${html}</td></tr></table>`;

/** The order's lines: product, quantity × price, line total. */
export const itemTable = (items: { name: string; detail: string; qty: number; price: string; total: string }[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0;font-size:14px;line-height:1.45">
<tr><td style="padding:0 0 8px;color:${C.muted};font-size:12px;text-transform:uppercase;letter-spacing:.06em">Item</td><td style="padding:0 0 8px;color:${C.muted};font-size:12px;text-transform:uppercase;letter-spacing:.06em;text-align:right">Qty</td><td style="padding:0 0 8px;color:${C.muted};font-size:12px;text-transform:uppercase;letter-spacing:.06em;text-align:right">Total</td></tr>
${items
  .map(
    (it) =>
      `<tr><td style="padding:12px 12px 12px 0;border-top:1px solid ${C.line}">${esc(it.name)}<br><span style="color:${C.muted};font-size:12px">${esc(it.detail)}</span></td><td style="padding:12px 0;border-top:1px solid ${C.line};text-align:right;white-space:nowrap;color:${C.muted}">${it.qty} × ${esc(it.price)}</td><td style="padding:12px 0 12px 12px;border-top:1px solid ${C.line};text-align:right;white-space:nowrap;font-weight:600">${esc(it.total)}</td></tr>`,
  )
  .join("")}</table>`;

/** A statement of account: one row per open invoice (values already escaped), then what's owing. */
export const statementTable = (lines: { number: string; issued: string; due: string; amount: string; overdue: boolean; current: boolean }[], owing: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0;font-size:14px;line-height:1.45">
<tr>${["Invoice", "Issued", "Due", "Amount"]
    .map((h, i) => `<td style="padding:0 ${i === 3 ? "0" : "12px"} 8px 0;color:${C.muted};font-size:12px;text-transform:uppercase;letter-spacing:.06em;${i === 3 ? "text-align:right" : ""}">${h}</td>`)
    .join("")}</tr>
${lines
  .map(
    (l) =>
      `<tr><td style="padding:10px 12px 10px 0;border-top:1px solid ${C.line};${l.current ? "font-weight:600" : ""}">${l.number}${l.current ? ` <span style="color:${C.muted};font-weight:400;font-size:12px">(this invoice)</span>` : ""}</td><td style="padding:10px 12px 10px 0;border-top:1px solid ${C.line};white-space:nowrap;color:${C.muted}">${l.issued}</td><td style="padding:10px 12px 10px 0;border-top:1px solid ${C.line};white-space:nowrap;${l.overdue ? `color:#b42318;font-weight:600` : `color:${C.muted}`}">${l.due}${l.overdue ? " · overdue" : ""}</td><td style="padding:10px 0;border-top:1px solid ${C.line};text-align:right;white-space:nowrap">${l.amount}</td></tr>`,
  )
  .join("")}
<tr><td colspan="3" style="padding:12px 12px 0 0;border-top:2px solid ${C.ink};font-weight:700">Total owing</td><td style="padding:12px 0 0;border-top:2px solid ${C.ink};text-align:right;white-space:nowrap;font-weight:700;font-size:16px">${owing}</td></tr>
</table>`;
