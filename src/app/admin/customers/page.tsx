import { and, asc, count, eq, max, ne, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customers, orders, salesOrders, users } from "@/lib/db/schema";
import { CustomersClient } from "./customers-client";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  // Sales staff see the customers too, without changing them.
  const me = await requireUser(PIPELINE);
  const db = await getDb();
  const [rows, logins, counts, sales] = await Promise.all([
    db.select().from(customers).orderBy(asc(customers.approved), asc(customers.name)),
    db.select({ customerId: users.customerId, email: users.email, name: users.name }).from(users).where(eq(users.role, "customer")),
    db.select({ customerId: orders.customerId, n: count() }).from(orders).groupBy(orders.customerId),
    db
      .select({
        customerId: salesOrders.customerId,
        spend90: sql<number>`coalesce(sum(${salesOrders.totalCents}) filter (where ${salesOrders.createdAt} > now() - interval '90 days'), 0)::int`,
        unpaid: sql<number>`coalesce(sum(${salesOrders.totalCents} - ${salesOrders.creditAppliedCents}) filter (where ${salesOrders.paymentStatus} = 'unpaid'), 0)::int`,
        lastOrder: max(salesOrders.createdAt),
      })
      .from(salesOrders)
      .where(and(ne(salesOrders.status, "cancelled")))
      .groupBy(salesOrders.customerId),
  ]);
  return (
    <CustomersClient
      isAdmin={me.role === "admin"}
      readOnly={me.role === "sales"}
      customers={rows.map((c) => ({
        ...c,
        createdAt: undefined,
        login: logins.find((l) => l.customerId === c.id) ?? null,
        orderCount: counts.find((x) => x.customerId === c.id)?.n ?? 0,
        spend90Cents: sales.find((x) => x.customerId === c.id)?.spend90 ?? 0,
        unpaidCents: sales.find((x) => x.customerId === c.id)?.unpaid ?? 0,
        lastOrderAt: sales.find((x) => x.customerId === c.id)?.lastOrder?.toISOString() ?? null,
      }))}
    />
  );
}
