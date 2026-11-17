import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, Scale } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { T } from "@/components/i18n";
import Link from "@/components/link";
import { btn, PageHeader } from "@/components/ui";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { customerList } from "@/lib/customer-list";
import { getDb } from "@/lib/db";
import { customerPrices, customers, products, users } from "@/lib/db/schema";
import { worthOffering } from "@/lib/recommend";
import { mayServe } from "@/lib/rep-scope";
import { CustomerListClient } from "./list-client";

export const metadata: Metadata = { title: "Their list" };

/**
 * The customer's "My list", set up by staff: the products they'll order and how many. On their
 * first sign-in it's all there at their prices, ready to add to the cart in one go.
 */
export default async function CustomerListPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser(PIPELINE);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [c] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!c || !mayServe(me, c)) notFound();
  const [items, all, own, picks, [login]] = await Promise.all([
    customerList(db, id),
    db
      .select({ id: products.id, sku: products.sku, name: products.name, packSize: products.packSize, unit: products.unit, minQty: products.minQty, priceCents: products.priceCents })
      .from(products)
      .where(eq(products.active, true))
      .orderBy(asc(products.name)),
    db.select({ productId: customerPrices.productId, cents: customerPrices.priceCents }).from(customerPrices).where(eq(customerPrices.customerId, id)),
    worthOffering(db, id, 12),
    db.select({ email: users.email }).from(users).where(and(eq(users.customerId, id), eq(users.role, "customer"))).limit(1),
  ]);
  const ownOf = new Map(own.map((o) => [o.productId, o.cents]));
  const catalogue = all.map((p) => ({ ...p, priceCents: ownOf.get(p.id) ?? p.priceCents }));
  const onList = new Set(items.map((i) => i.productId));
  const suggestions = picks
    .filter((x) => !onList.has(x.productId))
    .flatMap((x) => catalogue.filter((p) => p.id === x.productId))
    .slice(0, 8);

  return (
    <>
      <Link href={`/admin/customers/${c.id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {c.name}
      </Link>
      <PageHeader
        title={<T vars={{ name: c.name }}>{"Their list · {name}"}</T>}
        subtitle={
          login
            ? <T vars={{ email: login.email }}>{"What {email} sees under My list: these products at their prices, quantities filled in, ready to add to the cart in one go."}</T>
            : "What they'll see under My list once they have a login: these products at their prices, quantities filled in, ready to add to the cart in one go."
        }
        actions={
          <Link href={`/admin/customers/${c.id}/price-match`} className={btn("secondary")}>
            <Scale className="size-4" /> <T>{"Price match"}</T>
          </Link>
        }
      />
      <CustomerListClient customerId={c.id} items={items} products={catalogue} suggestions={suggestions} />
    </>
  );
}
