"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customerPrices, products } from "@/lib/db/schema";
import { parseDollars } from "@/lib/money";
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
