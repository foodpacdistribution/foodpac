import "server-only";

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

/**
 * Wraps already-escaped HTML in the Foodpac email layout. Inline styles only: that's what
 * email clients render reliably.
 */
export function layout(opts: { heading: string; body: string; button?: { label: string; url: string }; footer?: string }) {
  const button = opts.button
    ? `<p style="margin:24px 0 8px"><a href="${esc(opts.button.url)}" style="display:inline-block;background:#e0620c;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${esc(opts.button.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#faf6ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0d2a1c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ee;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#113a27;padding:18px 24px;color:#faf6ee;font-weight:700;font-size:18px;letter-spacing:0.2px">Foodpac Distribution</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${esc(opts.heading)}</h1>
${opts.body}${button}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #eee;font-size:12px;color:#6b7c72">${opts.footer ?? "Foodpac Distribution · Food &amp; packaging supplies, delivered across South East Queensland."}</td></tr>
</table></td></tr></table></body></html>`;
}

/** A two-column table of label → value rows (values already escaped). */
export const rows = (items: [string, string][]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:12px 0;font-size:14px">${items
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7c72;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0">${v}</td></tr>`)
    .join("")}</table>`;
