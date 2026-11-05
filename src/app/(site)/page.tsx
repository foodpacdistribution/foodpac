import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { JsonLd } from "@/components/json-ld";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getDepots, getSettings } from "@/lib/planning";
import { livePosters } from "@/lib/posters";
import { listCatalog, listCategories, posterPhotos, recentlyBought } from "@/lib/shop";
import { siteUrl } from "@/lib/site-url";
import { CATEGORIES, categoryHref, POSTERS, SITE } from "./content";
import { HeroCarousel } from "./hero-carousel";
import { PosterSlide, UploadedPosterSlide } from "./posters";
import { Contact, HowItWorks } from "./sections";
import { siteInfo } from "./site-info";
import { ProductCard, ProductCount } from "./shop-ui";
import { T, Tx } from "@/components/i18n";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function HomePage() {
  const viewer = await getCurrentCustomer();
  const customer = viewer?.customer ?? null;
  const db = await getDb();
  const [featured, counts, recent, [depot], photos, settings, uploaded] = await Promise.all([
    listCatalog(db, customer, { featured: true, limit: 8 }),
    listCategories(db),
    customer ? recentlyBought(db, customer, 4) : Promise.resolve([]),
    getDepots(db),
    // Product photos for the posters that show some.
    Promise.all(POSTERS.map((p) => (p.art === "products" && !p.image ? posterPhotos(db, p.categories ?? []) : Promise.resolve([])))),
    getSettings(db),
    livePosters(db),
  ]);
  // Posters uploaded in the back office come first; the built-in ones follow unless switched off
  // there (and always show when nothing uploaded is live, so the top of the page is never empty).
  const builtIn = uploaded.length === 0 || settings.builtInPosters;
  const site = siteInfo(settings);
  const popular = featured.length ? featured : await listCatalog(db, customer, { limit: 8 });
  const total = counts.reduce((t, c) => t + c.n, 0);

  // Tells Google who the business is (name, logo, where, when, how to reach it): what it draws on
  // for the business panel beside the results. The address is the depot's unless one is set in content.ts.
  const base = siteUrl();
  const address = site.address || depot?.address;
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
        openingHours: site.openingHours,
        ...(address ? { address: { "@type": "PostalAddress", streetAddress: address, addressRegion: "QLD", addressCountry: "AU" } } : {}),
        ...(depot ? { geo: { "@type": "GeoCoordinates", latitude: depot.lat, longitude: depot.lng } } : {}),
        ...(site.phone ? { telephone: site.phone } : {}),
        ...(site.email ? { email: site.email } : {}),
        ...(site.abn ? { taxID: site.abn } : {}),
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
        slides={[
          ...uploaded.map((poster, i) => ({
            id: poster.id,
            tab: poster.name,
            content: <UploadedPosterSlide poster={poster} first={i === 0} />,
          })),
          ...(builtIn ? POSTERS : []).map((poster, i) => ({
            id: poster.id,
            tab: poster.tab,
            content: <PosterSlide poster={poster} first={uploaded.length === 0 && i === 0} signedIn={!!viewer} counts={counts} photos={photos[i]} />,
          })),
        ]}
      />

      {/* The plain facts, right under the posters. */}
      <section className="border-b border-leaf-950/10 bg-white">
        <ul className="mx-auto grid max-w-6xl grid-cols-2 px-4 sm:px-6 lg:grid-cols-4">
          {[
            { title: total > 0 ? <ProductCount n={total} /> : <T>{"Order online"}</T>, text: <T vars={{ n: CATEGORIES.length }}>{"Across {n} ranges"}</T> },
            { title: <T>{"Weekday delivery runs"}</T>, text: <T>{SITE.serviceArea}</T> },
            { title: <T>{"Proof on every drop"}</T>, text: <T>{"Photo and signature at the door"}</T> },
            { title: <T>{"Your trade prices"}</T>, text: <T>{"One account, one invoice"}</T> },
          ].map(({ title, text }, i) => (
            <li key={i} className="border-leaf-950/10 py-4 leading-tight max-lg:odd:pr-4 max-lg:even:border-l max-lg:even:pl-4 max-lg:[&:nth-child(n+3)]:border-t lg:border-l lg:px-5 lg:first:border-l-0 lg:first:pl-0">
              <span className="block text-sm font-semibold">{title}</span>
              <span className="mt-0.5 block text-xs text-leaf-900/55">{text}</span>
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
        <SectionHead title={<T>{"Shop by range"}</T>} link={{ href: "/products", label: "All products" }} />
        {/* A ruled index of the ranges, like the contents page of a printed catalogue. */}
        <div className="mt-5 grid border-t border-l border-leaf-950/15 bg-white sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map(({ title, text }) => (
            <Link key={title} href={categoryHref(title)} className="group flex flex-col border-r border-b border-leaf-950/15 p-5 transition-colors hover:bg-leaf-50">
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-display text-lg font-semibold tracking-tight group-hover:underline group-hover:underline-offset-4">
                  <T>{title}</T>
                </span>
                <span className="shrink-0 text-xs text-leaf-900/50 tabular-nums">
                  <ProductCount n={counts.find((c) => c.name === title)?.n ?? 0} />
                </span>
              </span>
              <span className="mt-1.5 text-sm leading-relaxed text-leaf-900/65">
                <T>{text}</T>
              </span>
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
          <Link href="/portal/quick-order" className="group flex items-center gap-4 rounded-lg border border-leaf-950/15 bg-white p-5 hover:border-leaf-950/30">
            <span className="flex-1">
              <span className="block font-semibold"><T>{"Quick order by SKU"}</T></span>
              <span className="block text-sm text-leaf-900/65"><T>{"Paste your usual list of codes and quantities and check out in a minute."}</T></span>
            </span>
            <ArrowRight className="size-5 text-leaf-900/50 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </section>
      )}

      <div className="mt-14">
        <HowItWorks site={site} />
        <Contact site={site} />
      </div>
    </main>
  );
}

function SectionHead({ title, link }: { title: React.ReactNode; link: { href: string; label: string } }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-leaf-950/15 pb-3">
      <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">{<Tx>{title}</Tx>}</h2>
      <Link href={link.href} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-leaf-800 hover:underline hover:underline-offset-2">
        <T>{link.label}</T> <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

function Shelf({ title, link, children }: { title: React.ReactNode; link: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
      <SectionHead title={title} link={link} />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{children}</div>
    </section>
  );
}
