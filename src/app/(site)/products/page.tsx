import { Check, PackageSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cx } from "@/components/ui";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { canSeePrices, listCatalog, listCategories, type Sort, SORTS } from "@/lib/shop";
import { categoryHref, SITE } from "../content";
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
        <nav className="mt-3 flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          <CatLink href="/products" active={!category} label={<T>{"All products"}</T>} n={total} />
          {categories.map((c) => (
            <CatLink key={c.name} href={categoryHref(c.name)} active={category === c.name} label={c.name} n={c.n} />
          ))}
        </nav>
      </aside>
      <section className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{q ? `Results for “${q}”` : (category ?? <T>{"All products"}</T>)}</h1>
        <p className="mt-1 text-sm text-leaf-900/60">
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
            <p className="mt-3 font-semibold"><T>{"Nothing found"}</T></p>
            <p className="mt-1 text-sm text-leaf-900/60"><T>{"Try another word or SKU, or ask us — we can usually source it."}</T></p>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
            {items.map((p) => (
              <ProductCard key={p.id} p={p} signedIn={!!viewer} morph />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function CatLink({ href, active, label, n }: { href: string; active: boolean; label: React.ReactNode; n: number }) {
  return (
    <Link
      href={href}
      className={cx(
        "flex shrink-0 items-center justify-between gap-3 rounded-full px-3.5 py-2 text-sm lg:rounded-xl",
        active ? "bg-leaf-700 font-semibold text-white" : "text-leaf-900/75 hover:bg-leaf-950/5",
      )}
    >
      {typeof label === "string" ? <T>{label}</T> : label}
      <span className={cx("text-xs tabular-nums", active ? "text-white/70" : "text-leaf-900/40")}>{n}</span>
    </Link>
  );
}
