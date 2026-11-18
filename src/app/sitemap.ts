import { eq, sql } from "drizzle-orm";
import type { MetadataRoute } from "next";
import { CATEGORIES, categoryHref } from "@/app/(site)/content";
import { getDb } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { zhPath } from "@/lib/i18n";
import { productImageUrl } from "@/lib/product-image";
import { siteUrl } from "@/lib/site-url";

// Rebuilt hourly so new products reach Google without a redeploy.
export const revalidate = 3600;

/** Each public page in English and at its Chinese /zh address, each pointing at the other. */
function bothLanguages(base: string, entries: MetadataRoute.Sitemap): MetadataRoute.Sitemap {
  return entries.flatMap((e) => {
    const path = e.url.slice(base.length) || "/";
    const languages = { "en-AU": `${base}${path === "/" ? "" : path}`, "zh-CN": `${base}${zhPath(path)}` };
    return [
      { ...e, alternates: { languages } },
      { ...e, url: languages["zh-CN"], alternates: { languages } },
    ];
  });
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return bothLanguages(siteUrl(), await englishPages());
}

async function englishPages(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const pages: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/products`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/delivery`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/register`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/returns`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
  const category = (name: string) => ({ url: `${base}${categoryHref(name)}`, changeFrequency: "weekly" as const, priority: 0.8 });
  try {
    const rows = await (await getDb())
      .select({ id: products.id, sku: products.sku, category: products.category, at: products.updatedAt, imageAt: products.imageAt, hasImage: sql<boolean>`${products.image} is not null` })
      .from(products)
      .where(eq(products.active, true));
    // Only ranges with something on sale: an empty category page is thin content. The standard six
    // come first in their usual order, then any added in the back office.
    const stocked = new Set(rows.map((p) => p.category).filter(Boolean));
    const extra = [...stocked].filter((c) => !CATEGORIES.some((x) => x.title === c));
    return [
      ...pages,
      ...CATEGORIES.filter((c) => stocked.has(c.title)).map((c) => category(c.title)),
      ...extra.map((c) => ({ ...category(c), priority: 0.7 })),
      // With its photo, so products can turn up in Google Images too.
      ...rows.map((p) => ({
        url: `${base}/products/${encodeURIComponent(p.sku)}`,
        lastModified: p.at,
        changeFrequency: "weekly" as const,
        priority: 0.6,
        ...(p.hasImage ? { images: [`${base}${productImageUrl(p)}`] } : {}),
      })),
    ];
  } catch {
    // No database reachable (e.g. during a build without one): list the fixed pages and standard ranges.
    return [...pages, ...CATEGORIES.map((c) => category(c.title))];
  }
}
