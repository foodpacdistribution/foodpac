import { asc, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { purchaseOrders, suppliers } from "@/lib/db/schema";
import { SuppliersClient } from "./suppliers-client";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  await requireUser(STAFF);
  const db = await getDb();
  const [rows, open] = await Promise.all([
    db.select().from(suppliers).orderBy(asc(suppliers.name)),
    db
      .select({ id: purchaseOrders.supplierId, n: sql<number>`count(*)::int` })
      .from(purchaseOrders)
      .where(inArray(purchaseOrders.status, ["draft", "sent", "confirmed", "partially_received"]))
      .groupBy(purchaseOrders.supplierId),
  ]);
  return <SuppliersClient suppliers={rows.map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), openOrders: open.find((o) => o.id === s.id)?.n ?? 0 }))} />;
}
