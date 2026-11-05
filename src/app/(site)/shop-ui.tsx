import Image from "next/image";
import Link from "@/components/link";
import { ViewTransition } from "react";
import { cx } from "@/components/ui";
import { aud } from "@/lib/money";
import { productImageUrl } from "@/lib/product-image";
import type { CatalogItem } from "@/lib/shop";
import { AddToCart } from "./add-to-cart";
import { FavouriteButton } from "./favourite-button";
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
    <div className={cx("relative grid place-items-center overflow-hidden bg-sand/70", className)}>
      {p.hasImage ? (
        <Image src={productImageUrl(p)} alt={p.name} fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        // No photo yet: a plain kraft-coloured tile with a small outline of the range, like a gap in a printed catalogue.
        <div className="grid size-full place-items-center bg-sand/70">
          <Icon className="size-[22%] max-h-14 max-w-14 text-leaf-900/25" strokeWidth={1.25} aria-hidden />
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
    <span className={cx("text-xs font-medium", stock <= 0 ? "text-red-700" : stock < 10 ? "text-amber-700" : "text-leaf-900/55", className)}>
      {stock <= 0 ? <T>{"Out of stock"}</T> : stock < 10 ? <T vars={{ n: stock }}>{"Only {n} left"}</T> : <T>{"In stock"}</T>}
    </span>
  );
}

export function Price({ p, signedIn }: { p: Pick<CatalogItem, "priceCents" | "listPriceCents" | "unit" | "gst">; signedIn: boolean }) {
  if (p.priceCents === null) {
    return signedIn ? (
      <p className="text-sm text-leaf-900/60"><T>{"Price shown once your account is approved"}</T></p>
    ) : (
      <Link href="/login?next=%2Fproducts" className="text-sm font-medium text-leaf-800 underline underline-offset-2 decoration-leaf-800/30 hover:decoration-leaf-800">
        <T>{"Sign in for your price"}</T></Link>
    );
  }
  const special = p.listPriceCents !== null && p.priceCents < p.listPriceCents;
  return (
    <p className="leading-tight">
      <span className="text-base font-bold tabular-nums sm:text-lg">{aud(p.priceCents)}</span>
      <span className="text-xs text-leaf-900/60"> / <T>{p.unit}</T></span>
      {special && <span className="ml-1.5 text-xs text-leaf-900/45 line-through">{aud(p.listPriceCents)}</span>}
      <span className="block text-[11px] text-leaf-900/50">{p.gst ? <T>{"+ GST"}</T> : <T>{"GST free"}</T>}{special && <T>{" · your price"}</T>}</span>
    </p>
  );
}

export function ProductCard({ p, signedIn, morph }: { p: CatalogItem; signedIn: boolean; morph?: boolean; index?: number }) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-leaf-950/12 bg-white transition-colors hover:border-leaf-950/30">
      <Link href={`/products/${encodeURIComponent(p.sku)}`} className="block border-b border-leaf-950/8">
        <ProductImage p={p} morph={morph} className="aspect-[4/3]" />
      </Link>
      <FavouriteButton productId={p.id} sku={p.sku} favourite={p.favourite} signedIn={signedIn} className="absolute top-2 right-2 z-10" />
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <Link href={`/products/${encodeURIComponent(p.sku)}`} className="line-clamp-2 text-sm font-semibold leading-snug underline-offset-2 hover:underline sm:text-[15px]">
          {p.name}
        </Link>
        <p className="mt-1 line-clamp-1 text-xs text-leaf-900/60">
          {p.packSize}
          {p.minQty > 1 && <> <Tx>{`· min ${p.minQty}`}</Tx></>}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-leaf-900/40">{p.sku}</p>
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
