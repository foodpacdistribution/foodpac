import { ArrowLeft, Barcode, Box, Layers, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getProductBySku, listCatalog } from "@/lib/shop";
import { AddToCart } from "../../add-to-cart";
import { Price, ProductCard, ProductImage, StockLabel } from "../../shop-ui";

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const { sku } = await params;
  const p = await getProductBySku(await getDb(), null, decodeURIComponent(sku));
  return { title: p?.name ?? "Product", description: p?.description };
}

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const viewer = await getCurrentCustomer();
  const db = await getDb();
  const p = await getProductBySku(db, viewer?.customer ?? null, decodeURIComponent(sku));
  if (!p) notFound();
  const related = (await listCatalog(db, viewer?.customer ?? null, { category: p.category, limit: 5 })).filter((x) => x.id !== p.id).slice(0, 4);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href={`/products?category=${encodeURIComponent(p.category)}`} className="inline-flex items-center gap-1.5 text-sm text-leaf-900/60 hover:text-leaf-900">
        <ArrowLeft className="size-4" /> {p.category}
      </Link>
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <ProductImage p={p} morph priority sizes="(min-width: 1024px) 560px, 100vw" className="aspect-square rounded-3xl border border-leaf-950/10" />
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-leaf-900/50">SKU {p.sku}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{p.name}</h1>
          <div className="mt-4 flex items-end justify-between gap-3 border-y border-leaf-950/10 py-4">
            <Price p={p} signedIn={!!viewer} />
            <StockLabel stock={p.stock} className="text-sm" />
          </div>
          {p.priceCents !== null && (
            <div className="mt-5 max-w-sm">
              <AddToCart productId={p.id} minQty={p.minQty} stock={p.stock} size="lg" />
              {p.minQty > 1 && <p className="mt-2 text-xs text-leaf-900/60">Minimum order {p.minQty} {p.unit}s.</p>}
            </div>
          )}
          {!viewer && (
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/login" className="inline-flex h-11 items-center rounded-full bg-leaf-700 px-5 text-sm font-semibold text-white hover:bg-leaf-800">
                Sign in to order
              </Link>
              <Link href="/register" className="inline-flex h-11 items-center rounded-full border border-leaf-950/15 bg-white px-5 text-sm font-semibold">
                Open an account
              </Link>
            </div>
          )}
          <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
            <Spec icon={Box} label="Pack size" value={p.packSize || "—"} />
            <Spec icon={Layers} label="Sold by" value={`${p.unit}${p.minQty > 1 ? ` · min ${p.minQty}` : ""}`} />
            <Spec icon={Barcode} label="GST" value={p.gst ? "GST applies" : "GST free"} />
            <Spec icon={Truck} label="Delivery" value="On our next scheduled run" />
          </dl>
          {p.description && <p className="mt-6 leading-relaxed whitespace-pre-line text-leaf-900/80">{p.description}</p>}
        </div>
      </div>
      {related.length > 0 && (
        <section className="mt-14">
          <h2 className="font-display text-xl font-semibold tracking-tight">More in {p.category}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((r) => (
              <ProductCard key={r.id} p={r} signedIn={!!viewer} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function Spec({ icon: Icon, label, value }: { icon: typeof Box; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-leaf-950/10 bg-white p-3">
      <dt className="flex items-center gap-1.5 text-xs text-leaf-900/55">
        <Icon className="size-3.5" /> {label}
      </dt>
      <dd className="mt-0.5 font-medium capitalize">{value}</dd>
    </div>
  );
}
