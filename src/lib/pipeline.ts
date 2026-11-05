import "server-only";
import { and, asc, isNotNull, ne, sql } from "drizzle-orm";
import type { CurrentUser } from "./auth/dal";
import type { DB } from "./db";
import { customers, orders, salesOrders } from "./db/schema";
import { dueFollowUp } from "./follow-up";
import { getSettings } from "./planning";
import { todayIn } from "./time";

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

/** Every customer with what the pipeline needs, including whether a follow-up is due today. */
export async function loadPipeline(db: DB) {
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const [rows, last] = await Promise.all([
    db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
        address: customers.address,
        active: customers.active,
        stage: customers.salesStage,
        stageAt: customers.salesStageAt,
        repId: customers.salesRepId,
        followUpOn: customers.followUpOn,
        followUpNote: customers.followUpNote,
        contactedAt: customers.contactedAt,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .orderBy(asc(customers.name)),
    lastOrderDays(db, s.timezone, today),
  ]);
  const list = rows.map((c) => {
    const lastOrderOn = last.get(c.id) ?? null;
    const contactedOn = c.contactedAt ? todayIn(s.timezone, c.contactedAt) : null;
    return { ...c, lastOrderOn, contactedOn, due: c.active ? dueFollowUp({ followUpOn: c.followUpOn, lastOrderOn, contactedOn }, today, s.quietDays) : null };
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
