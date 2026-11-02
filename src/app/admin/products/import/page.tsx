import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { ProductImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import products" };

export default async function ImportProductsPage() {
  await requireUser(STAFF);
  const rows = await (await getDb()).select({ sku: products.sku }).from(products);
  return <ProductImportClient existingSkus={rows.map((r) => r.sku)} />;
}
