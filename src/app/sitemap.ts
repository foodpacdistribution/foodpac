import { eq } from "drizzle-orm";
import type { MetadataRoute } from "next";
import { CATEGORIES, categoryHref } from "@/app/(site)/content";
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
    ...CATEGORIES.map((c) => ({ url: `${base}${categoryHref(c.title)}`, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
  try {
    const rows = await (await getDb())
      .select({ sku: products.sku, category: products.category, at: products.updatedAt })
      .from(products)
      .where(eq(products.active, true));
    // Categories added in the back office beyond the standard six.
    const extra = [...new Set(rows.map((p) => p.category))].filter((c) => c && !CATEGORIES.some((x) => x.title === c));
    return [
      ...pages,
      ...extra.map((c) => ({ url: `${base}${categoryHref(c)}`, changeFrequency: "weekly" as const, priority: 0.7 })),
      ...rows.map((p) => ({ url: `${base}/products/${encodeURIComponent(p.sku)}`, lastModified: p.at, changeFrequency: "weekly" as const, priority: 0.6 })),
    ];
  } catch {
    // No database reachable (e.g. during a build without one): list the fixed pages only.
    return pages;
  }
}
