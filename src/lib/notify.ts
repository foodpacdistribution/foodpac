import "server-only";
import { asc, eq } from "drizzle-orm";
import { type DB, getDb } from "./db";
import { customers, quoteItems, quotes, salesOrderItems, salesOrders, users } from "./db/schema";
import { prettyDate } from "./dates";
import { esc, itemTable, layout, mailto, note, officeEmail, rows, sendEmail, sendEmailResult, statementTable } from "./email";
import { accountStatement } from "./invoices";
import { aud, PAYMENT_METHOD_LABEL } from "./money";
import { getSettings } from "./planning";
import { SITE, siteInfo } from "@/app/(site)/site-info";
import { siteUrl } from "./site-url";
import { formatMinutesClock, todayIn } from "./time";

// The emails the app sends, each built from the database at the moment it goes out.
// All are called after the response (next/server `after`), so they never slow a page down,
// except the invoice email: staff press "Email invoice" and need to know it went.

/**
 * The business details set in the back office, for email footers. Only a footer: if the database
 * can't answer, the email still goes with the built-in details rather than not at all.
 */
const business = async () => {
  try {
    return siteInfo(await getSettings(await getDb()));
  } catch (err) {
    console.warn("[email] couldn't read business details, using the defaults:", (err as Error).message);
    return SITE;
  }
};

/** The address a customer's emails go to: the business email, else their portal login. */
export async function customerEmail(db: DB, customerId: string) {
  const [c] = await db.select({ email: customers.email }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (c?.email) return c.email;
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.customerId, customerId)).limit(1);
  return u?.email ?? null;
}

/**
 * A shop order is confirmed (placed on account / bank transfer, card payment received, or
 * accepted by staff): the customer gets their confirmation, and with `office` the office hears too.
 */
export async function orderConfirmed(salesOrderId: string, opts: { office: boolean }) {
  const db = await getDb();
  const [row] = await db
    .select({ so: salesOrders, customer: customers.name })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(eq(salesOrders.id, salesOrderId))
    .limit(1);
  if (!row) return;
  const { so, customer } = row;
  const [items, s, to] = await Promise.all([
    db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id)).orderBy(asc(salesOrderItems.sku)),
    getSettings(db),
    customerEmail(db, so.customerId),
  ]);
  const base = siteUrl();
  const window =
    so.windowStartMin !== null || so.windowEndMin !== null ? ` · ${formatMinutesClock(so.windowStartMin)}–${formatMinutesClock(so.windowEndMin)}` : "";
  const lines =
    itemTable(items.map((it) => ({ name: it.name, detail: `${it.sku} · ${it.packSize}`, qty: it.qty, price: aud(it.unitPriceCents), total: aud(it.lineCents) }))) +
    rows([
      ["Subtotal (ex GST)", aud(so.subtotalCents)],
      ["Delivery", so.deliveryFeeCents ? aud(so.deliveryFeeCents) : "Free"],
      ["GST", aud(so.gstCents)],
      ["Total", `<strong style="font-size:16px">${aud(so.totalCents)}</strong>`],
      ...(so.creditAppliedCents ? ([["Paid with store credit", `−${aud(so.creditAppliedCents)}`], ["Amount due", aud(so.totalCents - so.creditAppliedCents)]] as [string, string][]) : []),
    ]);
  const summary = rows([
    ["Order", `<strong>${esc(so.number)}</strong>`],
    ["Delivery", `${esc(prettyDate(so.deliveryDate, { weekday: "long", day: "numeric", month: "long" }))}${esc(window)}`],
    ["Deliver to", `${esc(so.recipient)}<br>${esc(so.address)}`],
    ["Payment", esc(PAYMENT_METHOD_LABEL[so.paymentMethod])],
  ]);
  const shortDate = prettyDate(so.deliveryDate, { weekday: "short", day: "numeric", month: "short" });
  const text = [
    `Order ${so.number}`,
    `Delivery: ${prettyDate(so.deliveryDate, { weekday: "long", day: "numeric", month: "long" })}${window}`,
    `Deliver to: ${so.recipient}, ${so.address}`,
    ...items.map((it) => `${it.qty} × ${it.name} (${it.sku}) ${aud(it.lineCents)}`),
    `Total ${aud(so.totalCents)} incl. GST`,
  ].join("\n");

  if (to) {
    const bank = so.paymentMethod === "bank_transfer" && so.paymentStatus !== "paid" && s.bankDetails;
    await sendEmail({
      to,
      subject: `Order ${so.number} confirmed – delivery ${shortDate}`,
      html: layout({
        site: siteInfo(s),
        preview: `${so.number} · delivery ${shortDate} · ${aud(so.totalCents)}`,
        heading: "Thanks, your order is confirmed",
        body: `<p style="margin:0">We've got your order and it's booked in for delivery. We'll let you know when it's on its way.</p>${summary}${lines}${
          bank ? note(`<strong>Paying by bank transfer</strong><br>${esc(bank).replace(/\n/g, "<br>")}<br>Please use <strong>${esc(so.number)}</strong> as the reference.`) : ""
        }`,
        button: { label: "Track your order", url: `${base}/portal/orders/${so.id}` },
      }),
      text: `Thanks, your order is confirmed.\n\n${text}\n\nTrack it: ${base}/portal/orders/${so.id}`,
    });
  }
  const office = officeEmail();
  if (opts.office && office) {
    await sendEmail({
      to: office,
      subject: `New order ${so.number} · ${customer} · ${aud(so.totalCents)}`,
      html: layout({
        site: siteInfo(s),
        preview: `${so.number} · ${customer} · delivery ${shortDate} · ${aud(so.totalCents)}`,
        heading: `New order from ${customer}`,
        body: `${summary}${lines}`,
        button: { label: "Open in the back office", url: `${base}/admin/sales/${so.id}` },
      }),
      text: `New order from ${customer}\n\n${text}\n\n${base}/admin/sales/${so.id}`,
      ...(to ? { replyTo: to } : {}),
    });
  }
}

/** Someone used the website's contact form. Replying to the email answers them directly. */
export async function enquiryReceived(e: { name: string; email: string; message: string; business: string | null; phone: string | null; suburb: string | null }) {
  const office = officeEmail();
  if (!office) return;
  const base = siteUrl();
  await sendEmail({
    to: office,
    replyTo: e.email,
    subject: `Website enquiry from ${e.name}${e.business ? ` (${e.business})` : ""}`,
    html: layout({
        site: await business(),
      preview: e.message.slice(0, 120),
      heading: "New website enquiry",
      body: `${rows([
        ["Name", esc(e.name)],
        ["Business", esc(e.business ?? "—")],
        ["Email", mailto(e.email)],
        ["Phone", esc(e.phone ?? "—")],
        ["Suburb", esc(e.suburb ?? "—")],
      ])}${note(esc(e.message).replace(/\n/g, "<br>"))}`,
      button: { label: "Open enquiries", url: `${base}/admin/enquiries` },
      footer: "Reply to this email to answer them directly.",
    }),
    text: `New website enquiry\n\n${e.name}${e.business ? `, ${e.business}` : ""}\n${e.email}${e.phone ? ` · ${e.phone}` : ""}${e.suburb ? ` · ${e.suburb}` : ""}\n\n${e.message}`,
  });
}

/** A business opened a trade account on the website and is waiting to be approved. */
export async function accountRequested(c: { id: string; name: string; contact: string; email: string; phone: string | null; address: string | null }) {
  const office = officeEmail();
  if (!office) return;
  const base = siteUrl();
  await sendEmail({
    to: office,
    replyTo: c.email,
    subject: `New trade account to approve: ${c.name}`,
    html: layout({
        site: await business(),
      preview: `${c.name} · ${c.contact} · ${c.email}`,
      heading: "A new business wants to order",
      body: `${rows([
        ["Business", esc(c.name)],
        ["Contact", esc(c.contact)],
        ["Email", mailto(c.email)],
        ["Phone", esc(c.phone ?? "—")],
        ["Address", esc(c.address ?? "—")],
      ])}<p style="margin:12px 0 0">Approve the account (and set their price list) so they can see prices and order.</p>`,
      button: { label: "Review the customer", url: `${base}/admin/customers/${c.id}` },
    }),
    text: `New trade account to approve: ${c.name}\n${c.contact} · ${c.email}${c.phone ? ` · ${c.phone}` : ""}\n\n${base}/admin/customers/${c.id}`,
  });
}

/** Staff approved a customer's account: prices and ordering are now open to them. */
export async function accountApproved(customerId: string) {
  const db = await getDb();
  const [c] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId)).limit(1);
  const to = c && (await customerEmail(db, customerId));
  if (!c || !to) return;
  const base = siteUrl();
  await sendEmail({
    to,
    subject: "Your Foodpac trade account is ready",
    html: layout({
        site: await business(),
      preview: "Your prices and online ordering are now open.",
      heading: `Welcome aboard, ${c.name}`,
      body: `<p style="margin:0">Your trade account is approved. Sign in to see your prices, order online and choose your delivery day.</p>`,
      button: { label: "Start ordering", url: `${base}/products` },
    }),
    text: `Welcome aboard, ${c.name}.\n\nYour trade account is approved. Sign in to see your prices and order online: ${base}/products`,
  });
}

/**
 * "Forgot password": a link to choose a new one, valid for an hour. `loginEmail` is set when the
 * person typed their business email and the login uses a different one, so they learn which it is.
 */
export async function passwordReset(to: string, name: string, link: string, loginEmail?: string) {
  const login = loginEmail && loginEmail !== to ? loginEmail : null;
  await sendEmail({
    to,
    subject: "Reset your Foodpac password",
    html: layout({
      site: await business(),
      preview: "Choose a new password. The link works once, for the next hour.",
      heading: `Hi ${name.split(" ")[0]}, reset your password`,
      body: `<p style="margin:0">Someone (hopefully you) asked to reset the password for this email. The link works once, for the next hour.</p>${
        login ? `<p style="margin:12px 0 0">You sign in with <strong>${esc(login)}</strong>.</p>` : ""
      }`,
      button: { label: "Choose a new password", url: link },
      footer: "Didn't ask for this? Ignore this email: your password stays the same.",
    }),
    text: `Reset your Foodpac password (link works once, for the next hour):\n${link}\n${login ? `\nYou sign in with ${login}.\n` : ""}\nDidn't ask for this? Ignore this email: your password stays the same.`,
  });
}

/** "Forgot password" for an email with no login: says so, instead of leaving them waiting for nothing. */
export async function passwordResetNoAccount(to: string) {
  const site = await business();
  const base = siteUrl();
  const contact = site.phone ? ` or call ${site.phone}` : "";
  await sendEmail({
    to,
    subject: "Your Foodpac password reset request",
    html: layout({
      site,
      preview: "We don't have a login with this email address.",
      heading: "We couldn't find a login for this email",
      body: `<p style="margin:0">Someone (hopefully you) asked to reset a Foodpac password for <strong>${esc(to)}</strong>, but no login uses this address.</p>
<p style="margin:12px 0 0">If you have an account, try the email you sign in with, or reply to this email${esc(contact)} and we'll reset it for you. New to Foodpac? You can open a trade account online.</p>`,
      button: { label: "Open a trade account", url: `${base}/register` },
      footer: "Didn't ask for this? You can ignore this email.",
    }),
    text: `Someone asked to reset a Foodpac password for ${to}, but no login uses this address.\n\nIf you have an account, try the email you sign in with, or reply to this email${contact} and we'll reset it for you.\n\nNew to Foodpac? Open a trade account: ${base}/register\n\nDidn't ask for this? You can ignore this email.`,
    ...(site.email ? { replyTo: site.email } : {}),
  });
}

/**
 * Emails a final invoice to the customer, with a statement of every invoice they still owe on.
 * Returns the address it went to, or null if it couldn't be sent. Records when it went.
 */
export async function sendInvoice(db: DB, salesOrderId: string): Promise<{ sent: true; to: string } | { sent: false; reason: string }> {
  const [row] = await db
    .select({ so: salesOrders, customer: customers.name })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(eq(salesOrders.id, salesOrderId))
    .limit(1);
  if (!row) return { sent: false, reason: "Order not found." };
  const { so, customer } = row;
  if (so.invoiceStatus !== "final" || !so.invoicedAt) return { sent: false, reason: "Finalise the invoice before emailing it." };
  if (so.status === "cancelled") return { sent: false, reason: "This order is cancelled." };
  const [items, s, to] = await Promise.all([
    db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id)).orderBy(asc(salesOrderItems.sku)),
    getSettings(db),
    customerEmail(db, so.customerId),
  ]);
  if (!to) return { sent: false, reason: "This customer has no email address. Add an accounts email on their customer page." };
  const today = todayIn(s.timezone);
  const statement = await accountStatement(db, so.customerId, today);
  const day = (d: Date) => new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, day: "numeric", month: "short", year: "numeric" }).format(d);
  const due = (d: string | null) => (d ? prettyDate(d, { day: "numeric", month: "short", year: "numeric" }) : "On receipt");
  const base = siteUrl();
  const link = `${base}/portal/orders/${so.id}/invoice`;
  const paid = so.paymentStatus === "paid";
  const site = siteInfo(s);
  // Replies go to whoever handles accounts: the business email in Settings, else the office inbox.
  const replyTo = site.email || officeEmail();

  const summary = rows([
    ["Invoice", `<strong>${esc(so.number)}</strong>`],
    ["Issued", esc(day(so.invoicedAt))],
    ...(paid ? ([["Status", "Paid, thank you"]] as [string, string][]) : ([["Due", esc(due(so.dueDate))]] as [string, string][])),
    ["Delivery", `${esc(prettyDate(so.deliveryDate, { weekday: "short", day: "numeric", month: "short" }))} · ${esc(so.address)}`],
  ]);
  const lines =
    itemTable(items.map((it) => ({ name: it.name, detail: `${it.sku} · ${it.packSize}`, qty: it.qty, price: aud(it.unitPriceCents), total: aud(it.lineCents) }))) +
    rows([
      ["Subtotal (ex GST)", aud(so.subtotalCents)],
      ["Delivery", so.deliveryFeeCents ? aud(so.deliveryFeeCents) : "Free"],
      ["GST", aud(so.gstCents)],
      ["Total (incl. GST)", `<strong style="font-size:16px">${aud(so.totalCents)}</strong>`],
      ...(so.creditAppliedCents ? ([["Paid with store credit", `−${aud(so.creditAppliedCents)}`]] as [string, string][]) : []),
    ]);
  const statementHtml = statement.invoices.length
    ? `<h2 style="margin:28px 0 4px;font-size:17px;color:#113a27">Statement of account</h2>
<p style="margin:0;font-size:13px;color:#5f7268">Open invoices for ${esc(customer)} as of ${esc(prettyDate(today, { day: "numeric", month: "long", year: "numeric" }))}${
        statement.overdueCents ? ` · <strong style="color:#b42318">${aud(statement.overdueCents)} overdue</strong>` : ""
      }</p>
${statementTable(
  statement.invoices.map((r) => ({
    number: esc(r.number),
    issued: esc(r.invoicedAt ? day(r.invoicedAt) : "—"),
    due: esc(due(r.dueDate)),
    amount: aud(r.totalCents),
    overdue: r.overdue,
    current: r.id === so.id,
  })),
  aud(statement.owingCents),
)}`
    : `<p style="margin:24px 0 0;font-size:14px">Your account is all paid up. Thank you.</p>`;
  const bank =
    !paid && so.paymentMethod !== "card" && s.bankDetails
      ? note(`<strong>How to pay</strong><br>${esc(s.bankDetails).replace(/\n/g, "<br>")}<br>Please use <strong>${esc(so.number)}</strong> as the reference.`)
      : "";

  const text = [
    `Tax invoice ${so.number} from ${site.name}`,
    `Issued ${day(so.invoicedAt)}${paid ? " · Paid" : ` · Due ${due(so.dueDate)}`}`,
    "",
    ...items.map((it) => `${it.qty} × ${it.name} (${it.sku}) ${aud(it.lineCents)}`),
    ...(so.deliveryFeeCents ? [`Delivery ${aud(so.deliveryFeeCents)}`] : []),
    `GST ${aud(so.gstCents)}`,
    `Total ${aud(so.totalCents)} incl. GST`,
    "",
    ...(statement.invoices.length
      ? [
          "Statement of account (open invoices):",
          ...statement.invoices.map((r) => `${r.number}  due ${due(r.dueDate)}${r.overdue ? " (overdue)" : ""}  ${aud(r.totalCents)}`),
          `Total owing ${aud(statement.owingCents)}`,
        ]
      : ["Your account is all paid up. Thank you."]),
    ...(!paid && s.bankDetails && so.paymentMethod !== "card" ? ["", "How to pay:", s.bankDetails, `Reference: ${so.number}`] : []),
    "",
    `View or print the invoice: ${link}`,
  ].join("\n");

  const result = await sendEmailResult({
    to,
    subject: `Tax invoice ${so.number} · ${aud(so.totalCents)}${paid ? " · paid" : ` · due ${due(so.dueDate)}`}`,
    html: layout({
      site,
      preview: `${so.number} · ${aud(so.totalCents)}${statement.owingCents ? ` · ${aud(statement.owingCents)} owing on your account` : ""}`,
      heading: `Tax invoice ${so.number}`,
      body: `<p style="margin:0">Hi ${esc(customer)}, here is your invoice${statement.invoices.length > 1 ? " and a statement of your account" : ""}.</p>${summary}${lines}${statementHtml}${bank}`,
      button: { label: "View or print the invoice", url: link },
      footer: "Questions about this invoice? Reply to this email.",
    }),
    text,
    ...(replyTo ? { replyTo } : {}),
  });
  if (!result.ok) return { sent: false, reason: result.error };
  await db.update(salesOrders).set({ invoiceSentAt: new Date(), invoiceSentTo: to }).where(eq(salesOrders.id, so.id));
  return { sent: true, to };
}

/**
 * Emails a quote to the customer: every line, the totals, until when it's valid and the notes.
 * The email is the quote (customers don't need a login to read it); they reply to accept.
 * A draft becomes "sent".
 */
export async function sendQuote(db: DB, quoteId: string): Promise<{ sent: true; to: string } | { sent: false; reason: string }> {
  const [row] = await db
    .select({ q: quotes, customer: customers.name, code: customers.code })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!row) return { sent: false, reason: "Quote not found." };
  const { q, customer, code } = row;
  const [items, s, to] = await Promise.all([
    db.select().from(quoteItems).where(eq(quoteItems.quoteId, q.id)).orderBy(asc(quoteItems.position)),
    getSettings(db),
    customerEmail(db, q.customerId),
  ]);
  if (!to) return { sent: false, reason: "This customer has no email address. Add one on their customer details." };
  const site = siteInfo(s);
  const replyTo = site.email || officeEmail();
  const valid = prettyDate(q.validUntil, { day: "numeric", month: "long", year: "numeric" });
  const summary = rows([
    ["Quote", `<strong>${esc(q.number)}</strong>`],
    ["For", `${esc(customer)} (${esc(code)})`],
    ["Valid until", esc(valid)],
  ]);
  const lines =
    itemTable(items.map((it) => ({ name: it.name, detail: [it.sku, it.packSize, !it.gst && "GST free"].filter(Boolean).join(" · "), qty: it.qty, price: aud(it.unitPriceCents), total: aud(it.lineCents) }))) +
    rows([
      ["Subtotal (ex GST)", aud(q.subtotalCents)],
      ["Delivery", q.deliveryFeeCents ? aud(q.deliveryFeeCents) : "Free"],
      ["GST", aud(q.gstCents)],
      ["Total (incl. GST)", `<strong style="font-size:16px">${aud(q.totalCents)}</strong>`],
    ]);
  const notes = q.notes ? note(esc(q.notes).replace(/\n/g, "<br>")) : "";
  const text = [
    `Quote ${q.number} from ${site.name}`,
    `For ${customer} (${code}) · valid until ${valid}`,
    "",
    ...items.map((it) => `${it.qty} × ${it.name} (${it.sku}) @ ${aud(it.unitPriceCents)} = ${aud(it.lineCents)}`),
    ...(q.deliveryFeeCents ? [`Delivery ${aud(q.deliveryFeeCents)}`] : []),
    `GST ${aud(q.gstCents)}`,
    `Total ${aud(q.totalCents)} incl. GST`,
    ...(q.notes ? ["", q.notes] : []),
    "",
    `To go ahead, reply to this email quoting ${q.number}.`,
  ].join("\n");

  const result = await sendEmailResult({
    to,
    subject: `Quote ${q.number} from ${site.name} · ${aud(q.totalCents)}`,
    html: layout({
      site,
      preview: `${q.number} · ${aud(q.totalCents)} · valid until ${valid}`,
      heading: `Quote ${q.number}`,
      body: `<p style="margin:0">Hi ${esc(customer)}, here is the quote you asked for.</p>${summary}${lines}${notes}<p style="margin:24px 0 0;font-size:14px">To go ahead, just reply to this email quoting <strong>${esc(q.number)}</strong> and we'll book in your delivery.</p>`,
      footer: "Questions about this quote? Reply to this email.",
    }),
    text,
    ...(replyTo ? { replyTo } : {}),
  });
  if (!result.ok) return { sent: false, reason: result.error };
  await db
    .update(quotes)
    .set({ sentAt: new Date(), sentTo: to, ...(q.status === "draft" ? { status: "sent" as const } : {}) })
    .where(eq(quotes.id, q.id));
  return { sent: true, to };
}
