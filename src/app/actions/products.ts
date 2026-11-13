"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { type DB, getDb } from "@/lib/db";
import { customerPrices, products } from "@/lib/db/schema";
import { parseDollars } from "@/lib/money";
import { MAX_IMPORT_ROWS, type ProductImportRow } from "@/lib/product-import";
import { UserError } from "@/lib/planning";
import { codeFromFileName, goodsKey } from "@/lib/goods-photos";
import { applyProductImport, type ProductImportResult } from "@/lib/product-import-apply";
import { readUpload } from "@/lib/proofs";
import { fillWaiting } from "@/lib/stock-allocation";
import { changeStock, setStock } from "@/lib/stock-ledger";

function revalidate() {
  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
}

/**
 * One photo from a bulk upload. The file is named after the product: its code ("RB-BOWLPA16.jpg",
 * also the old EMERGE code, e.g. "RB-BAPAW1/2B") or its exact name. Replaces the current photo.
 */
export async function uploadProductPhoto(form: FormData) {
  return attempt<{ sku: string; name: string }>(async () => {
    await assertUser(STAFF);
    const fileName = String(form.get("fileName") ?? "").slice(0, 300);
    const image = await readUpload(form.get("photo"), "Photo");
    if (!fileName || !image) throw new UserError("No photo.");
    const db = await getDb();
    const code = codeFromFileName(fileName);
    const byName = goodsKey(fileName.replace(/\.[a-z0-9]{2,5}$/i, ""));
    const [p] =
      (code ? await db.select({ id: products.id, sku: products.sku, name: products.name }).from(products).where(eq(products.sku, code)).limit(1) : []).concat(
        await db
          .select({ id: products.id, sku: products.sku, name: products.name })
          .from(products)
          .where(sql`lower(regexp_replace(trim(${products.name}), '\\s+', ' ', 'g')) = ${byName}`)
          .limit(1),
      );
    if (!p) throw new UserError("No product has this code or name.");
    await db.update(products).set({ image: image.data, imageMime: image.mime, updatedAt: new Date() }).where(eq(products.id, p.id));
    revalidate();
    return { data: { sku: p.sku, name: p.name } };
  });
}

export async function saveProduct(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    const db = await getDb();
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const id = get("id") || null;
    const sku = get("sku").toUpperCase();
    const name = get("name");
    const priceCents = parseDollars(get("price"));
    if (!sku || !/^[A-Z0-9._-]+$/.test(sku)) throw new UserError("SKU is required (letters, numbers, - . _ only).");
    if (!name) throw new UserError("Name is required.");
    if (priceCents === null) throw new UserError("Enter a price ex GST, e.g. 24.50.");
    const int = (k: string, min: number) => {
      const n = Math.round(Number(get(k) || min));
      if (!Number.isFinite(n) || n < min) throw new UserError(`${k === "minQty" ? "Minimum order" : "Stock"} must be ${min} or more.`);
      return n;
    };
    const image = await readUpload(form.get("image"), "Image");
    const values = {
      sku,
      name,
      priceCents,
      barcode: get("barcode") || null,
      category: get("category") || "Other",
      description: get("description"),
      packSize: get("packSize"),
      unit: get("unit") || "carton",
      minQty: int("minQty", 1),
      stock: int("stock", 0),
      gst: form.get("gst") === "on",
      featured: form.get("featured") === "on",
      active: form.get("active") === "on",
      updatedAt: new Date(),
      ...(image ? { image: image.data, imageMime: image.mime } : {}),
      ...(form.get("removeImage") === "on" && !image ? { image: null, imageMime: null } : {}),
    };
    const [clash] = await db.select({ id: products.id }).from(products).where(eq(products.sku, sku)).limit(1);
    if (clash && clash.id !== id) throw new UserError("Another product already uses that SKU.");
    // A new product's stock is its opening balance in the ledger; on an existing one, a different
    // figure is a stock count, recorded as the difference.
    const { stock, ...rest } = values;
    const productId = await db.transaction(async (t) => {
      const tx = t as unknown as DB;
      if (!id) return (await tx.insert(products).values(values).returning({ id: products.id }))[0].id;
      const [row] = await tx.update(products).set(rest).where(eq(products.id, id)).returning({ id: products.id });
      if (row) await setStock(tx, row.id, stock, { type: "count", note: "Stock count on the product page", by: user.id });
      return row?.id;
    });
    // A higher stock count may be goods that waiting customers are owed.
    if (productId) await fillWaiting(db, [productId]);
    revalidate();
    return { message: id ? "Product saved" : "Product added" };
  });
}

/** Goods received (+) or written off / counted short (−). */
export async function adjustStock(productId: string, delta: number, reason?: string) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    if (!Number.isInteger(delta) || delta === 0) throw new UserError("Enter a whole number.");
    const db = await getDb();
    const note = String(reason ?? "").trim().slice(0, 300) || (delta > 0 ? "Added by hand" : "Taken off by hand");
    const { p, filled } = await db.transaction(async (tx) => {
      const p = await changeStock(tx as unknown as DB, productId, delta, { type: "adjustment", note, by: user.id }, { floorZero: true });
      if (!p) throw new UserError("Product not found.");
      // Goods received go to customers waiting for them first.
      const filled = delta > 0 ? await fillWaiting(tx as unknown as DB, [productId]) : [];
      const [{ stock }] = await tx.select({ stock: products.stock }).from(products).where(eq(products.id, productId));
      return { p: { ...p, stock }, filled };
    });
    revalidate();
    revalidatePath("/admin/sales");
    const toWaiting = filled.reduce((t, f) => t + f.qty, 0);
    return { message: toWaiting ? `${p.name}: ${toWaiting} to waiting orders, ${p.stock} in stock` : `${p.name}: ${p.stock} in stock` };
  });
}

export async function setCustomerPrice(customerId: string, productId: string, price: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    const cents = parseDollars(price);
    if (price.trim() === "") {
      await db.delete(customerPrices).where(sql`${customerPrices.customerId} = ${customerId} and ${customerPrices.productId} = ${productId}`);
    } else {
      if (cents === null) throw new UserError("Enter a price, e.g. 21.90.");
      await db
        .insert(customerPrices)
        .values({ customerId, productId, priceCents: cents })
        .onConflictDoUpdate({ target: [customerPrices.customerId, customerPrices.productId], set: { priceCents: cents } });
    }
    revalidatePath(`/admin/customers/${customerId}/prices`);
    return { message: price.trim() === "" ? "Back to list price" : "Price saved" };
  });
}

/**
 * Customer prices for many products at once: `percent` off each product's list price
 * (e.g. 10 = 10% off), or `null` to put them back on the list price.
 */
export async function setCustomerDiscount(customerId: string, productIds: string[], percent: number | null) {
  return attempt(async () => {
    await assertUser(STAFF);
    if (!Array.isArray(productIds) || !productIds.length) throw new UserError("Select at least one product.");
    const db = await getDb();
    const ids = productIds.slice(0, 2000);
    if (percent === null) {
      await db.delete(customerPrices).where(and(eq(customerPrices.customerId, customerId), inArray(customerPrices.productId, ids)));
      revalidatePath(`/admin/customers/${customerId}/prices`);
      revalidatePath("/", "layout");
      return { message: `${ids.length} products back to list price` };
    }
    const pct = Number(percent);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) throw new UserError("Enter a discount between 0 and 100, e.g. 10 for 10% off.");
    const list = await db.select({ id: products.id, priceCents: products.priceCents }).from(products).where(inArray(products.id, ids));
    if (!list.length) throw new UserError("Product not found.");
    await db
      .insert(customerPrices)
      .values(list.map((p) => ({ customerId, productId: p.id, priceCents: Math.max(1, Math.round(p.priceCents * (1 - pct / 100))) })))
      .onConflictDoUpdate({ target: [customerPrices.customerId, customerPrices.productId], set: { priceCents: sql`excluded.price_cents` } });
    revalidatePath(`/admin/customers/${customerId}/prices`);
    revalidatePath("/", "layout");
    return { message: `${pct}% off ${list.length} products` };
  });
}

export type { ProductImportResult } from "@/lib/product-import-apply";

/**
 * Creates new products and updates existing ones, matched by SKU. Empty cells leave the current
 * value alone, so a file with only SKU + price just updates prices. Every row is checked again
 * here; nothing is saved if any row has a problem.
 */
export async function importProducts(rows: ProductImportRow[], opts: { pricesIncGst: boolean; gstColumnHeader?: string }) {
  return attempt<ProductImportResult>(async () => {
    const user = await assertUser(STAFF);
    if (!Array.isArray(rows) || !rows.length) throw new UserError("The file has no rows.");
    if (rows.length > MAX_IMPORT_ROWS) throw new UserError(`Import at most ${MAX_IMPORT_ROWS} products at a time.`);

    const result = await applyProductImport(await getDb(), rows, opts, user.id);
    if (!result.errors.length) revalidate();
    return { data: result };
  });
}

/** Admin only. Past orders keep the product's name and SKU; it leaves carts and price lists. */
export async function deleteProduct(id: string) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    if (user.role !== "admin") throw new UserError("Only an admin can delete products.");
    const db = await getDb();
    const [p] = await db.delete(products).where(eq(products.id, id)).returning({ name: products.name });
    if (!p) throw new UserError("Product not found.");
    revalidate();
    return { message: `${p.name} deleted` };
  });
}

export type ProductBulkOp =
  | { kind: "active"; value: boolean }
  | { kind: "featured"; value: boolean }
  | { kind: "category"; value: string }
  | { kind: "price"; percent: number }
  | { kind: "delete" };

/** One change applied to many products at once. Price changes round to the cent and never go below 1c. */
export async function bulkProducts(ids: string[], op: ProductBulkOp) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    if (!Array.isArray(ids) || !ids.length) throw new UserError("Select at least one product.");
    if (ids.length > 2000) throw new UserError("Select at most 2000 products at a time.");
    const db = await getDb();
    const where = inArray(products.id, ids);
    const now = new Date();
    let n: number;
    switch (op.kind) {
      case "active":
      case "featured":
        n = (await db.update(products).set({ [op.kind]: op.value, updatedAt: now }).where(where).returning({ id: products.id })).length;
        break;
      case "category": {
        const category = op.value.trim().slice(0, 80);
        if (!category) throw new UserError("Enter a category.");
        n = (await db.update(products).set({ category, updatedAt: now }).where(where).returning({ id: products.id })).length;
        break;
      }
      case "price": {
        const pct = Number(op.percent);
        if (!Number.isFinite(pct) || pct === 0 || pct <= -100 || pct > 500) throw new UserError("Enter a percentage between -99 and 500, e.g. 5 or -10.");
        n = (
          await db
            .update(products)
            .set({ priceCents: sql`greatest(1, round(${products.priceCents} * ${1 + pct / 100}))::int`, updatedAt: now })
            .where(where)
            .returning({ id: products.id })
        ).length;
        break;
      }
      case "delete":
        if (user.role !== "admin") throw new UserError("Only an admin can delete products.");
        n = (await db.delete(products).where(where).returning({ id: products.id })).length;
        break;
      default:
        throw new UserError("Unknown change.");
    }
    revalidate();
    return { message: op.kind === "delete" ? `Deleted ${n} products` : `${n} products updated` };
  });
}
