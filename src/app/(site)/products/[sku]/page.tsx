import { ArrowLeft, Barcode, Box, Layers, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { productImageUrl } from "@/lib/product-image";
import { getProductBySku, listCatalog } from "@/lib/shop";
import { siteUrl } from "@/lib/site-url";
import { categoryHref, SITE } from "../../content";
import { AddToCart } from "../../add-to-cart";
import { Price, ProductCard, ProductImage, StockLabel } from "../../shop-ui";
import { T, Tx } from "@/components/i18n";

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const { sku } = await params;
  const p = await getProductBySku(await getDb(), null, decodeURIComponent(sku));
  if (!p) return { title: "Product" };
  const description = p.description || `${p.name} (${p.packSize}) – wholesale ${p.category.toLowerCase()} at trade prices, delivered across ${SITE.serviceArea}.`;
  return {
    title: `${p.name} · ${p.packSize}`,
    description,
    alternates: { canonical: `/products/${encodeURIComponent(p.sku)}` },
    openGraph: { title: p.name, description, ...(p.hasImage ? { images: [productImageUrl(p)] } : {}) },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const viewer = await getCurrentCustomer();
  const db = await getDb();
  const p = await getProductBySku(db, viewer?.customer ?? null, decodeURIComponent(sku));
  if (!p) notFound();
  const related = (await listCatalog(db, viewer?.customer ?? null, { category: p.category, limit: 5 })).filter((x) => x.id !== p.id).slice(0, 4);

  const base = siteUrl();

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: base },
            { "@type": "ListItem", position: 2, name: p.category, item: `${base}${categoryHref(p.category)}` },
            { "@type": "ListItem", position: 3, name: p.name, item: `${base}/products/${encodeURIComponent(p.sku)}` },
          ],
        }}
      />
      <Link href={categoryHref(p.category)} className="inline-flex items-center gap-1.5 text-sm text-leaf-900/60 hover:text-leaf-900">
        <ArrowLeft className="size-4" /> {p.category}
      </Link>
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <ProductImage p={p} morph priority sizes="(min-width: 1024px) 560px, 100vw" className="aspect-square rounded-3xl border border-leaf-950/10" />
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-leaf-900/50"><T>{"SKU"}</T>{" "}{p.sku}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{p.name}</h1>
          <div className="mt-4 flex items-end justify-between gap-3 border-y border-leaf-950/10 py-4">
            <Price p={p} signedIn={!!viewer} />
            <StockLabel stock={p.stock} className="text-sm" />
          </div>
          {p.priceCents !== null && (
            <div className="mt-5 max-w-sm">
              <AddToCart productId={p.id} minQty={p.minQty} stock={p.stock} size="lg" />
              {p.minQty > 1 && <p className="mt-2 text-xs text-leaf-900/60"><T>{"Minimum order"}</T>{" "}{p.minQty} <T>{p.unit}</T>.</p>}
            </div>
          )}
          {!viewer && (
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/login" className="inline-flex h-11 items-center rounded-full bg-leaf-700 px-5 text-sm font-semibold text-white hover:bg-leaf-800">
                <T>{"Sign in to order"}</T></Link>
              <Link href="/register" className="inline-flex h-11 items-center rounded-full border border-leaf-950/15 bg-white px-5 text-sm font-semibold">
                <T>{"Open an account"}</T></Link>
            </div>
          )}
          <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
            <Spec icon={Box} label={<T>{"Pack size"}</T>} value={p.packSize || "—"} />
            <Spec icon={Layers} label={<T>{"Sold by"}</T>} value={<><T>{p.unit}</T>{p.minQty > 1 ? <> <Tx>{`· min ${p.minQty}`}</Tx></> : ""}</>} />
            <Spec icon={Barcode} label={<T>{"GST"}</T>} value={<T>{p.gst ? "GST applies" : "GST free"}</T>} />
            <Spec icon={Truck} label={<T>{"Delivery"}</T>} value={<T>{"On our next scheduled run"}</T>} />
          </dl>
          {p.description && <p className="mt-6 leading-relaxed whitespace-pre-line text-leaf-900/80">{<Tx>{p.description}</Tx>}</p>}
        </div>
      </div>
      {related.length > 0 && (
        <section className="mt-14">
          <h2 className="font-display text-xl font-semibold tracking-tight"><T>{"More in"}</T>{" "}{p.category}</h2>
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

function Spec({ icon: Icon, label, value }: { icon: typeof Box; label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-leaf-950/10 bg-white p-3">
      <dt className="flex items-center gap-1.5 text-xs text-leaf-900/55">
        <Icon className="size-3.5" /> {<Tx>{label}</Tx>}
      </dt>
      <dd className="mt-0.5 font-medium capitalize">{value}</dd>
    </div>
  );
}
