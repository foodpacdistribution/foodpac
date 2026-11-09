import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { getDb } from "@/lib/db";
import { listCategories } from "@/lib/shop";
import { siteUrl } from "@/lib/site-url";
import { CATEGORIES, categoryHref, categoryInfo, categorySlug, SITE } from "../../content";
import ProductsPage from "../../products/page";

// Each category has its own address, title and description, which is what search engines list
// (and pick sitelinks from). Filters and sorting still go through /products.

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; sort?: string; stock?: string }> };

/** The standard ranges in the menu always exist (even before they have products), plus any category products use. */
async function categoryFor(slug: string) {
  const standard = CATEGORIES.find((c) => categorySlug(c.title) === slug);
  if (standard) return standard.title;
  const names = (await listCategories(await getDb())).map((c) => c.name);
  return names.find((n) => categorySlug(n) === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const name = await categoryFor((await params).slug);
  if (!name) return {};
  const blurb = categoryInfo(name).text || `${name} for cafés, restaurants and takeaway shops.`;
  const description = `${blurb} Trade prices and delivery across ${SITE.serviceArea} from ${SITE.name}.`;
  // A range with nothing on sale yet is an empty page: keep it out of search until it has products.
  const stocked = (await listCategories(await getDb())).some((c) => c.name === name && c.n > 0);
  return {
    title: `${name} – wholesale supply`,
    description,
    alternates: { canonical: categoryHref(name) },
    openGraph: { title: `${name} – wholesale supply · ${SITE.name}`, description, url: categoryHref(name) },
    ...(stocked ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const name = await categoryFor((await params).slug);
  if (!name) notFound();
  const base = siteUrl();
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: base },
            { "@type": "ListItem", position: 2, name: "Products", item: `${base}/products` },
            { "@type": "ListItem", position: 3, name, item: `${base}${categoryHref(name)}` },
          ],
        }}
      />
      <ProductsPage searchParams={searchParams.then((sp) => ({ ...sp, category: name }))} />
    </>
  );
}
