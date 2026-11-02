import { ArrowRight, Zap } from "lucide-react";
import Link from "next/link";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { listCatalog, listCategories, recentlyBought } from "@/lib/shop";
import { siteUrl } from "@/lib/site-url";
import { CATEGORIES, SITE } from "./content";
import { SearchBox } from "./search-box";
import { Contact, Delivery, HowItWorks, Promises } from "./sections";
import { ProductCard } from "./shop-ui";

export default async function HomePage() {
  const viewer = await getCurrentCustomer();
  const customer = viewer?.customer ?? null;
  const db = await getDb();
  const [featured, counts, recent] = await Promise.all([
    listCatalog(db, customer, { featured: true, limit: 8 }),
    listCategories(db),
    customer ? recentlyBought(db, customer, 4) : Promise.resolve([]),
  ]);
  const popular = featured.length ? featured : await listCatalog(db, customer, { limit: 8 });

  // Tells Google who the business is and which logo to show for it, and enables the site search box.
  const base = siteUrl();
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${base}/#organization`,
        name: SITE.name,
        url: base,
        logo: `${base}/brand/foodpac-logo-square.png`,
        description: `${SITE.tagline} Wholesale supplier serving ${SITE.serviceArea}.`,
        areaServed: SITE.serviceArea,
        ...(SITE.phone ? { telephone: SITE.phone } : {}),
        ...(SITE.email ? { email: SITE.email } : {}),
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <section className="border-b border-leaf-950/10 bg-leaf-900 text-cream">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_1fr] lg:py-16">
          <div className="animate-rise">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tomato">Wholesale · {SITE.serviceArea}</p>
            <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl">
              Order your kitchen &amp; packaging supplies online.
            </h1>
            <p className="mt-4 max-w-xl text-cream/75">
              Your prices, carton quantities and delivery windows, all in one place. Track the van on the day and see the signed proof of delivery when it lands.
            </p>
            <SearchBox size="lg" className="mt-7 flex max-w-xl" />
            {!viewer && (
              <p className="mt-4 text-sm text-cream/70">
                New customer?{" "}
                <Link href="/register" className="font-semibold text-white underline underline-offset-2">
                  Open a trade account
                </Link>{" "}
                to see your prices.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {CATEGORIES.slice(0, 4).map(({ icon: Icon, title }) => (
              <Link key={title} href={`/products?category=${encodeURIComponent(title)}`} className="group rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 transition-colors hover:bg-white/10">
                <Icon className="size-6 text-tomato" />
                <p className="mt-3 text-sm font-semibold">{title}</p>
                <p className="text-xs text-cream/55">{counts.find((c) => c.name === title)?.n ?? 0} products</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <Shelf title="Buy again" link={{ href: "/portal/quick-order", label: "Quick order" }}>
          {recent.map((p) => (
            <ProductCard key={p.id} p={p} signedIn />
          ))}
        </Shelf>
      )}

      <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
        <h2 className="font-display text-2xl font-semibold tracking-tight">Shop by category</h2>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.map(({ icon: Icon, title }) => (
            <Link key={title} href={`/products?category=${encodeURIComponent(title)}`} className="flex flex-col items-center rounded-2xl border border-leaf-950/10 bg-white p-4 text-center transition-colors hover:border-leaf-700/30">
              <span className="grid size-12 place-items-center rounded-full bg-leaf-50 text-leaf-700">
                <Icon className="size-5" />
              </span>
              <span className="mt-2 text-sm font-medium leading-tight">{title}</span>
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
              <span className="block font-semibold">Quick order by SKU</span>
              <span className="block text-sm text-leaf-900/65">Paste your usual list of codes and quantities and check out in a minute.</span>
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

function Shelf({ title, link, children }: { title: string; link: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
      <div className="flex items-end justify-between">
        <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
        <Link href={link.href} className="text-sm font-semibold text-leaf-700 hover:underline">
          {link.label}
        </Link>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}
