import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import type { DB } from "./db";
import { customers, customerVisits, type SalesStage, salesOrders, users, type VisitOutcome } from "./db/schema";
import { shiftDate } from "./dates";

// "My sales": what a salesperson did over a stretch of days and what came of it. Visits and calls
// are theirs; sales, first orders and stores won are for the customers they look after. Revenue
// is the order total, as in the Sales Report.

export type RepPeriod = { from: string; to: string; timeZone: string };

/** Each day from `from` to `to` (inclusive). */
export function daysOf(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d);
  return out;
}

/** Visits that ended in an order, as a whole percentage of visits (null with none). */
export function orderRate(byOutcome: Partial<Record<VisitOutcome, number>>, visits: number) {
  return visits ? Math.round(((byOutcome.ordered ?? 0) / visits) * 100) : null;
}

function window(p: RepPeriod) {
  const at = (d: string) => sql`(${d}::timestamp at time zone ${p.timeZone})`;
  return { start: at(p.from), end: at(shiftDate(p.to, 1)) };
}

/** One salesperson's numbers for the period, with the same-length stretch before it for sales. */
export async function repStats(db: DB, repId: string, p: RepPeriod) {
  const { start, end } = window(p);
  const len = daysOf(p.from, p.to).length;
  const prev = window({ ...p, from: shiftDate(p.from, -len), to: shiftDate(p.from, -1) });
  const vDay = sql<string>`to_char(${customerVisits.createdAt} at time zone ${p.timeZone}, 'YYYY-MM-DD')`;
  const oDay = sql<string>`to_char(${salesOrders.createdAt} at time zone ${p.timeZone}, 'YYYY-MM-DD')`;
  const mine = eq(customers.salesRepId, repId);
  const live = ne(salesOrders.status, "cancelled");
  const visitsIn = and(eq(customerVisits.userId, repId), gte(customerVisits.createdAt, start), lt(customerVisits.createdAt, end));

  const [visitRows, [{ stores }], visitDays, salesDays, [prevSales], firstOrders, won, stages, top] = await Promise.all([
    db
      .select({ channel: customerVisits.channel, outcome: customerVisits.outcome, n: sql<number>`count(*)::int`, stores: sql<number>`count(distinct ${customerVisits.customerId})::int` })
      .from(customerVisits)
      .where(visitsIn)
      .groupBy(customerVisits.channel, customerVisits.outcome),
    db.select({ stores: sql<number>`count(distinct ${customerVisits.customerId})::int` }).from(customerVisits).where(visitsIn),
    db.select({ day: vDay, n: sql<number>`count(*)::int` }).from(customerVisits).where(visitsIn).groupBy(sql`1`),
    db
      .select({ day: oDay, cents: sql<number>`sum(${salesOrders.totalCents})::int`, orders: sql<number>`count(*)::int` })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(and(mine, live, gte(salesOrders.createdAt, start), lt(salesOrders.createdAt, end)))
      .groupBy(sql`1`),
    db
      .select({ cents: sql<number>`coalesce(sum(${salesOrders.totalCents}), 0)::int` })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(and(mine, live, gte(salesOrders.createdAt, prev.start), lt(salesOrders.createdAt, prev.end))),
    // Their customers whose very first order falls in the period.
    db
      .select({ id: customers.id, name: customers.name, first: sql<string>`min(${salesOrders.createdAt})` })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(and(mine, live))
      .groupBy(customers.id, customers.name)
      .having(and(gte(sql`min(${salesOrders.createdAt})`, start), lt(sql`min(${salesOrders.createdAt})`, end)))
      .orderBy(desc(sql`min(${salesOrders.createdAt})`)),
    db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(mine, eq(customers.salesStage, "won"), gte(customers.salesStageAt, start), lt(customers.salesStageAt, end)))
      .orderBy(desc(customers.salesStageAt)),
    db.select({ stage: customers.salesStage, n: sql<number>`count(*)::int` }).from(customers).where(and(mine, eq(customers.active, true))).groupBy(customers.salesStage),
    db
      .select({ id: customers.id, name: customers.name, cents: sql<number>`sum(${salesOrders.totalCents})::int`, orders: sql<number>`count(*)::int` })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(and(mine, live, gte(salesOrders.createdAt, start), lt(salesOrders.createdAt, end)))
      .groupBy(customers.id, customers.name)
      .orderBy(desc(sql`sum(${salesOrders.totalCents})`))
      .limit(5),
  ]);

  const byOutcome: Partial<Record<VisitOutcome, number>> = {};
  let inStore = 0;
  let calls = 0;
  for (const r of visitRows) {
    byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + r.n;
    if (r.channel === "call") calls += r.n;
    else inStore += r.n;
  }
  const visitsBy = new Map(visitDays.map((d) => [d.day, d.n]));
  const salesBy = new Map(salesDays.map((d) => [d.day, d]));
  const series = daysOf(p.from, p.to).map((day) => ({ day, visits: visitsBy.get(day) ?? 0, cents: salesBy.get(day)?.cents ?? 0, orders: salesBy.get(day)?.orders ?? 0 }));
  const salesCents = series.reduce((t, d) => t + d.cents, 0);
  const pipeline: Record<SalesStage, number> = { new: 0, interested: 0, negotiating: 0, won: 0, not_now: 0 };
  for (const s of stages) pipeline[s.stage] = s.n;

  return {
    visits: { total: inStore + calls, inStore, calls, stores, byOutcome, orderRate: orderRate(byOutcome, inStore + calls) },
    sales: { cents: salesCents, orders: series.reduce((t, d) => t + d.orders, 0), prevCents: prevSales.cents },
    firstOrders: firstOrders.map((f) => ({ id: f.id, name: f.name })),
    won,
    pipeline,
    top,
    series,
  };
}

export type RepStats = Awaited<ReturnType<typeof repStats>>;

/** Everyone who sells (or has logged a visit), for the team view. */
export async function salesPeople(db: DB) {
  const visited = db.selectDistinct({ id: customerVisits.userId }).from(customerVisits).where(isNotNull(customerVisits.userId));
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(sql`${users.role} = 'sales' or 'sales' = any(${users.extraRoles}) or ${users.id} in ${visited}`)
    .orderBy(users.name);
}

/** The team at a glance: each salesperson's headline numbers for the period. */
export async function teamStats(db: DB, p: RepPeriod) {
  const people = await salesPeople(db);
  if (!people.length) return [];
  const { start, end } = window(p);
  const ids = people.map((x) => x.id);
  const [visits, sales, won] = await Promise.all([
    db
      .select({ id: customerVisits.userId, n: sql<number>`count(*)::int`, ordered: sql<number>`(count(*) filter (where ${customerVisits.outcome} = 'ordered'))::int` })
      .from(customerVisits)
      .where(and(inArray(customerVisits.userId, ids), gte(customerVisits.createdAt, start), lt(customerVisits.createdAt, end)))
      .groupBy(customerVisits.userId),
    db
      .select({ id: customers.salesRepId, cents: sql<number>`sum(${salesOrders.totalCents})::int` })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(and(inArray(customers.salesRepId, ids), ne(salesOrders.status, "cancelled"), gte(salesOrders.createdAt, start), lt(salesOrders.createdAt, end)))
      .groupBy(customers.salesRepId),
    db
      .select({ id: customers.salesRepId, n: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(inArray(customers.salesRepId, ids), eq(customers.salesStage, "won"), gte(customers.salesStageAt, start), lt(customers.salesStageAt, end)))
      .groupBy(customers.salesRepId),
  ]);
  return people
    .map((x) => {
      const v = visits.find((r) => r.id === x.id);
      return {
        ...x,
        visits: v?.n ?? 0,
        orderRate: v?.n ? Math.round((v.ordered / v.n) * 100) : null,
        won: won.find((r) => r.id === x.id)?.n ?? 0,
        salesCents: sales.find((r) => r.id === x.id)?.cents ?? 0,
      };
    })
    .sort((a, b) => b.salesCents - a.salesCents || b.visits - a.visits);
}
