import { PackageSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cx } from "@/components/ui";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { listCatalog, listCategories } from "@/lib/shop";
import { ProductCard } from "../shop-ui";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const category = sp.category?.slice(0, 100) || undefined;
  const viewer = await getCurrentCustomer();
  const db = await getDb();
  const [items, categories] = await Promise.all([listCatalog(db, viewer?.customer ?? null, { q, category }), listCategories(db)]);
  const total = categories.reduce((t, c) => t + c.n, 0);

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[220px_1fr]">
      <aside className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-leaf-900/50">Categories</p>
        <nav className="mt-3 flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          <CatLink href="/products" active={!category} label="All products" n={total} />
          {categories.map((c) => (
            <CatLink key={c.name} href={`/products?category=${encodeURIComponent(c.name)}`} active={category === c.name} label={c.name} n={c.n} />
          ))}
        </nav>
      </aside>
      <section className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{q ? `Results for “${q}”` : (category ?? "All products")}</h1>
        <p className="mt-1 text-sm text-leaf-900/60">
          {items.length} product{items.length === 1 ? "" : "s"}
          {q && category && ` in ${category}`}
          {!viewer && (
            <>
              {" · "}
              <Link href="/login" className="font-semibold text-leaf-700 hover:underline">
                Sign in
              </Link>{" "}
              to see your prices
            </>
          )}
        </p>
        {items.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-leaf-950/15 bg-white px-6 py-14 text-center">
            <PackageSearch className="mx-auto size-10 text-leaf-700/60" />
            <p className="mt-3 font-semibold">Nothing found</p>
            <p className="mt-1 text-sm text-leaf-900/60">Try another word or SKU, or ask us — we can usually source it.</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((p) => (
              <ProductCard key={p.id} p={p} signedIn={!!viewer} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function CatLink({ href, active, label, n }: { href: string; active: boolean; label: string; n: number }) {
  return (
    <Link
      href={href}
      className={cx(
        "flex shrink-0 items-center justify-between gap-3 rounded-full px-3.5 py-2 text-sm lg:rounded-xl",
        active ? "bg-leaf-700 font-semibold text-white" : "text-leaf-900/75 hover:bg-leaf-950/5",
      )}
    >
      {label}
      <span className={cx("text-xs tabular-nums", active ? "text-white/70" : "text-leaf-900/40")}>{n}</span>
    </Link>
  );
}
