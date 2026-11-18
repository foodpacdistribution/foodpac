import { ArrowRight } from "lucide-react";
import { notFound } from "next/navigation";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { cx } from "@/components/ui";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getProductBySku } from "@/lib/shop";
import { AddToCart } from "../../../add-to-cart";
import { FavouriteButton } from "../../../favourite-button";
import { Price, ProductImage, StockLabel } from "../../../shop-ui";

/**
 * A product tapped in a list opens here, over the list, with what's needed to order it; the
 * full page (/products/[sku]) is a link away, and is what a shared link or a reload shows.
 */
export default async function ProductPreview({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const viewer = await getCurrentCustomer();
  const p = await getProductBySku(await getDb(), viewer?.customer ?? null, decodeURIComponent(sku));
  if (!p) notFound();
  const href = `/products/${encodeURIComponent(p.sku)}`;
  return (
    <>
      <div className="grid gap-5 p-4 pt-3 sm:grid-cols-[1fr_1.1fr] sm:gap-6 sm:p-6">
        <ProductImage p={p} sizes="(min-width: 640px) 360px, 100vw" className={cx("rounded-lg border border-leaf-950/12", p.hasImage ? "aspect-square" : "aspect-[5/2] sm:aspect-square")} />
        <div className="min-w-0">
          <p className="font-mono text-xs text-leaf-900/50">
            <T>{"SKU"}</T> {p.sku}
          </p>
          <div className="mt-1 flex items-start justify-between gap-3 pr-10 sm:pr-8">
            <h2 className="font-display text-2xl font-bold tracking-tight text-balance">{p.name}</h2>
          </div>
          <p className="mt-1 text-sm text-leaf-900/60">
            {p.packSize}
            {p.minQty > 1 && (
              <>
                {" "}
                <Tx>{`· min ${p.minQty}`}</Tx>
              </>
            )}
          </p>
          <div className="mt-4 flex items-end justify-between gap-3 border-y border-leaf-950/10 py-3">
            <Price p={p} signedIn={!!viewer} />
            <StockLabel stock={p.stock} className="text-sm" />
          </div>
          {p.priceCents !== null && (
            <div className="mt-4">
              <AddToCart productId={p.id} minQty={p.minQty} stock={p.stock} packSize={p.packSize} unit={p.unit} size="lg" />
            </div>
          )}
          {p.description.trim() && <p className="mt-4 line-clamp-4 text-sm leading-relaxed whitespace-pre-line text-leaf-900/75">{p.description}</p>}
          <div className="mt-4 flex items-center justify-between gap-3">
            {/* A full page load, so it opens as the product's own page rather than this preview again. */}
            <a href={href} className="inline-flex items-center gap-1 text-sm font-semibold text-leaf-800 hover:underline">
              <T>{"See full details"}</T> <ArrowRight className="size-3.5" />
            </a>
            <FavouriteButton productId={p.id} sku={p.sku} favourite={p.favourite} signedIn={!!viewer} />
          </div>
          {!viewer && (
            <Link href={`/login?next=${encodeURIComponent(href)}`} className="mt-4 inline-flex h-11 items-center rounded-md bg-leaf-800 px-5 text-sm font-semibold text-white hover:bg-leaf-900">
              <T>{"Sign in to order"}</T>
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
