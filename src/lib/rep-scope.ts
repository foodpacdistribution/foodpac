import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import type { CurrentUser } from "./auth/dal";
import type { DB } from "./db";
import { customers } from "./db/schema";
import { UserError } from "./planning";

// Sales staff quote and take orders for their own customers, and for ones nobody looks after yet
// (doing so makes them theirs). The office works on everyone.

type Who = Pick<CurrentUser, "id" | "role">;

/** For queries: the customers this person may work on (everyone, for the office). */
export function myCustomers(user: Who) {
  return user.role === "sales" ? or(isNull(customers.salesRepId), eq(customers.salesRepId, user.id)) : undefined;
}

/** True when this person may quote or order for the customer. */
export function mayServe(user: Who, c: { salesRepId: string | null }) {
  return user.role !== "sales" || c.salesRepId === null || c.salesRepId === user.id;
}

/** Throws unless this person may work on the customer. */
export async function assertMayServe(db: DB, user: Who, customerId: string) {
  if (user.role !== "sales") return;
  const [c] = await db.select({ rep: customers.salesRepId }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!c) throw new UserError("Customer not found.");
  if (c.rep !== null && c.rep !== user.id) throw new UserError("Another salesperson looks after this customer. Ask them, or the office.");
}

/** A salesperson who quotes or takes an order for an unassigned customer looks after it from now on. */
export async function takeOn(db: DB, user: Who, customerId: string) {
  if (user.role !== "sales") return;
  await db.update(customers).set({ salesRepId: user.id }).where(and(eq(customers.id, customerId), isNull(customers.salesRepId)));
}

/** For pages: whether this person may see the customer's quotes and orders (a page shows "not found" otherwise). */
export async function mayServeId(db: DB, user: Who, customerId: string) {
  if (user.role !== "sales") return true;
  const [c] = await db.select({ salesRepId: customers.salesRepId }).from(customers).where(eq(customers.id, customerId)).limit(1);
  return !!c && mayServe(user, c);
}
