import "server-only";
import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { CurrentUser } from "./auth/dal";
import type { DB } from "./db";
import { customers, orders, salesOrderItems, salesOrders } from "./db/schema";
import { type BuyingLess, buyingLess, dueFollowUp, type ProductHistory, SPEND_WINDOW } from "./follow-up";
import { getSettings } from "./planning";
import { todayIn } from "./time";
import { lastVisits } from "./visit-log";

/**
 * Each customer's latest order day: shop orders (not cancelled) and delivery orders (phone,
 * email, imports). An upcoming delivery counts as ordering today.
 */
async function lastOrderDays(db: DB, timeZone: string, today: string) {
  const [shop, deliveries] = await Promise.all([
    db
      .select({ id: salesOrders.customerId, day: sql<string>`max((${salesOrders.createdAt} at time zone ${timeZone})::date)::text` })
      .from(salesOrders)
      .where(ne(salesOrders.status, "cancelled"))
      .groupBy(salesOrders.customerId),
    db
      .select({ id: orders.customerId, day: sql<string>`max(${orders.deliveryDate})::text` })
      .from(orders)
      .where(and(isNotNull(orders.customerId), ne(orders.source, "quick_route")))
      .groupBy(orders.customerId),
  ]);
  const last = new Map<string, string>();
  for (const { id, day } of [...shop, ...deliveries]) {
    if (!id || !day) continue;
    const d = day > today ? today : day;
    if (!last.has(id) || d > last.get(id)!) last.set(id, d);
  }
  return last;
}

/**
 * What each customer bought over the last year, for spotting who's buying less: the days they
 * bought each product they've had at least three times, and their spend lately against before.
 */
async function buyingLessBy(db: DB, timeZone: string, today: string, lastOrder: Map<string, string>) {
  const day = sql`(${salesOrders.createdAt} at time zone ${timeZone})::date`;
  const live = ne(salesOrders.status, "cancelled");
  const product = sql`coalesce(${salesOrderItems.productId}::text, ${salesOrderItems.sku})`;
  const [items, spend] = await Promise.all([
    db
      .select({
        customerId: salesOrders.customerId,
        name: sql<string>`max(${salesOrderItems.name})`,
        // Sorted below: with the time zone bound twice, Postgres can't match an ORDER BY to the DISTINCT.
        days: sql<string[]>`array_agg(distinct ${day}::text)`,
        cents: sql<number>`sum(${salesOrderItems.lineCents})::int`,
      })
      .from(salesOrderItems)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
      .where(and(live, sql`${salesOrders.createdAt} > now() - interval '365 days'`))
      .groupBy(salesOrders.customerId, product)
      .having(sql`count(distinct ${day}) >= 3`),
    db
      .select({
        customerId: salesOrders.customerId,
        recent: sql<number>`coalesce(sum(${salesOrders.totalCents}) filter (where ${salesOrders.createdAt} > now() - make_interval(days => ${SPEND_WINDOW})), 0)::int`,
        prior: sql<number>`coalesce(sum(${salesOrders.totalCents}) filter (where ${salesOrders.createdAt} <= now() - make_interval(days => ${SPEND_WINDOW}) and ${salesOrders.createdAt} > now() - make_interval(days => ${SPEND_WINDOW * 4})), 0)::int`,
        first: sql<string>`min(${day})::text`,
      })
      .from(salesOrders)
      .where(live)
      .groupBy(salesOrders.customerId),
  ]);
  const products = new Map<string, ProductHistory[]>();
  for (const r of items) {
    const list = products.get(r.customerId) ?? [];
    list.push({ name: r.name, days: [...r.days].sort(), cents: r.cents });
    products.set(r.customerId, list);
  }
  const out = new Map<string, BuyingLess>();
  for (const r of spend) {
    const less = buyingLess(products.get(r.customerId) ?? [], { recentCents: r.recent, priorCents: r.prior, firstOrderOn: r.first }, lastOrder.get(r.customerId) ?? null, today);
    if (less) out.set(r.customerId, less);
  }
  return out;
}

/** Every customer with what the pipeline needs, including whether a follow-up is due today. */
export async function loadPipeline(db: DB) {
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const [rows, last, visits] = await Promise.all([
    db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
        address: customers.address,
        abn: customers.abn,
        active: customers.active,
        approved: customers.approved,
        paymentTerms: customers.paymentTerms,
        creditLimitCents: customers.creditLimitCents,
        stage: customers.salesStage,
        stageAt: customers.salesStageAt,
        repId: customers.salesRepId,
        followUpOn: customers.followUpOn,
        followUpNote: customers.followUpNote,
        notNowReason: customers.notNowReason,
        contactedAt: customers.contactedAt,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .orderBy(asc(customers.name)),
    lastOrderDays(db, s.timezone, today),
    lastVisits(db, s.timezone),
  ]);
  const less = await buyingLessBy(db, s.timezone, today, last);
  const list = rows.map((c) => {
    const lastOrderOn = last.get(c.id) ?? null;
    const contactedOn = c.contactedAt ? todayIn(s.timezone, c.contactedAt) : null;
    // An open account: won and approved, counted from the day it was won.
    const openedOn = c.stage === "won" && c.approved ? todayIn(s.timezone, c.stageAt) : null;
    const facts = { followUpOn: c.followUpOn, lastOrderOn, contactedOn, openedOn, buyingLess: less.get(c.id) ?? null, parked: c.stage === "not_now" };
    return { ...c, lastOrderOn, contactedOn, lastVisit: visits.get(c.id) ?? null, due: c.active ? dueFollowUp(facts, today, s.quietDays) : null };
  });
  return { today, quietDays: s.quietDays, customers: list };
}

/** Follow-ups due for this person: sales staff see their own and unassigned customers, the office sees all. */
export function isMineToFollow(user: Pick<CurrentUser, "id" | "role">, repId: string | null) {
  return user.role !== "sales" || repId === null || repId === user.id;
}

export async function dueFollowUpCount(db: DB, user: Pick<CurrentUser, "id" | "role">) {
  const { customers: list } = await loadPipeline(db);
  return list.filter((c) => c.due && isMineToFollow(user, c.repId)).length;
}
