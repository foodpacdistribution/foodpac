import Image from "next/image";
import Link from "@/components/link";
import { ViewTransition } from "react";
import { cx } from "@/components/ui";
import { aud } from "@/lib/money";
import { productImageUrl } from "@/lib/product-image";
import type { CatalogItem } from "@/lib/shop";
import { AddToCart } from "./add-to-cart";
import { categoryInfo } from "./content";
import { T, Tx } from "@/components/i18n";

/**
 * Product photo (optimised and cached for good), or the category icon when there's none.
 * `morph` names it for a view transition, so the photo glides from the card into the product
 * page. Only use it where each product appears once on the page.
 */
export function ProductImage({
  p,
  className,
  sizes = "(min-width: 1024px) 25vw, 50vw",
  priority,
  morph,
}: {
  p: Pick<CatalogItem, "id" | "hasImage" | "category" | "name" | "updatedAt">;
  className?: string;
  sizes?: string;
  priority?: boolean;
  morph?: boolean;
}) {
  const Icon = categoryInfo(p.category).icon;
  const box = (
    <div className={cx("relative grid place-items-center overflow-hidden bg-leaf-50", className)}>
      {p.hasImage ? (
        <Image src={productImageUrl(p)} alt={p.name} fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        // No photo yet: a calm tile with the category icon instead of a big empty box.
        <div className="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-leaf-50 via-cream to-leaf-100/60">
          <span className="grid size-[38%] max-h-24 max-w-24 place-items-center rounded-full bg-white/80 shadow-sm ring-1 ring-leaf-900/5">
            <Icon className="size-1/2 text-leaf-700/70" strokeWidth={1.5} />
          </span>
          <span className="px-2 text-center text-[10px] font-medium tracking-wider text-leaf-900/45 uppercase sm:text-[11px]">
            <T>{p.category}</T>
          </span>
        </div>
      )}
    </div>
  );
  return morph ? (
    <ViewTransition name={`product-${p.id}`} share="morph" default="none">
      {box}
    </ViewTransition>
  ) : (
    box
  );
}

export function StockLabel({ stock, className }: { stock: number; className?: string }) {
  return (
    <span className={cx("text-xs font-medium", stock <= 0 ? "text-red-600" : stock < 10 ? "text-amber-700" : "text-leaf-700", className)}>
      {stock <= 0 ? <T>{"Out of stock"}</T> : stock < 10 ? <T vars={{ n: stock }}>{"Only {n} left"}</T> : <T>{"In stock"}</T>}
    </span>
  );
}

export function Price({ p, signedIn }: { p: Pick<CatalogItem, "priceCents" | "listPriceCents" | "unit" | "gst">; signedIn: boolean }) {
  if (p.priceCents === null) {
    return signedIn ? (
      <p className="text-sm text-leaf-900/60"><T>{"Price shown once your account is approved"}</T></p>
    ) : (
      <Link href="/login?next=%2Fproducts" className="text-sm font-semibold text-leaf-700 underline-offset-2 hover:underline">
        <T>{"Sign in for your price"}</T></Link>
    );
  }
  const special = p.listPriceCents !== null && p.priceCents < p.listPriceCents;
  return (
    <p className="leading-tight">
      <span className="font-display text-lg font-semibold tabular-nums sm:text-xl">{aud(p.priceCents)}</span>
      <span className="text-xs text-leaf-900/60"> / <T>{p.unit}</T></span>
      {special && <span className="ml-1.5 text-xs text-leaf-900/45 line-through">{aud(p.listPriceCents)}</span>}
      <span className="block text-[11px] text-leaf-900/50">{p.gst ? <T>{"+ GST"}</T> : <T>{"GST free"}</T>}{special && <T>{" · your price"}</T>}</span>
    </p>
  );
}

/** `index` (its place in a grid): the first dozen arrive one after another; the rest rise in as they scroll into view. */
export function ProductCard({ p, signedIn, morph, index }: { p: CatalogItem; signedIn: boolean; morph?: boolean; index?: number }) {
  const stagger = index !== undefined && index < 12;
  return (
    <div
      style={stagger ? ({ "--i": index } as React.CSSProperties) : undefined}
      className={cx(
        stagger ? "stagger" : "reveal",
        "group flex flex-col overflow-hidden rounded-2xl border border-leaf-950/10 bg-white transition-[border-color,box-shadow,translate,scale] duration-300 ease-out hover:-translate-y-1 hover:border-leaf-700/30 hover:shadow-[0_16px_32px_-14px_rgb(17_58_39/0.35)] has-[a:active]:scale-[0.985]",
      )}
    >
      <Link href={`/products/${encodeURIComponent(p.sku)}`} className="block overflow-hidden">
        <ProductImage p={p} morph={morph} className="aspect-[4/3] transition-transform duration-500 ease-out group-hover:scale-[1.04]" />
      </Link>
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <p className="text-[10px] font-medium uppercase tracking-wider text-leaf-900/45 sm:text-[11px]">{p.sku}</p>
        <Link href={`/products/${encodeURIComponent(p.sku)}`} className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug hover:text-leaf-700 sm:text-base">
          {p.name}
        </Link>
        <p className="mt-0.5 line-clamp-1 text-xs text-leaf-900/60">
          {p.packSize}
          {p.minQty > 1 && <> <Tx>{`· min ${p.minQty}`}</Tx></>}
        </p>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-1 pt-3">
          <Price p={p} signedIn={signedIn} />
          <StockLabel stock={p.stock} />
        </div>
        {p.priceCents !== null && (
          <div className="mt-3">
            <AddToCart productId={p.id} minQty={p.minQty} stock={p.stock} />
          </div>
        )}
      </div>
    </div>
  );
}

/** "1 product", "12 products", or "Coming soon" for a range with nothing in it yet. */
export function ProductCount({ n }: { n: number }) {
  if (n <= 0) return <T>{"Coming soon"}</T>;
  return <T vars={{ n }}>{n === 1 ? "{n} product" : "{n} products"}</T>;
}
