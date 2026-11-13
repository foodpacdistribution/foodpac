import { asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { PageHeader } from "@/components/ui";
import { notFound } from "next/navigation";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customerPrices, customers, products } from "@/lib/db/schema";
import { PAYMENT_TERMS_LABEL } from "@/lib/money";
import { PriceList } from "./price-list";
import { T } from "@/components/i18n";

export const metadata: Metadata = { title: "Customer price list" };

export default async function CustomerPricesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(STAFF);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [c] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!c) notFound();
  const [rows, own] = await Promise.all([
    db.select({ id: products.id, sku: products.sku, name: products.name, category: products.category, priceCents: products.priceCents, unit: products.unit }).from(products).orderBy(asc(products.category), asc(products.name)),
    db.select().from(customerPrices).where(eq(customerPrices.customerId, id)),
  ]);
  return (
    <>
      <Link href={`/admin/customers/${c.id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {" "}{c.name}</Link>
      <PageHeader
        title={<T vars={{ name: c.name }}>{"{name} · price list"}</T>}
        subtitle={
          <>
            <T>{PAYMENT_TERMS_LABEL[c.paymentTerms]}</T>. <T>{"Tick products to give a % discount in one go, or type a price. Blank means list price. Prices are ex GST and only this customer sees them."}</T>
          </>
        }
      />
      <PriceList customerId={c.id} rows={rows.map((r) => ({ ...r, ownCents: own.find((o) => o.productId === r.id)?.priceCents ?? null }))} />
    </>
  );
}
