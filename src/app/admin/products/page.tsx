import { asc, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { CATEGORIES } from "@/app/(site)/content";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { ProductsClient } from "./products-client";

export const metadata: Metadata = { title: "Products & Stock" };

export default async function ProductsPage() {
  const me = await requireUser(STAFF);
  const db = await getDb();
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      category: products.category,
      description: products.description,
      packSize: products.packSize,
      unit: products.unit,
      priceCents: products.priceCents,
      gst: products.gst,
      minQty: products.minQty,
      stock: products.stock,
      featured: products.featured,
      active: products.active,
      hasImage: sql<boolean>`${products.image} is not null`,
    })
    .from(products)
    .orderBy(asc(products.category), asc(products.name));
  const categories = [...new Set([...CATEGORIES.map((c) => c.title), ...rows.map((r) => r.category)])];
  return <ProductsClient products={rows} categories={categories} isAdmin={me.role === "admin"} />;
}
