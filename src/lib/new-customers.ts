import "server-only";
import { and, asc, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { DB } from "./db";
import { customers, orders, salesOrders } from "./db/schema";

// Correlated subqueries name the outer table themselves: in a one-table select Drizzle writes
// columns without it, and inside the subquery a bare "id" would be the inner table's.
const C = sql`${customers}`;

// From a new account to a customer who buys: how many accounts were opened (and how many signed
// up on the website), how many can order, how many have ordered, how long that took, and who is
// stuck where. Plus whether "time to reorder" emails bring orders in.

/** The account's first order of any kind (shop, phone/email, import): null if it hasn't ordered. */
const firstOrderAt = sql<Date | null>`least(
  (select min(so.created_at) from ${salesOrders} so where so.customer_id = ${C}.id and so.status <> 'cancelled'),
  (select min(o.created_at) from ${orders} o where o.customer_id = ${C}.id and o.source <> 'quick_route')
)`;

/** An order placed within a week of the reminder (shop or phone/email). */
const orderedAfterReminder = sql<boolean>`(
  exists (select 1 from ${salesOrders} so where so.customer_id = ${C}.id and so.status <> 'cancelled'
    and so.created_at >= ${C}.restock_reminded_at and so.created_at < ${C}.restock_reminded_at + interval '7 days')
  or exists (select 1 from ${orders} o where o.customer_id = ${C}.id and o.source <> 'quick_route'
    and o.created_at >= ${C}.restock_reminded_at and o.created_at < ${C}.restock_reminded_at + interval '7 days')
)`;

/** `from` / `to`: the period as instants (end exclusive). */
export async function newCustomerFunnel(db: DB, from: Date, to: Date, now = new Date()) {
  const inPeriod = and(gte(customers.createdAt, from), lt(customers.createdAt, to));
  const [opened, waiting, noOrder, [reminders]] = await Promise.all([
    db
      .select({
        id: customers.id,
        online: customers.registeredOnline,
        approved: customers.approved,
        createdAt: customers.createdAt,
        approvedAt: customers.approvedAt,
        firstOrderAt,
      })
      .from(customers)
      .where(inPeriod),
    // Waiting for approval right now, oldest first: every day here is a store that can't order.
    db
      .select({ id: customers.id, name: customers.name, createdAt: customers.createdAt })
      .from(customers)
      .where(and(eq(customers.approved, false), eq(customers.active, true)))
      .orderBy(asc(customers.createdAt))
      .limit(50),
    // Can order, opened in the last two months, and hasn't: newest first.
    db
      .select({ id: customers.id, name: customers.name, approvedAt: customers.approvedAt, createdAt: customers.createdAt })
      .from(customers)
      .where(and(eq(customers.approved, true), eq(customers.active, true), gte(customers.createdAt, new Date(now.getTime() - 60 * 86_400_000)), sql`${firstOrderAt} is null`))
      .orderBy(desc(customers.createdAt))
      .limit(8),
    db
      .select({
        sent: sql<number>`count(*)::int`,
        ordered: sql<number>`(count(*) filter (where ${orderedAfterReminder}))::int`,
      })
      .from(customers)
      .where(and(isNotNull(customers.restockRemindedAt), gte(customers.restockRemindedAt, from), lt(customers.restockRemindedAt, to))),
  ]);
  const days = (a: Date | string, b: Date | string) => (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
  const ordered = opened.filter((c) => c.firstOrderAt);
  const toFirst = ordered.map((c) => days(c.createdAt, c.firstOrderAt!)).sort((a, b) => a - b);
  const approvals = opened.filter((c) => c.online && c.approvedAt).map((c) => days(c.createdAt, c.approvedAt!)).sort((a, b) => a - b);
  const median = (xs: number[]) => (xs.length ? xs[xs.length >> 1] : null);
  return {
    opened: opened.length,
    online: opened.filter((c) => c.online).length,
    approved: opened.filter((c) => c.approved).length,
    ordered: ordered.length,
    /** Median days from account to first order, for the ones that ordered. */
    daysToFirstOrder: median(toFirst),
    /** Median days a website sign-up waited for approval. */
    daysToApproval: median(approvals),
    waiting: waiting.map((c) => ({ id: c.id, name: c.name, days: Math.floor(days(c.createdAt, now)) })),
    noOrder: noOrder.map((c) => ({ id: c.id, name: c.name, days: Math.floor(days(c.approvedAt ?? c.createdAt, now)) })),
    reminders,
  };
}
