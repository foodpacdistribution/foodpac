import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customers, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";

export const metadata: Metadata = { title: "Tax invoice" };

export default async function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(STAFF);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, id)).limit(1);
  if (!so) notFound();
  const [[c], items, s] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, so.customerId)).limit(1),
    db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id)),
    getSettings(db),
  ]);
  const issued = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "long" }).format(so.createdAt);
  return (
    <div className="mx-auto max-w-3xl text-leaf-950">
      <InvoiceSheet so={so} customer={c} items={items} issued={issued} bankDetails={s.bankDetails} />
    </div>
  );
}
