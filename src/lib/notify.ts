import "server-only";
import { asc, eq } from "drizzle-orm";
import { type DB, getDb } from "./db";
import { customers, salesOrderItems, salesOrders, users } from "./db/schema";
import { prettyDate } from "./dates";
import { esc, itemTable, layout, mailto, note, officeEmail, rows, sendEmail } from "./email";
import { aud, PAYMENT_METHOD_LABEL } from "./money";
import { getSettings } from "./planning";
import { siteUrl } from "./site-url";
import { formatMinutesClock } from "./time";

// The emails the app sends, each built from the database at the moment it goes out.
// All are called after the response (next/server `after`), so they never slow a page down.

/** The address a customer's emails go to: the business email, else their portal login. */
async function customerEmail(db: DB, customerId: string) {
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
      preview: "Your prices and online ordering are now open.",
      heading: `Welcome aboard, ${c.name}`,
      body: `<p style="margin:0">Your trade account is approved. Sign in to see your prices, order online and choose your delivery day.</p>`,
      button: { label: "Start ordering", url: `${base}/products` },
    }),
    text: `Welcome aboard, ${c.name}.\n\nYour trade account is approved. Sign in to see your prices and order online: ${base}/products`,
  });
}

/** "Forgot password": a link to choose a new one, valid for an hour. */
export async function passwordReset(to: string, name: string, link: string) {
  await sendEmail({
    to,
    subject: "Reset your Foodpac password",
    html: layout({
      preview: "Choose a new password. The link works once, for the next hour.",
      heading: `Hi ${name.split(" ")[0]}, reset your password`,
      body: `<p style="margin:0">Someone (hopefully you) asked to reset the password for this email. The link works once, for the next hour.</p>`,
      button: { label: "Choose a new password", url: link },
      footer: "Didn't ask for this? Ignore this email: your password stays the same.",
    }),
    text: `Reset your Foodpac password (link works once, for the next hour):\n${link}\n\nDidn't ask for this? Ignore this email: your password stays the same.`,
  });
}
