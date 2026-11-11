import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { siteInfo } from "@/app/(site)/site-info";
import { type DB, getDb } from "./db";
import { deliveryEvents, orders, routeStops } from "./db/schema";
import { emailEnabled, esc, layout, rows, sendEmail, sendEmailResult } from "./email";
import { customerEmail } from "./notify";
import { getSettings } from "./planning";
import { emailSiteUrl } from "./site-url";
import { formatClock } from "./time";

// Emails that keep customers posted on the day of their delivery, so they don't have to ring the
// office: the van is on its way (with the time it's expected), they're the next stop, the driver is
// about ten minutes away (the driver's button), and it's been delivered. Off until the business
// turns "Email customers about their delivery" on in Settings. Only orders linked to a customer
// with an email address get them. All but the driver's button go out after the response, so
// they never hold up the driver's phone.

type Stop = typeof routeStops.$inferSelect;
type Order = typeof orders.$inferSelect;

async function enabled(db: DB) {
  if (!emailEnabled()) return null;
  const s = await getSettings(db);
  return s.notifyCustomers ? s : null;
}

const trackUrl = (orderId: string) => `${emailSiteUrl()}/portal/track/${orderId}`;

function message(site: ReturnType<typeof siteInfo>, o: Order, m: { subject: string; heading: string; lead: string; facts: [string, string][] }) {
  return {
    subject: m.subject,
    html: layout({
      site,
      preview: m.lead,
      heading: m.heading,
      body: `<p style="margin:0">${esc(m.lead)}</p>${rows([["Order", `<strong>${esc(o.orderNumber)}</strong>`], ...m.facts, ["Deliver to", esc(o.address)]])}`,
      button: { label: "Follow your delivery", url: trackUrl(o.id) },
    }),
    text: [m.lead, "", `Order ${o.orderNumber}`, ...m.facts.map(([k, v]) => `${k}: ${v}`), `Deliver to: ${o.address}`, "", `Follow it: ${trackUrl(o.id)}`].join("\n"),
  };
}

async function stopsOf(db: DB, routeId: string) {
  return db
    .select({ stop: routeStops, order: orders })
    .from(routeStops)
    .innerJoin(orders, eq(orders.id, routeStops.orderId))
    .where(eq(routeStops.routeId, routeId))
    .orderBy(asc(routeStops.seq));
}

/** The driver has set off: everyone on the route hears it's today and roughly when. */
export async function emailRouteStarted(routeId: string) {
  const db = await getDb();
  const s = await enabled(db);
  if (!s) return;
  const site = siteInfo(s);
  const all = (await stopsOf(db, routeId)).filter((r) => r.stop.status === "pending");
  for (const [i, { stop, order }] of all.entries()) {
    const to = order.customerId ? await customerEmail(db, order.customerId) : null;
    if (!to) continue;
    const first = i === 0;
    await sendEmail({
      to,
      ...message(site, order, {
        subject: first ? `Your delivery is on its way: you're the first stop` : `Your delivery is on its way: expected around ${formatClock(stop.etaS)}`,
        heading: "Your delivery is on its way",
        lead: first
          ? `Our driver has just left with your order ${order.orderNumber}. You're the first stop, expected around ${formatClock(stop.etaS)}.`
          : `Our driver has just left with your order ${order.orderNumber}. It's expected around ${formatClock(stop.etaS)}; we'll email again when you're next.`,
        facts: [["Expected", `around ${formatClock(stop.etaS)}`]],
      }),
    });
    // The first stop has just been told it's next.
    if (first) await db.update(routeStops).set({ nextNotifiedAt: new Date() }).where(eq(routeStops.id, stop.id));
  }
}

/** After a delivery: the next customer on the route hears they're next (once). */
export async function emailNextStop(routeId: string) {
  const db = await getDb();
  const s = await enabled(db);
  if (!s) return;
  const next = (await stopsOf(db, routeId)).find((r) => r.stop.status === "pending");
  if (!next || next.stop.nextNotifiedAt) return;
  // Claim it first, so two deliveries uploading together can't both send it.
  const [claimed] = await db
    .update(routeStops)
    .set({ nextNotifiedAt: new Date() })
    .where(and(eq(routeStops.id, next.stop.id), isNull(routeStops.nextNotifiedAt)))
    .returning({ id: routeStops.id });
  if (!claimed) return;
  const to = next.order.customerId ? await customerEmail(db, next.order.customerId) : null;
  if (!to) return;
  await sendEmail({
    to,
    ...message(siteInfo(s), next.order, {
      subject: `You're next: your delivery is expected around ${formatClock(next.stop.etaS)}`,
      heading: "You're the next stop",
      lead: `Our driver is heading to you next with order ${next.order.orderNumber}, expected around ${formatClock(next.stop.etaS)}.`,
      facts: [["Expected", `around ${formatClock(next.stop.etaS)}`]],
    }),
  });
}

/** Delivered: when, and who took it. The photo and signature are on the tracking page. */
export async function emailDelivered(stopId: string) {
  const db = await getDb();
  const s = await enabled(db);
  if (!s) return;
  const [row] = await db
    .select({ stop: routeStops, order: orders })
    .from(routeStops)
    .innerJoin(orders, eq(orders.id, routeStops.orderId))
    .where(eq(routeStops.id, stopId))
    .limit(1);
  if (!row || row.stop.status !== "delivered" || !row.order.customerId) return;
  const to = await customerEmail(db, row.order.customerId);
  if (!to) return;
  const [ev] = await db
    .select({ recipient: deliveryEvents.recipient, at: deliveryEvents.createdAt })
    .from(deliveryEvents)
    .where(and(eq(deliveryEvents.orderId, row.order.id), eq(deliveryEvents.type, "delivered")))
    .orderBy(asc(deliveryEvents.createdAt))
    .limit(1);
  const at = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, hour: "numeric", minute: "2-digit" }).format(ev?.at ?? row.stop.completedAt ?? new Date());
  await sendEmail({
    to,
    ...message(siteInfo(s), row.order, {
      subject: `Delivered: order ${row.order.orderNumber}`,
      heading: "Your order has been delivered",
      lead: `Order ${row.order.orderNumber} was delivered at ${at}${ev?.recipient ? `, received by ${ev.recipient}` : ""}. The delivery photo and signature are on the tracking page.`,
      facts: [["Delivered", at], ...(ev?.recipient ? ([["Received by", ev.recipient]] as [string, string][]) : [])],
    }),
  });
}

/**
 * The driver's "about 10 minutes away" button. Sent while the driver waits, so they're told
 * whether it went; once per stop.
 */
export async function emailHeadsUp(db: DB, stop: Stop): Promise<{ sent: true } | { sent: false; reason: string }> {
  const s = await enabled(db);
  if (!s) return { sent: false, reason: "Customer emails are turned off. The office can turn them on in Settings." };
  if (stop.headsUpAt) return { sent: false, reason: "The customer has already been told you're on your way." };
  const [order] = await db.select().from(orders).where(eq(orders.id, stop.orderId)).limit(1);
  const to = order?.customerId ? await customerEmail(db, order.customerId) : null;
  if (!order || !to) return { sent: false, reason: "This customer has no email address on file. Call them instead." };
  const r = await sendEmailResult({
    to,
    ...message(siteInfo(s), order, {
      subject: `Your driver is about 10 minutes away`,
      heading: "Your driver is about 10 minutes away",
      lead: `Our driver will be with you in about 10 minutes with order ${order.orderNumber}.`,
      facts: [],
    }),
  });
  if (!r.ok) return { sent: false, reason: "The email couldn't be sent. Call the customer instead." };
  await db.update(routeStops).set({ headsUpAt: new Date() }).where(eq(routeStops.id, stop.id));
  return { sent: true };
}

/** Whether the driver's "10 minutes away" button can do anything. */
export async function customerEmailsOn(db: DB) {
  return !!(await enabled(db));
}
