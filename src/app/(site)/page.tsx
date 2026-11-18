import { ArrowRight, Heart, ShoppingCart, Truck, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { JsonLd } from "@/components/json-ld";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getDepots, getSettings } from "@/lib/planning";
import { livePosters } from "@/lib/posters";
import { canSeePrices, getCart, listCatalog, posterPhotos, quote, recentlyBought } from "@/lib/shop";
import { lastOrder } from "@/app/portal/orders/data";
import { RepeatOrder } from "@/app/portal/repeat-order";
import { prettyDate } from "@/lib/dates";
import { aud } from "@/lib/money";
import { todayIn } from "@/lib/time";
import { siteUrl } from "@/lib/site-url";
import { categoryHref, POSTERS, SITE } from "./content";
import { HeroCarousel } from "./hero-carousel";
import { categoryCounts, stockedCategories } from "./live-categories";
import { PosterSlide, UploadedPosterSlide } from "./posters";
import { Contact, HowItWorks } from "./sections";
import { siteInfo } from "./site-info";
import { ProductCard, ProductCount } from "./shop-ui";
import { T, Tx } from "@/components/i18n";
import { languageAlternates } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { alternates: await languageAlternates("/") };
}

export default async function HomePage() {
  const viewer = await getCurrentCustomer();
  const customer = viewer?.customer ?? null;
  const db = await getDb();
  const priced = !!customer && canSeePrices(customer);
  const [featured, others, counts, recent, [depot], photos, settings, uploaded, last, cart] = await Promise.all([
    listCatalog(db, customer, { featured: true, limit: 8 }),
    // To top up the shelf when fewer than 8 are featured (loaded alongside, not after).
    listCatalog(db, customer, { limit: 16, inStockFirst: true }),
    categoryCounts(db),
    customer ? recentlyBought(db, customer, 4) : Promise.resolve([]),
    getDepots(db),
    // Product photos for the posters that show some.
    Promise.all(POSTERS.map((p) => (p.art === "products" && !p.image ? posterPhotos(db, p.categories ?? []) : Promise.resolve([])))),
    getSettings(db),
    livePosters(db),
    // For a signed-in customer: their last order (to order again) and what's in their cart.
    priced ? lastOrder(db, customer.id) : Promise.resolve(null),
    priced ? getCart(db, customer) : Promise.resolve([]),
  ]);
  // Posters uploaded in the back office come first; the built-in ones follow unless switched off
  // there (and always show when nothing uploaded is live, so the top of the page is never empty).
  const builtIn = uploaded.length === 0 || settings.builtInPosters;
  const site = siteInfo(settings);
  // Featured first, topped up with the rest of the range, in whole rows of 4 so the shelf has no gaps.
  const shelf = [...featured, ...others.filter((o) => !featured.some((f) => f.id === o.id))].slice(0, 8);
  const popular = shelf.length > 4 ? shelf.slice(0, Math.floor(shelf.length / 4) * 4) : shelf;
  const total = counts.reduce((t, c) => t + c.n, 0);
  const ranges = stockedCategories(counts);
  // A small number ("1 product") reads as an empty shop; the count only shows once it says something.
  const showCount = total >= 20 && ranges.length >= 2;

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
        areaServed: [
          { "@type": "City", name: "Brisbane" },
          { "@type": "AdministrativeArea", name: SITE.serviceArea },
        ],
        // What the business is about, in both languages its customers search in.
        knowsAbout: [
          "Food packaging",
          "Takeaway containers",
          "Disposable food containers",
          "Coffee cups and lids",
          "Paper bags",
          "Disposable cutlery",
          "Commercial cleaning supplies",
          "食品打包盒",
          "外卖餐盒",
          "一次性餐盒",
          "食品包装",
          "餐饮用品批发",
        ],
        knowsLanguage: ["en", "zh"],
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
          itemListElement: ranges.map((c) => ({ "@type": "OfferCatalog", name: c.title, url: `${base}${categoryHref(c.title)}` })),
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

  const posters = (
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
  );

  return (
    <main>
      <JsonLd data={jsonLd} />
      {/* A customer back to order sees their own things first; visitors see the posters and the facts. */}
      {priced && viewer ? (
        <WelcomeBack
          firstName={viewer.user.name.split(" ")[0]}
          business={customer.name}
          last={last ? { id: last.id, number: last.number, products: last.products, totalCents: last.totalCents, date: prettyDate(todayIn(settings.timezone, last.createdAt), { weekday: "short", day: "numeric", month: "short" }) } : null}
          cart={cart.length ? { items: cart.reduce((t, l) => t + l.qty, 0), ...quote(cart, settings) } : null}
          freeOverCents={settings.deliveryFeeCents > 0 ? settings.freeDeliveryOverCents : 0}
        />
      ) : (
        posters
      )}

      {!priced && (
      <section className="border-b border-leaf-950/10 bg-white">
        <ul className="mx-auto grid max-w-6xl grid-cols-2 px-4 sm:px-6 lg:grid-cols-4">
          {[
            showCount
              ? { title: <ProductCount n={total} />, text: <T vars={{ n: ranges.length }}>{"Across {n} ranges"}</T> }
              : { title: <T>{"Order online"}</T>, text: <T>{"Any time, at your trade prices"}</T> },
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
      )}

      {recent.length > 0 && (
        <Shelf title={<T>{"Buy again"}</T>} link={{ href: "/portal/quick-order", label: "Quick order" }}>
          {recent.map((p) => (
            <ProductCard key={p.id} p={p} signedIn />
          ))}
        </Shelf>
      )}

      {priced && <div className="mt-12">{posters}</div>}

      <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
        <SectionHead title={<T>{"Shop by range"}</T>} link={{ href: "/products", label: "All products" }} />
        {/* A ruled index of the ranges, like the contents page of a printed catalogue. */}
        <div className="mt-5 grid border-t border-l border-leaf-950/15 bg-white sm:grid-cols-2 lg:grid-cols-3">
          {ranges.map(({ title, text }) => (
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

      {viewer && !priced && (
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

/**
 * The top of the home page for a signed-in customer: hello, their last order again in one tap,
 * quick order and their list, and what's in their cart with how far it is from free delivery.
 */
function WelcomeBack({
  firstName,
  business,
  last,
  cart,
  freeOverCents,
}: {
  firstName: string;
  business: string;
  last: { id: string; number: string; products: number; totalCents: number; date: string } | null;
  cart: { items: number; subtotalCents: number; totalCents: number } | null;
  freeOverCents: number;
}) {
  const gap = cart && freeOverCents > 0 ? Math.max(0, freeOverCents - cart.subtotalCents) : 0;
  return (
    <section className="border-b border-leaf-950/10 bg-leaf-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <p className="text-sm text-white/60">
          <T vars={{ name: firstName }}>{"Welcome back, {name}"}</T>
        </p>
        <h1 className="mt-0.5 font-display text-2xl font-bold tracking-tight sm:text-3xl">{business}</h1>
        <div className="mt-5 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          {last ? (
            <RepeatOrder order={last} className="text-leaf-950" />
          ) : (
            <Link href="/products" className="press flex items-center gap-4 rounded-3xl bg-white p-4 text-leaf-950 sm:p-5">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-leaf-100 text-leaf-800">
                <ShoppingCart className="size-5" />
              </span>
              <span className="flex-1 font-semibold">
                <T>{"Start your first order"}</T>
              </span>
              <ArrowRight className="size-5 text-leaf-900/50" />
            </Link>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Link href="/portal/quick-order" className="press flex items-center gap-2.5 rounded-2xl bg-white/10 px-4 py-3.5 text-sm font-semibold ring-1 ring-white/10 transition-colors hover:bg-white/15">
              <Zap className="size-4 text-tomato" /> <T>{"Quick order"}</T>
            </Link>
            <Link href="/portal/list" className="press flex items-center gap-2.5 rounded-2xl bg-white/10 px-4 py-3.5 text-sm font-semibold ring-1 ring-white/10 transition-colors hover:bg-white/15">
              <Heart className="size-4 text-tomato" /> <T>{"My list"}</T>
            </Link>
          </div>
        </div>
        {cart && (
          <Link href="/cart" className="press mt-3 flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10 transition-colors hover:bg-white/15">
            <ShoppingCart className="size-4 shrink-0 text-tomato" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-semibold">
                <T vars={{ n: cart.items, total: aud(cart.totalCents) }}>{cart.items === 1 ? "1 item in your cart · {total}" : "{n} items in your cart · {total}"}</T>
              </span>
              {freeOverCents > 0 && (
                <span className="mt-1.5 flex items-center gap-2 text-xs text-white/65">
                  <Truck className="size-3.5 shrink-0" />
                  {gap > 0 ? <T vars={{ more: aud(gap) }}>{"Add {more} more for free delivery"}</T> : <T>{"Free delivery"}</T>}
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
                    <span className="block h-full rounded-full bg-tomato" style={{ width: `${Math.min(100, Math.round((cart.subtotalCents / freeOverCents) * 100))}%` }} />
                  </span>
                </span>
              )}
            </span>
            <ArrowRight className="size-4 shrink-0 text-white/60" />
          </Link>
        )}
      </div>
    </section>
  );
}
