import { ArrowLeft, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { productImageUrl } from "@/lib/product-image";
import { deliveryPromise, getProductBySku, listCatalog } from "@/lib/shop";
import { getSettings } from "@/lib/planning";
import { aud } from "@/lib/money";
import { siteUrl } from "@/lib/site-url";
import { categoryHref, SITE } from "../../content";
import { AddToCart } from "../../add-to-cart";
import { DeliveryPromiseText, FreeDeliveryText } from "../../delivery-promise";
import { BuyBar } from "./buy-bar";
import { FavouriteButton } from "../../favourite-button";
import { Price, ProductCard, ProductImage, StockLabel } from "../../shop-ui";
import { cx } from "@/components/ui";
import { T, Tx } from "@/components/i18n";
import { getT, languageAlternates } from "@/lib/i18n/server";

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const { sku } = await params;
  const p = await getProductBySku(await getDb(), null, decodeURIComponent(sku));
  if (!p) return { title: "Product" };
  const tr = await getT();
  const description =
    p.description || tr("{name} ({pack}) – wholesale {category} at trade prices, delivered across {area}.", { name: p.name, pack: p.packSize, category: tr(p.category).toLowerCase(), area: tr(SITE.serviceArea) });
  return {
    title: `${p.name} · ${p.packSize}`,
    description,
    alternates: await languageAlternates(`/products/${encodeURIComponent(p.sku)}`),
    openGraph: { title: p.name, description, ...(p.hasImage ? { images: [productImageUrl(p)] } : {}) },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const viewer = await getCurrentCustomer();
  const db = await getDb();
  const [p, settings] = await Promise.all([getProductBySku(db, viewer?.customer ?? null, decodeURIComponent(sku)), getSettings(db)]);
  if (!p) notFound();
  const promise = deliveryPromise(settings);
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
        <ArrowLeft className="size-4" /> <T>{p.category}</T>
      </Link>
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <ProductImage p={p} morph priority sizes="(min-width: 1024px) 560px, 100vw" className={cx("rounded-lg border border-leaf-950/12", p.hasImage ? "aspect-square" : "aspect-[4/3]")} />
        <div>
          <p className="font-mono text-xs text-leaf-900/50"><T>{"SKU"}</T>{" "}{p.sku}</p>
          <div className="mt-1 flex items-start justify-between gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight text-balance">{p.name}</h1>
            <FavouriteButton productId={p.id} sku={p.sku} favourite={p.favourite} signedIn={!!viewer} className="shrink-0" />
          </div>
          <div id="buy-box">
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
              <Link href={`/login?next=${encodeURIComponent(`/products/${p.sku}`)}`} className="inline-flex h-11 items-center rounded-md bg-leaf-800 px-5 text-sm font-semibold text-white hover:bg-leaf-900">
                <T>{"Sign in to order"}</T></Link>
              <Link href="/register" className="inline-flex h-11 items-center rounded-md border border-leaf-950/20 bg-white px-5 text-sm font-semibold hover:border-leaf-950/40">
                <T>{"Open an account"}</T></Link>
            </div>
          )}
          </div>
          {promise && (
            <div className="mt-5 flex items-start gap-3 border-l-2 border-leaf-700 py-1 pl-4">
              <Truck className="mt-0.5 size-4 shrink-0 text-leaf-700" />
              <div className="text-sm leading-snug">
                <p className="font-semibold text-leaf-950">
                  <DeliveryPromiseText promise={promise} />
                </p>
                <p className="mt-0.5 text-leaf-900/65">
                  <FreeDeliveryText promise={promise} />
                  {promise.freeDeliveryOverCents > 0 || promise.deliveryFeeCents <= 0 ? " · " : ""}
                  <T>{"Photo and signature at the door"}</T>
                </p>
              </div>
            </div>
          )}
          <dl className="mt-6 divide-y divide-leaf-950/10 border-y border-leaf-950/10 text-sm">
            <Spec label={<T>{"Pack size"}</T>} value={p.packSize || "—"} />
            <Spec label={<T>{"Sold by"}</T>} value={<><T>{p.unit}</T>{p.minQty > 1 ? <> <Tx>{`· min ${p.minQty}`}</Tx></> : ""}</>} />
            <Spec label={<T>{"GST"}</T>} value={<T>{p.gst ? "GST applies" : "GST free"}</T>} />
            <Spec label={<T>{"Category"}</T>} value={<Link href={categoryHref(p.category)} className="hover:text-leaf-700 hover:underline"><T>{p.category}</T></Link>} />
          </dl>
          {p.description && <p className="mt-6 leading-relaxed whitespace-pre-line text-leaf-900/80">{<Tx>{p.description}</Tx>}</p>}
        </div>
      </div>
      <BuyBar watch="buy-box">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{p.name}</p>
            {p.priceCents !== null ? (
              <p className="text-sm text-leaf-900/70">
                <span className="font-display font-semibold text-leaf-950 tabular-nums">{aud(p.priceCents)}</span> / <T>{p.unit}</T>
              </p>
            ) : (
              <StockLabel stock={p.stock} />
            )}
          </div>
          {p.priceCents !== null ? (
            <div className="w-52 shrink-0">
              <AddToCart productId={p.id} minQty={p.minQty} stock={p.stock} />
            </div>
          ) : !viewer ? (
            <Link href={`/login?next=${encodeURIComponent(`/products/${p.sku}`)}`} className="inline-flex h-10 shrink-0 items-center rounded-md bg-leaf-800 px-4 text-sm font-semibold text-white">
              <T>{"Sign in to order"}</T>
            </Link>
          ) : null}
        </div>
      </BuyBar>
      {related.length > 0 && (
        <section className="mt-14">
          <h2 className="border-b border-leaf-950/15 pb-3 font-display text-xl font-semibold tracking-tight"><T>{"More in"}</T>{" "}{p.category}</h2>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {related.map((r) => (
              <ProductCard key={r.id} p={r} signedIn={!!viewer} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function Spec({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
      <dt className="text-leaf-900/55">{<Tx>{label}</Tx>}</dt>
      <dd className="font-medium first-letter:uppercase">{value}</dd>
    </div>
  );
}
