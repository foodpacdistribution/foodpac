import type { Metadata } from "next";
import Link from "@/components/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { productImageUrl } from "@/lib/product-image";
import { getProductBySku, listCatalog } from "@/lib/shop";
import { aud, GST_RATE } from "@/lib/money";
import { siteUrl } from "@/lib/site-url";
import { categoryHref, OG_IMAGE, SITE } from "../../content";
import { AddToCart } from "../../add-to-cart";
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
  const pack = p.packSize.trim();
  // Many imported products have no pack size: leave it out rather than show "()" or "· ·".
  const description =
    p.description?.trim() ||
    tr(pack ? "{name} ({pack}). Wholesale {category} for food businesses, sold by the {unit} at trade prices and delivered across Brisbane and {area}." : "{name}. Wholesale {category} for food businesses, sold by the {unit} at trade prices and delivered across Brisbane and {area}.", {
      name: p.name,
      pack,
      category: tr(p.category).toLowerCase(),
      unit: tr(p.unit),
      area: tr(SITE.serviceArea),
    });
  return {
    title: pack ? `${p.name} · ${pack}` : p.name,
    description,
    alternates: await languageAlternates(`/products/${encodeURIComponent(p.sku)}`),
    openGraph: { title: p.name, description, images: [p.hasImage ? productImageUrl(p) : OG_IMAGE] },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const viewer = await getCurrentCustomer();
  const db = await getDb();
  const p = await getProductBySku(db, viewer?.customer ?? null, decodeURIComponent(sku));
  if (!p) notFound();
  const related = (await listCatalog(db, viewer?.customer ?? null, { category: p.category, limit: 5, inStockFirst: true })).filter((x) => x.id !== p.id).slice(0, 4);

  const base = siteUrl();

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: base },
                { "@type": "ListItem", position: 2, name: p.category, item: `${base}${categoryHref(p.category)}` },
                { "@type": "ListItem", position: 3, name: p.name, item: `${base}/products/${encodeURIComponent(p.sku)}` },
              ],
            },
            // Not marked up as a Product: Google requires a Product to carry a public price (an
            // offer), a review or a rating, and prices here are per trade account behind sign-in.
            // A Product without one is flagged as an error in Search Console, and a price in the
            // markup that the page doesn't show is a price mismatch. The page itself, with its photo:
            {
              "@type": "WebPage",
              "@id": `${base}/products/${encodeURIComponent(p.sku)}`,
              url: `${base}/products/${encodeURIComponent(p.sku)}`,
              name: p.name,
              ...(p.description.trim() ? { description: p.description.trim() } : {}),
              ...(p.hasImage ? { primaryImageOfPage: { "@type": "ImageObject", url: `${base}${productImageUrl(p)}` } } : {}),
            },
          ],
        }}
      />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-leaf-900/55">
        <Link href="/products" className="shrink-0 transition-colors hover:text-leaf-950">
          <T>{"All products"}</T>
        </Link>
        <span aria-hidden className="text-leaf-900/25">/</span>
        <Link href={categoryHref(p.category)} className="truncate transition-colors hover:text-leaf-950">
          <T>{p.category}</T>
        </Link>
      </nav>
      <div className="mt-4 grid gap-8 lg:mt-6 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        {/* The photo: edge to edge on a phone; on a computer it stays in view beside the details. */}
        <div className="-mx-4 sm:mx-0 lg:sticky lg:top-32 lg:self-start">
          <ProductImage p={p} morph priority sizes="(min-width: 1024px) 600px, 100vw" className="aspect-[5/4] sm:aspect-square sm:rounded-2xl" />
        </div>
        <div className="min-w-0 lg:pt-3">
          <div className="stagger" style={{ "--i": 0 } as React.CSSProperties}>
            <p className="text-xs font-medium tracking-[0.16em] text-leaf-900/50 uppercase">
              <T>{p.category}</T>
            </p>
            <h1 className="mt-2.5 font-display text-[28px] leading-[1.15] font-semibold tracking-tight text-balance sm:text-[38px]">{p.name}</h1>
            <p className="mt-3 text-sm text-leaf-900/55">
              {p.packSize && (
                <>
                  {p.packSize}
                  <span aria-hidden className="mx-2 text-leaf-900/25">·</span>
                </>
              )}
              <span className="font-mono text-[13px]">{p.sku}</span>
            </p>
          </div>

          <div id="buy-box" className="stagger mt-8" style={{ "--i": 1 } as React.CSSProperties}>
            {p.priceCents !== null ? (
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-display text-[34px] leading-none font-semibold tracking-tight tabular-nums">{aud(p.priceCents)}</span>
                    <span className="text-sm text-leaf-900/55">
                      / <T>{p.unit}</T>
                    </span>
                    {p.listPriceCents !== null && p.priceCents < p.listPriceCents && <span className="text-sm text-leaf-900/40 line-through">{aud(p.listPriceCents)}</span>}
                  </p>
                  <p className="mt-2 text-xs text-leaf-900/55">
                    {p.gst ? <T vars={{ price: aud(Math.round(p.priceCents * (1 + GST_RATE))) }}>{"{price} incl. GST"}</T> : <T>{"GST free"}</T>}
                    {p.listPriceCents !== null && p.priceCents < p.listPriceCents && (
                      <>
                        {" · "}
                        <T>{"your price"}</T>
                      </>
                    )}
                  </p>
                </div>
                <StockDot stock={p.stock} />
              </div>
            ) : (
              <div className="flex items-end justify-between gap-4">
                <Price p={p} signedIn={!!viewer} />
                <StockDot stock={p.stock} />
              </div>
            )}
            {p.priceCents !== null && (
              <div className="mt-6 flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <AddToCart productId={p.id} minQty={p.minQty} stock={p.stock} packSize={p.packSize} unit={p.unit} size="lg" />
                </div>
                <FavouriteButton productId={p.id} sku={p.sku} favourite={p.favourite} signedIn={!!viewer} className="size-12 shrink-0 rounded-md" />
              </div>
            )}
            {p.priceCents !== null && p.minQty > 1 && (
              <p className="mt-2.5 text-xs text-leaf-900/55">
                <T vars={{ n: p.minQty, unit: p.unit }}>{"Minimum order {n} {unit}"}</T>
              </p>
            )}
            {!viewer && (
              <div className="mt-6 flex flex-wrap gap-2">
                <Link href={`/login?next=${encodeURIComponent(`/products/${p.sku}`)}`} className="inline-flex h-12 items-center rounded-md bg-leaf-800 px-6 text-sm font-semibold text-white transition-colors hover:bg-leaf-900">
                  <T>{"Sign in to order"}</T>
                </Link>
                <Link href="/register" className="inline-flex h-12 items-center rounded-md px-5 text-sm font-semibold text-leaf-950 ring-1 ring-leaf-950/20 transition-colors ring-inset hover:bg-white">
                  <T>{"Open an account"}</T>
                </Link>
              </div>
            )}
          </div>

          {p.description.trim() && (
            <section className="stagger mt-10" style={{ "--i": 2 } as React.CSSProperties}>
              <h2 className="text-xs font-medium tracking-[0.16em] text-leaf-900/50 uppercase">
                <T>{"Details"}</T>
              </h2>
              <p className="mt-3 leading-relaxed whitespace-pre-line text-leaf-900/80">{<Tx>{p.description}</Tx>}</p>
            </section>
          )}

          {/* The facts, label over value, only those that are known. */}
          <dl className="stagger mt-10 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-leaf-950/10 pt-6 text-sm sm:grid-cols-3" style={{ "--i": 3 } as React.CSSProperties}>
            {p.packSize && <Spec label={<T>{"Pack size"}</T>} value={p.packSize} />}
            <Spec label={<T>{"Sold by"}</T>} value={<T>{p.unit}</T>} />
            {p.minQty > 1 && <Spec label={<T>{"Minimum order"}</T>} value={`${p.minQty}`} />}
            <Spec label={<T>{"GST"}</T>} value={p.gst ? "10%" : <T>{"GST free"}</T>} />
            <Spec
              label={<T>{"Category"}</T>}
              value={
                <Link href={categoryHref(p.category)} className="underline decoration-leaf-950/20 underline-offset-[3px] transition-colors hover:decoration-leaf-950">
                  <T>{p.category}</T>
                </Link>
              }
            />
            <Spec label={<T>{"SKU"}</T>} value={<span className="font-mono text-[13px]">{p.sku}</span>} />
          </dl>
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
              <AddToCart productId={p.id} minQty={p.minQty} stock={p.stock} packSize={p.packSize} unit={p.unit} />
            </div>
          ) : !viewer ? (
            <Link href={`/login?next=${encodeURIComponent(`/products/${p.sku}`)}`} className="inline-flex h-10 shrink-0 items-center rounded-md bg-leaf-800 px-4 text-sm font-semibold text-white">
              <T>{"Sign in to order"}</T>
            </Link>
          ) : null}
        </div>
      </BuyBar>
      {related.length > 0 && (
        <section className="mt-20">
          <div className="flex items-baseline justify-between gap-4 border-b border-leaf-950/10 pb-3">
            <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              <T>{"More in"}</T> <T>{p.category}</T>
            </h2>
            <Link href={categoryHref(p.category)} className="shrink-0 text-sm font-medium text-leaf-800 hover:underline">
              <T>{"See all"}</T> →
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
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
    <div className="min-w-0">
      <dt className="text-xs text-leaf-900/50">{<Tx>{label}</Tx>}</dt>
      <dd className="mt-1 font-medium break-words first-letter:uppercase">{value}</dd>
    </div>
  );
}

/** "In stock" / "Only 3 left" / "Out of stock" with a small coloured dot. */
function StockDot({ stock }: { stock: number }) {
  const tone = stock <= 0 ? "bg-red-600" : stock < 10 ? "bg-amber-500" : "bg-leaf-600";
  return (
    <span className="inline-flex shrink-0 items-center gap-2 pb-0.5">
      <span aria-hidden className={cx("size-1.5 rounded-full", tone)} />
      <StockLabel stock={stock} className="text-sm" />
    </span>
  );
}
