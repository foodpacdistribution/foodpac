import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customerPrices, customers, products } from "@/lib/db/schema";
import { popularProducts } from "@/lib/leave-behind";
import { productImageUrl } from "@/lib/product-image";
import { mayServe } from "@/lib/rep-scope";
import { STORE_TYPES } from "@/lib/store-types";
import { CatalogClient } from "./catalog-client";

export const metadata: Metadata = { title: "Catalogue" };

/**
 * What we sell, to show at the counter: photos, pack sizes, the store's price and whether it's in
 * stock; nothing internal (no costs or suppliers). With ?customer=, prices are that store's and
 * the products stores of its kind buy come first; picked products start a quote or an order.
 */
export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const me = await requireUser(PIPELINE);
  const { customer: customerId } = await searchParams;
  const db = await getDb();
  const store = customerId && /^[0-9a-f-]{36}$/i.test(customerId) ? (await db.select().from(customers).where(eq(customers.id, customerId)).limit(1))[0] : null;
  if (customerId && (!store || !mayServe(me, store))) notFound();

  const [rows, own, popular] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        category: products.category,
        description: products.description,
        packSize: products.packSize,
        unit: products.unit,
        priceCents: products.priceCents,
        minQty: products.minQty,
        stock: products.stock,
        updatedAt: products.updatedAt,
        image: products.imageMime,
      })
      .from(products)
      .where(eq(products.active, true)),
    store ? db.select({ productId: customerPrices.productId, priceCents: customerPrices.priceCents }).from(customerPrices).where(eq(customerPrices.customerId, store.id)) : [],
    popularProducts(db, 2000, store?.storeType ?? null),
  ]);
  const ownPrice = new Map(own.map((o) => [o.productId, o.priceCents]));
  const rank = new Map(popular.map((p, i) => [p.id, { i, stores: p.stores }]));

  return (
    <CatalogClient
      store={store ? { id: store.id, name: store.name, type: store.storeType ? STORE_TYPES[store.storeType] : null, active: store.active } : null}
      products={rows
        .map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          category: p.category,
          description: p.description,
          packSize: p.packSize,
          unit: p.unit,
          priceCents: ownPrice.get(p.id) ?? p.priceCents,
          listCents: p.priceCents,
          minQty: p.minQty,
          stock: p.stock,
          image: p.image ? productImageUrl(p) : null,
          stores: rank.get(p.id)?.stores ?? 0,
          rank: rank.get(p.id)?.i ?? Number.MAX_SAFE_INTEGER,
        }))
        .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))}
    />
  );
}
