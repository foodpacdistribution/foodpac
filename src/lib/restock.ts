import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, ne, notExists, sql } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { siteInfo } from "@/app/(site)/site-info";
import { signingKey } from "./auth/session";
import { prettyDate, shiftDate } from "./dates";
import type { DB } from "./db";
import { customers, orders, salesOrderItems, salesOrders } from "./db/schema";
import { emailEnabled, esc, layout, rows, sendEmail } from "./email";
import { daysBetween } from "./follow-up";
import { customerEmail } from "./notify";
import { getSettings } from "./planning";
import { deliveryDates } from "./shop";
import { emailSiteUrl } from "./site-url";
import { formatMinutesClock, todayIn } from "./time";

// "Time to reorder?" emails. A regular customer who has reached their usual gap between orders
// without ordering gets one short email with what they usually buy and a link to their order
// sheet, before they run out and buy it somewhere else. One per gap: the next only after they've
// ordered again. Customers who've gone well past their rhythm are left to the sales team (the
// pipeline's "quiet" and "buying less" follow-ups), since an automatic email won't win them back.
//
// Off until the office turns it on in Settings; customers can turn it off from their profile or
// from the link in the email.

/** Order days looked at to find a customer's rhythm. */
const LOOKBACK_DAYS = 180;
/** Orders needed in that time to have a rhythm at all. */
const MIN_ORDERS = 3;
/** Rhythms this far apart (days) get reminders: weekly to six-weekly. */
const MIN_EVERY = 4;
const MAX_EVERY = 45;

export type RestockDue = { everyDays: number; days: number; lastOrderOn: string };

/**
 * Whether a customer is due a reminder today, from their order days (YYYY-MM-DD, any order):
 * they order at a steady enough rhythm, today is at least one usual gap since their last order
 * but not yet two (plus a week), and they haven't been reminded since that order.
 */
export function restockDue(orderDays: string[], today: string, remindedOn: string | null): RestockDue | null {
  const days = [...new Set(orderDays)].filter((d) => d <= today && d >= shiftDate(today, -LOOKBACK_DAYS)).sort();
  if (days.length < MIN_ORDERS) return null;
  const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
  const sorted = [...gaps].sort((a, b) => a - b);
  const m = sorted.length >> 1;
  const every = Math.round(sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2);
  if (every < MIN_EVERY || every > MAX_EVERY) return null;
  const lastOrderOn = days[days.length - 1];
  const since = daysBetween(lastOrderOn, today);
  if (since < every || since > every * 2 + 7) return null;
  if (remindedOn && remindedOn >= lastOrderOn) return null;
  return { everyDays: every, days: since, lastOrderOn };
}

/**
 * Each customer's order days over the lookback: shop orders by the day they were placed, and
 * delivery orders (phone, email, imports) not from a shop order by their delivery day. An
 * upcoming delivery counts as ordering today.
 */
async function orderDays(db: DB, timeZone: string, today: string, customerIds: string[]) {
  const since = shiftDate(today, -LOOKBACK_DAYS);
  const [shop, deliveries] = await Promise.all([
    db
      .select({ id: salesOrders.customerId, days: sql<string[]>`array_agg(distinct ((${salesOrders.createdAt} at time zone ${timeZone})::date)::text)` })
      .from(salesOrders)
      .where(and(ne(salesOrders.status, "cancelled"), inArray(salesOrders.customerId, customerIds), sql`${salesOrders.createdAt} >= ${since}::date - 1`))
      .groupBy(salesOrders.customerId),
    db
      .select({ id: orders.customerId, days: sql<string[]>`array_agg(distinct least(${orders.deliveryDate}, ${today}::date)::text)` })
      .from(orders)
      .where(
        and(
          isNotNull(orders.customerId),
          inArray(orders.customerId, customerIds),
          ne(orders.source, "quick_route"),
          gte(orders.deliveryDate, since),
          notExists(db.select({ one: sql`1` }).from(salesOrders).where(eq(salesOrders.deliveryOrderId, orders.id))),
        ),
      )
      .groupBy(orders.customerId),
  ]);
  const out = new Map<string, string[]>();
  for (const { id, days } of [...shop, ...deliveries]) if (id) out.set(id, [...(out.get(id) ?? []), ...days]);
  return out;
}

/** Customers due a reminder today (whether or not reminders are switched on), with their rhythm. */
export async function customersDueRestock(db: DB) {
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const list = await db
    .select({ id: customers.id, name: customers.name, remindedAt: customers.restockRemindedAt })
    .from(customers)
    .where(and(eq(customers.active, true), eq(customers.approved, true), eq(customers.restockEmails, true)));
  if (!list.length) return [];
  const byCustomer = await orderDays(db, s.timezone, today, list.map((c) => c.id));
  return list.flatMap((c) => {
    const reminded = c.remindedAt ? todayIn(s.timezone, c.remindedAt) : null;
    const due = restockDue(byCustomer.get(c.id) ?? [], today, reminded);
    return due ? [{ id: c.id, name: c.name, ...due }] : [];
  });
}

/** What the customer usually orders, most often first, with the quantity they last had. */
async function usualLines(db: DB, customerId: string, today: string) {
  return db
    .select({
      name: sql<string>`max(${salesOrderItems.name})`,
      unit: sql<string>`max(${salesOrderItems.unit})`,
      lastQty: sql<number>`(array_agg(${salesOrderItems.qty} order by ${salesOrders.createdAt} desc))[1]`,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
    .where(and(eq(salesOrders.customerId, customerId), ne(salesOrders.status, "cancelled"), sql`${salesOrders.createdAt} >= ${shiftDate(today, -LOOKBACK_DAYS)}::date`))
    .groupBy(sql`coalesce(${salesOrderItems.productId}::text, ${salesOrderItems.sku})`)
    .orderBy(desc(sql`count(distinct ${salesOrders.id})`), desc(sql`max(${salesOrders.createdAt})`))
    .limit(8);
}

const UNSUB_PURPOSE = "restock-unsubscribe";

/** A link that turns these emails off for one customer, without signing in. */
export async function unsubscribeUrl(customerId: string) {
  const token = await new SignJWT({ p: UNSUB_PURPOSE }).setProtectedHeader({ alg: "HS256" }).setSubject(customerId).sign(signingKey());
  return `${emailSiteUrl()}/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** The customer an unsubscribe link is for, or null if it isn't one of ours. */
export async function readUnsubscribeToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ["HS256"] });
    return payload.p === UNSUB_PURPOSE && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Sends today's reminders, when they're switched on. Each customer is marked before the email
 * goes, so a second run the same day (or a retry) never sends twice. Returns how many went.
 */
export async function sendRestockReminders(db: DB) {
  const s = await getSettings(db);
  if (!s.restockReminders || !emailEnabled()) return { sent: 0, due: 0 };
  const today = todayIn(s.timezone);
  const due = await customersDueRestock(db);
  const site = siteInfo(s);
  const [next] = deliveryDates(s, 1);
  let sent = 0;
  for (const c of due) {
    const to = await customerEmail(db, c.id);
    if (!to) continue;
    // Claim it: only one run gets to send today's email to this customer.
    const [claimed] = await db
      .update(customers)
      .set({ restockRemindedAt: new Date() })
      .where(and(eq(customers.id, c.id), sql`(${customers.restockRemindedAt} is null or ${customers.restockRemindedAt} < ${c.lastOrderOn}::date)`))
      .returning({ id: customers.id });
    if (!claimed) continue;
    const lines = await usualLines(db, c.id, today);
    const orderUrl = `${emailSiteUrl()}/portal/quick-order`;
    const unsub = await unsubscribeUrl(c.id);
    const lead = `It's been ${c.days} days since your last order, and you usually order about every ${c.everyDays} days. Here's what you normally get, ready to order again in a minute.`;
    const when = next ? `Order by ${formatMinutesClock(s.orderCutoffMin)} for delivery ${prettyDate(next, { weekday: "long", day: "numeric", month: "long" })}.` : "";
    const ok = await sendEmail({
      to,
      subject: `Time to restock, ${c.name}?`,
      html: layout({
        site,
        preview: lead,
        heading: "Running low?",
        body: `<p style="margin:0">${esc(lead)}</p>${lines.length ? rows(lines.map((l) => [`${l.lastQty} × ${l.unit}`, esc(l.name)])) : ""}${when ? `<p style="margin:0">${esc(when)}</p>` : ""}`,
        button: { label: "Order now", url: orderUrl },
        footer: `Don't want these reminders? <a href="${esc(unsub)}" style="color:inherit">Turn them off</a>.`,
      }),
      text: [lead, "", ...lines.map((l) => `${l.lastQty} × ${l.unit} · ${l.name}`), "", when, `Order now: ${orderUrl}`, "", `Turn these reminders off: ${unsub}`].join("\n"),
    });
    if (ok) sent++;
    // Not sent: give it back, so tomorrow's run tries again.
    else await db.update(customers).set({ restockRemindedAt: null }).where(eq(customers.id, c.id));
  }
  return { sent, due: due.length };
}
