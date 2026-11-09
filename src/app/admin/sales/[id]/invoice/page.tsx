import { siteInfo } from "@/app/(site)/site-info";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customers, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { invoiceDelivery, invoiceImages } from "@/lib/invoices";

/** The title is the PDF's file name when the invoice is saved from the print window. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Invoice" };
  const [so] = await (await getDb()).select({ number: salesOrders.number }).from(salesOrders).where(eq(salesOrders.id, id)).limit(1);
  return { title: so ? `Invoice ${so.number}` : "Invoice" };
}

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
  // A final invoice shows its issue date; a proforma is dated the day it's looked at.
  const issued = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "long" }).format(so.invoicedAt ?? new Date());
  return (
    <div className="text-leaf-950">
      <InvoiceSheet so={so} customer={c} items={items} issued={issued} bankDetails={s.bankDetails} site={siteInfo(s)} images={await invoiceImages(db, items)} delivery={await invoiceDelivery(db, so, s.timezone)} />
    </div>
  );
}
