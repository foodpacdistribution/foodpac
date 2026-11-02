"use server";

import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customerPrices, products } from "@/lib/db/schema";
import { parseDollars } from "@/lib/money";
import { checkProductRow, duplicateSkus, MAX_IMPORT_ROWS, type ProductImportRow, type ProductValues } from "@/lib/product-import";
import { UserError } from "@/lib/planning";
import { readUpload } from "@/lib/proofs";

function revalidate() {
  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
}

export async function saveProduct(_prev: unknown, form: FormData) {
  return attempt(async () => {
    await assertUser(STAFF);
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
    if (id) await db.update(products).set(values).where(eq(products.id, id));
    else await db.insert(products).values(values);
    revalidate();
    return { message: id ? "Product saved" : "Product added" };
  });
}

/** Goods received (+) or written off / counted short (−). */
export async function adjustStock(productId: string, delta: number) {
  return attempt(async () => {
    await assertUser(STAFF);
    if (!Number.isInteger(delta) || delta === 0) throw new UserError("Enter a whole number.");
    const db = await getDb();
    const [p] = await db
      .update(products)
      .set({ stock: sql`greatest(0, ${products.stock} + ${delta})` })
      .where(eq(products.id, productId))
      .returning({ stock: products.stock, name: products.name });
    if (!p) throw new UserError("Product not found.");
    revalidate();
    return { message: `${p.name}: ${p.stock} in stock` };
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
    revalidatePath(`/admin/customers/${customerId}`);
    return { message: price.trim() === "" ? "Back to list price" : "Price saved" };
  });
}

export type ProductImportResult = { created: number; updated: number; errors: { row: number; message: string }[] };

/**
 * Creates new products and updates existing ones, matched by SKU. Empty cells leave the current
 * value alone, so a file with only SKU + price just updates prices. Every row is checked again
 * here; nothing is saved if any row has a problem.
 */
export async function importProducts(rows: ProductImportRow[], opts: { pricesIncGst: boolean; gstColumnHeader?: string }) {
  return attempt<ProductImportResult>(async () => {
    await assertUser(STAFF);
    if (!Array.isArray(rows) || !rows.length) throw new UserError("The file has no rows.");
    if (rows.length > MAX_IMPORT_ROWS) throw new UserError(`Import at most ${MAX_IMPORT_ROWS} products at a time.`);

    const errors: ProductImportResult["errors"] = [];
    const values: ProductValues[] = [];
    const dupes = duplicateSkus(rows);
    rows.forEach((r, i) => {
      if (dupes.has(i)) return errors.push({ row: i + 2, message: `Same SKU as row ${dupes.get(i)! + 2}` });
      const c = checkProductRow(r, opts);
      if (c.ok) values.push(c.value);
      else errors.push({ row: i + 2, message: c.error });
    });

    const db = await getDb();
    const existing = new Set<string>();
    for (let i = 0; i < values.length; i += 500) {
      const skus = values.slice(i, i + 500).map((v) => v.sku);
      for (const r of await db.select({ sku: products.sku }).from(products).where(inArray(products.sku, skus))) existing.add(r.sku);
    }
    values.forEach((v) => {
      if (existing.has(v.sku)) return;
      const missing = [!v.name && "name", v.priceCents === undefined && "price"].filter(Boolean);
      if (missing.length) errors.push({ row: rows.findIndex((r) => (r.sku ?? "").trim().toUpperCase().replace(/\s+/g, "-") === v.sku) + 2, message: `New product ${v.sku} needs a ${missing.join(" and ")}` });
    });
    if (errors.length) return { data: { created: 0, updated: 0, errors: errors.sort((a, b) => a.row - b.row) } };

    const toCreate = values.filter((v) => !existing.has(v.sku));
    const toUpdate = values.filter((v) => existing.has(v.sku));
    await db.transaction(async (tx) => {
      for (let i = 0; i < toCreate.length; i += 200) {
        await tx.insert(products).values(
          toCreate.slice(i, i + 200).map((v) => ({
            sku: v.sku,
            name: v.name!,
            priceCents: v.priceCents!,
            category: v.category ?? "Other",
            packSize: v.packSize ?? "",
            unit: v.unit ?? "carton",
            minQty: v.minQty ?? 1,
            stock: v.stock ?? 0,
            barcode: v.barcode ?? null,
            description: v.description ?? "",
            gst: v.gst ?? true,
            featured: v.featured ?? false,
            active: v.active ?? true,
          })),
        );
      }
      for (const { sku, ...set } of toUpdate) {
        if (Object.keys(set).length) await tx.update(products).set({ ...set, updatedAt: new Date() }).where(eq(products.sku, sku));
      }
    });
    revalidate();
    return { data: { created: toCreate.length, updated: toUpdate.length, errors: [] } };
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
