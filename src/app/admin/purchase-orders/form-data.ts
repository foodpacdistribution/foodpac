import "server-only";
import { asc, desc, eq, or, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { products, purchaseOrderItems, purchaseOrders, suppliers } from "@/lib/db/schema";
import type { PoFormProduct } from "./po-form";

/** Suppliers and products for the purchase order form, with the last price paid for each product. */
export async function poFormData(db: DB, keepSupplierId?: string) {
  const [sups, prods, last] = await Promise.all([
    db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(keepSupplierId ? or(eq(suppliers.active, true), eq(suppliers.id, keepSupplierId)) : eq(suppliers.active, true))
      .orderBy(asc(suppliers.name)),
    db.select({ id: products.id, sku: products.sku, name: products.name, unit: products.unit, packSize: products.packSize, gst: products.gst, stock: products.stock }).from(products).orderBy(asc(products.name)),
    db
      .selectDistinctOn([purchaseOrderItems.productId], { productId: purchaseOrderItems.productId, unitCost: purchaseOrderItems.unitCost })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
      .where(sql`${purchaseOrders.status} <> 'cancelled'`)
      .orderBy(purchaseOrderItems.productId, desc(purchaseOrders.createdAt)),
  ]);
  const cost = new Map(last.map((l) => [l.productId, l.unitCost]));
  const productList: PoFormProduct[] = prods.map((p) => ({ ...p, lastCost: cost.get(p.id) ?? null }));
  return { suppliers: sups, products: productList };
}
