import { eq } from "drizzle-orm";
import type { MetadataRoute } from "next";
import { CATEGORIES } from "@/app/(site)/content";
import { getDb } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { siteUrl } from "@/lib/site-url";

// Rebuilt hourly so new products reach Google without a redeploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const pages: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/products`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/register`, changeFrequency: "yearly", priority: 0.5 },
    ...CATEGORIES.map((c) => ({ url: `${base}/products?category=${encodeURIComponent(c.title)}`, changeFrequency: "weekly" as const, priority: 0.7 })),
  ];
  try {
    const rows = await (await getDb()).select({ sku: products.sku, at: products.createdAt }).from(products).where(eq(products.active, true));
    return [...pages, ...rows.map((p) => ({ url: `${base}/products/${encodeURIComponent(p.sku)}`, lastModified: p.at, changeFrequency: "weekly" as const, priority: 0.6 }))];
  } catch {
    // No database reachable (e.g. during a build without one): list the fixed pages only.
    return pages;
  }
}
