import { Check, PackageSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { cx } from "@/components/ui";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { canSeePrices, listCatalog, listCategories, type Sort, SORTS } from "@/lib/shop";
import { ViewTransition } from "react";
import { categoryHref, categoryInfo, categorySlug, SITE } from "../content";
import { CategorySidebar } from "../category-nav";
import { ProductCard } from "../shop-ui";
import { T } from "@/components/i18n";

type Search = { q?: string; category?: string; sort?: string; stock?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const sp = await searchParams;
  // Searches and filtered or sorted lists repeat other pages: keep them out of the index.
  if (sp.q || sp.sort || sp.stock) return { title: "Products", robots: { index: false, follow: true } };
  if (sp.category) return { title: sp.category, alternates: { canonical: categoryHref(sp.category) } };
  return {
    title: "All products",
    description: `Takeaway packaging, cups, bags, cutlery, cleaning supplies and dry goods at trade prices, delivered across ${SITE.serviceArea}.`,
    alternates: { canonical: "/products" },
  };
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const category = sp.category?.slice(0, 100) || undefined;
  const viewer = await getCurrentCustomer();
  const pricesShown = !!viewer && canSeePrices(viewer.customer);
  const sort = (Object.keys(SORTS) as Sort[]).find((k) => k === sp.sort && (pricesShown || !k.startsWith("price")));
  const inStock = sp.stock === "1";
  const db = await getDb();
  const [items, categories] = await Promise.all([listCatalog(db, viewer?.customer ?? null, { q, category, sort, inStock }), listCategories(db)]);
  const qs = (patch: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const merged = { q, category, sort, stock: inStock ? "1" : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    return `/products${u.size ? `?${u}` : ""}`;
  };
  const total = categories.reduce((t, c) => t + c.n, 0);

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[220px_1fr]">
      <aside className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-leaf-900/50"><T>{"Categories"}</T></p>
        <nav aria-label="Categories">
          <CategorySidebar
            items={[
              { href: "/products", label: "All products", n: total },
              ...categories.map((c) => ({ href: categoryHref(c.name), label: c.name, n: c.n, icon: true })),
            ]}
          />
        </nav>
      </aside>
      <section className="min-w-0">
        {category && !q ? (
          <CategoryBanner name={category} />
        ) : (
          <h1 className="font-display text-2xl font-semibold tracking-tight">{q ? `Results for “${q}”` : <T>{"All products"}</T>}</h1>
        )}
        <p className={cx("text-sm text-leaf-900/60", category && !q ? "mt-4" : "mt-1")}>
          <T vars={{ n: items.length }}>{items.length === 1 ? "{n} product" : "{n} products"}</T>
          {q && category && ` in ${category}`}
          {!viewer && (
            <>
              {" · "}
              <Link href="/login?next=%2Fproducts" className="font-semibold text-leaf-700 hover:underline">
                <T>{"Sign in"}</T></Link>{" "}
              <T>{"to see your prices"}</T></>
          )}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          {(Object.keys(SORTS) as Sort[])
            .filter((k) => pricesShown || !k.startsWith("price"))
            .map((k) => (
              <Link
                key={k}
                href={qs({ sort: k === "name" && !sort ? undefined : k })}
                scroll={false}
                className={cx(
                  "rounded-full px-3 py-1.5 transition-colors",
                  (sort ?? "name") === k ? "bg-leaf-950 font-medium text-white" : "bg-white text-leaf-900/75 ring-1 ring-leaf-950/10 hover:ring-leaf-700/30",
                )}
              >
                <T>{SORTS[k]}</T>
              </Link>
            ))}
          <Link
            href={qs({ stock: inStock ? undefined : "1" })}
            scroll={false}
            className={cx(
              "ml-auto flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors",
              inStock ? "bg-leaf-700 font-medium text-white" : "bg-white text-leaf-900/75 ring-1 ring-leaf-950/10 hover:ring-leaf-700/30",
            )}
          >
            <span className={cx("grid size-4 place-items-center rounded-full border", inStock ? "border-white bg-white text-leaf-700" : "border-leaf-900/30")}>
              {inStock && <Check className="size-3" strokeWidth={3} />}
            </span>
            <T>{"In stock only"}</T></Link>
        </div>
        {items.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-leaf-950/15 bg-white px-6 py-14 text-center">
            <PackageSearch className="mx-auto size-10 text-leaf-700/60" />
            {category && !q && !inStock ? (
              <>
                <p className="mt-3 font-semibold"><T>{"Products for this range are coming soon"}</T></p>
                <p className="mt-1 text-sm text-leaf-900/60"><T>{"Tell us what you need and we'll quote it, we can usually source it."}</T></p>
                <Link href="/#contact" className="mt-4 inline-flex h-10 items-center rounded-full bg-leaf-700 px-5 text-sm font-semibold text-white hover:bg-leaf-800">
                  <T>{"Ask for a quote"}</T>
                </Link>
              </>
            ) : (
              <>
                <p className="mt-3 font-semibold"><T>{"Nothing found"}</T></p>
                <p className="mt-1 text-sm text-leaf-900/60"><T>{"Try another word or SKU, or ask us — we can usually source it."}</T></p>
              </>
            )}
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
            {items.map((p, i) => (
              <ProductCard key={p.id} p={p} signedIn={!!viewer} morph index={i} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

/** The chosen category's heading: its icon (which glides in from the home page tile) and blurb. */
function CategoryBanner({ name }: { name: string }) {
  const { icon: Icon, text } = categoryInfo(name);
  return (
    <div className="relative overflow-hidden rounded-3xl bg-leaf-900 px-5 py-6 text-cream sm:px-7 sm:py-7">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(50%_90%_at_95%_10%,rgb(37_138_86/0.5),transparent_70%),radial-gradient(35%_80%_at_0%_100%,rgb(224_98_12/0.18),transparent_70%)]" />
      <Icon aria-hidden className="absolute -right-6 -bottom-10 size-44 text-white/[0.05]" strokeWidth={1} />
      <div className="relative flex items-center gap-4 sm:gap-5">
        <ViewTransition name={`category-${categorySlug(name)}`} share="morph" default="none">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/10 text-tomato ring-1 ring-white/15">
            <Icon className="size-6" />
          </span>
        </ViewTransition>
        <div className="min-w-0 animate-rise">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-tomato uppercase"><T>{"Category"}</T></p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl"><T>{name}</T></h1>
          {text && <p className="mt-1 max-w-xl text-sm text-cream/70"><T>{text}</T></p>}
        </div>
      </div>
    </div>
  );
}
