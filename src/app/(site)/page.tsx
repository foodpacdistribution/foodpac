import { ArrowRight, ArrowUpRight, Camera, PackageCheck, ReceiptText, Truck, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { JsonLd } from "@/components/json-ld";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getDepots } from "@/lib/planning";
import { listCatalog, listCategories, posterPhotos, recentlyBought } from "@/lib/shop";
import { siteUrl } from "@/lib/site-url";
import { ViewTransition } from "react";
import { CATEGORIES, categoryHref, categorySlug, POSTERS, SITE } from "./content";
import { HeroCarousel } from "./hero-carousel";
import { PosterSlide } from "./posters";
import { Contact, Delivery, HowItWorks, Promises } from "./sections";
import { ProductCard } from "./shop-ui";
import { T, Tx } from "@/components/i18n";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function HomePage() {
  const viewer = await getCurrentCustomer();
  const customer = viewer?.customer ?? null;
  const db = await getDb();
  const [featured, counts, recent, [depot], photos] = await Promise.all([
    listCatalog(db, customer, { featured: true, limit: 8 }),
    listCategories(db),
    customer ? recentlyBought(db, customer, 4) : Promise.resolve([]),
    getDepots(db),
    // Product photos for the posters that show some.
    Promise.all(POSTERS.map((p) => (p.art === "products" && !p.image ? posterPhotos(db, p.categories ?? []) : Promise.resolve([])))),
  ]);
  const popular = featured.length ? featured : await listCatalog(db, customer, { limit: 8 });
  const total = counts.reduce((t, c) => t + c.n, 0);

  // Tells Google who the business is (name, logo, where, when, how to reach it): what it draws on
  // for the business panel beside the results. The address is the depot's unless one is set in content.ts.
  const base = siteUrl();
  const address = SITE.address || depot?.address;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": ["Organization", "WholesaleStore"],
        "@id": `${base}/#organization`,
        name: SITE.name,
        url: base,
        logo: `${base}/brand/foodpac-logo-square.png`,
        image: `${base}/opengraph-image.png`,
        description: `${SITE.tagline} Wholesale food packaging, consumables and dry goods for cafés, restaurants and takeaway shops across ${SITE.serviceArea}.`,
        areaServed: { "@type": "AdministrativeArea", name: SITE.serviceArea },
        openingHours: SITE.openingHours,
        ...(address ? { address: { "@type": "PostalAddress", streetAddress: address, addressRegion: "QLD", addressCountry: "AU" } } : {}),
        ...(depot ? { geo: { "@type": "GeoCoordinates", latitude: depot.lat, longitude: depot.lng } } : {}),
        ...(SITE.phone ? { telephone: SITE.phone } : {}),
        ...(SITE.email ? { email: SITE.email } : {}),
        ...(SITE.abn ? { taxID: SITE.abn } : {}),
        ...(SITE.sameAs.length ? { sameAs: SITE.sameAs } : {}),
        hasOfferCatalog: {
          "@type": "OfferCatalog",
          name: "Products",
          itemListElement: CATEGORIES.map((c) => ({ "@type": "OfferCatalog", name: c.title, url: `${base}${categoryHref(c.title)}` })),
        },
      },
      {
        "@type": "WebSite",
        "@id": `${base}/#website`,
        url: base,
        name: SITE.name,
        publisher: { "@id": `${base}/#organization` },
        potentialAction: { "@type": "SearchAction", target: `${base}/products?q={search_term_string}`, "query-input": "required name=search_term_string" },
      },
    ],
  };

  return (
    <main>
      <JsonLd data={jsonLd} />
      <HeroCarousel
        slides={POSTERS.map((poster, i) => ({
          id: poster.id,
          tab: poster.tab,
          content: <PosterSlide poster={poster} first={i === 0} signedIn={!!viewer} counts={counts} photos={photos[i]} />,
        }))}
      />

      {/* What every customer gets, right under the posters. */}
      <section className="border-b border-leaf-950/10 bg-white">
        <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-x-4 gap-y-5 px-4 py-6 sm:px-6 lg:grid-cols-4">
          {[
            { icon: PackageCheck, title: <T vars={{ n: total }}>{"{n} products"}</T>, text: <T vars={{ n: CATEGORIES.length }}>{"Across {n} ranges"}</T> },
            { icon: Truck, title: <T>{"Weekday delivery runs"}</T>, text: <T>{SITE.serviceArea}</T> },
            { icon: Camera, title: <T>{"Proof on every drop"}</T>, text: <T>{"Photo and signature at the door"}</T> },
            { icon: ReceiptText, title: <T>{"Your trade prices"}</T>, text: <T>{"One account, one invoice"}</T> },
          ].map(({ icon: Icon, title, text }, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-leaf-50 text-leaf-700">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-xs text-leaf-900/55">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {recent.length > 0 && (
        <Shelf title={<T>{"Buy again"}</T>} link={{ href: "/portal/quick-order", label: "Quick order" }}>
          {recent.map((p) => (
            <ProductCard key={p.id} p={p} signedIn />
          ))}
        </Shelf>
      )}

      <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
        <div className="flex items-end justify-between">
          <h2 className="font-display text-2xl font-semibold tracking-tight"><T>{"Shop by category"}</T></h2>
          <Link href="/products" className="text-sm font-semibold text-leaf-700 hover:underline">
            <T>{"See all"}</T>
          </Link>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
          {CATEGORIES.map(({ icon: Icon, title, text }, i) => (
            <Link
              key={title}
              href={categoryHref(title)}
              style={{ "--i": i } as React.CSSProperties}
              className="stagger group relative flex flex-col overflow-hidden rounded-2xl border border-leaf-950/10 bg-white p-4 transition-[border-color,box-shadow,translate,scale] duration-300 ease-out hover:-translate-y-1 hover:border-leaf-700/30 hover:shadow-[0_16px_32px_-16px_rgb(17_58_39/0.35)] active:scale-[0.97] sm:p-5"
            >
              {/* Colour wipes up from the bottom on hover. */}
              <span aria-hidden className="absolute inset-0 origin-bottom scale-y-0 bg-gradient-to-t from-leaf-50 to-cream/40 transition-transform duration-500 ease-out group-hover:scale-y-100" />
              <ArrowUpRight aria-hidden className="absolute top-4 right-4 size-4 -translate-x-1 translate-y-1 text-leaf-700 opacity-0 transition-[opacity,translate] duration-300 group-hover:translate-0 group-hover:opacity-100" />
              {/* Glides into the category page's banner (same name there). */}
              <ViewTransition name={`category-${categorySlug(title)}`} share="morph" default="none">
                <span className="relative grid size-12 place-items-center rounded-2xl bg-leaf-50 text-leaf-700 transition-[background-color,color,rotate,scale] duration-300 group-hover:scale-110 group-hover:-rotate-6 group-hover:bg-leaf-700 group-hover:text-white">
                  <Icon className="size-5" />
                </span>
              </ViewTransition>
              <span className="relative mt-4 text-sm leading-tight font-semibold"><T>{title}</T></span>
              <span className="relative mt-1 text-xs text-leaf-900/50">
                <T vars={{ n: counts.find((c) => c.name === title)?.n ?? 0 }}>{"{n} products"}</T>
              </span>
              <span className="relative mt-2 hidden text-xs leading-relaxed text-leaf-900/60 sm:line-clamp-3"><T>{text}</T></span>
            </Link>
          ))}
        </div>
      </section>

      <Shelf title={featured.length ? "Popular products" : "Products"} link={{ href: "/products", label: "See all" }}>
        {popular.map((p) => (
          <ProductCard key={p.id} p={p} signedIn={!!viewer} />
        ))}
      </Shelf>

      {viewer && (
        <section className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
          <Link href="/portal/quick-order" className="flex items-center gap-4 rounded-3xl bg-leaf-50 p-5 ring-1 ring-leaf-700/15 hover:bg-leaf-100">
            <span className="grid size-11 place-items-center rounded-2xl bg-leaf-700 text-white">
              <Zap className="size-5" />
            </span>
            <span className="flex-1">
              <span className="block font-semibold"><T>{"Quick order by SKU"}</T></span>
              <span className="block text-sm text-leaf-900/65"><T>{"Paste your usual list of codes and quantities and check out in a minute."}</T></span>
            </span>
            <ArrowRight className="size-5 text-leaf-700" />
          </Link>
        </section>
      )}

      <div className="mt-12">
        <Promises />
        <HowItWorks />
        <Delivery />
        <Contact />
      </div>
    </main>
  );
}

function Shelf({ title, link, children }: { title: React.ReactNode; link: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
      <div className="flex items-end justify-between">
        <h2 className="font-display text-2xl font-semibold tracking-tight">{<Tx>{title}</Tx>}</h2>
        <Link href={link.href} className="text-sm font-semibold text-leaf-700 hover:underline">
          <T>{link.label}</T>
        </Link>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{children}</div>
    </section>
  );
}
