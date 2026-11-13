import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { ProductPhotosClient } from "./photos-client";

export const metadata: Metadata = { title: "Upload product photos" };

export default async function ProductPhotosPage() {
  await requireUser(STAFF);
  const [counts] = await (await getDb())
    .select({ total: sql<number>`count(*)::int`, withPhoto: sql<number>`count(*) filter (where ${products.image} is not null)::int` })
    .from(products);
  return <ProductPhotosClient total={counts?.total ?? 0} withPhoto={counts?.withPhoto ?? 0} />;
}
