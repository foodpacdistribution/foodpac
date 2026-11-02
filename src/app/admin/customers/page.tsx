import { asc, count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customers, orders, users } from "@/lib/db/schema";
import { CustomersClient } from "./customers-client";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  await requireUser(STAFF);
  const db = await getDb();
  const [rows, logins, counts] = await Promise.all([
    db.select().from(customers).orderBy(asc(customers.approved), asc(customers.name)),
    db.select({ customerId: users.customerId, email: users.email, name: users.name }).from(users).where(eq(users.role, "customer")),
    db.select({ customerId: orders.customerId, n: count() }).from(orders).groupBy(orders.customerId),
  ]);
  return (
    <CustomersClient
      customers={rows.map((c) => ({
        ...c,
        createdAt: undefined,
        login: logins.find((l) => l.customerId === c.id) ?? null,
        orderCount: counts.find((x) => x.customerId === c.id)?.n ?? 0,
      }))}
    />
  );
}
