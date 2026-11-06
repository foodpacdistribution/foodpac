import { siteInfo } from "@/app/(site)/site-info";
import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customers, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { invoiceImages } from "@/lib/invoices";

export const metadata: Metadata = { title: "Invoice 发票" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["customer"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !user.customerId) notFound();
  const db = await getDb();
  const [so] = await db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.id, id), eq(salesOrders.customerId, user.customerId)))
    .limit(1);
  if (!so) notFound();
  const [[c], items, s] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, so.customerId)).limit(1),
    db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id)),
    getSettings(db),
  ]);
  // A final invoice shows its issue date; a proforma is dated the day it's looked at.
  const issued = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "long" }).format(so.invoicedAt ?? new Date());

  return <InvoiceSheet so={so} customer={c} items={items} issued={issued} bankDetails={s.bankDetails} site={siteInfo(s)} images={await invoiceImages(db, items)} />;
}
