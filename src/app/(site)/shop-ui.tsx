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

/** How wide a product card's photo shows: two across on phones, and the shop's column never gets wider than this. */
const CARD_SIZES = "(min-width: 1280px) 280px, (min-width: 1024px) 480px, 50vw";

/**
 * Product photo (optimised and cached for good), or the category icon when there's none.
 * `morph` names it for a view transition, so the photo glides from the card into the product
 * page. Only use it where each product appears once on the page. `eager` is for photos in the
 * first row of a page, which shouldn't wait to be scrolled to.
 */
export function ProductImage({
  p,
  className,
  sizes = CARD_SIZES,
  priority,
  eager,
  morph,
}: {
  p: Pick<CatalogItem, "id" | "hasImage" | "category" | "name" | "imageAt">;
  className?: string;
  sizes?: string;
  priority?: boolean;
  eager?: boolean;
  morph?: boolean;
}) {
  const Icon = categoryInfo(p.category).icon;
  const box = (
    <div className={cx("relative grid place-items-center overflow-hidden bg-[#f1ebdf]", className)}>
      {p.hasImage ? (
        // The whole product on the tile, like a catalogue page: a photo's white background takes the
        // tile's colour (multiply), and it eases in a little when the card is pointed at.
        <Image
          src={productImageUrl(p)}
          alt={p.name}
          fill
          sizes={sizes}
          priority={priority}
          {...(eager ? { loading: "eager" as const, fetchPriority: "high" as const } : {})}
          className="object-contain p-[9%] mix-blend-multiply transition-transform duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-[1.045]"
        />
      ) : (
        // No photo yet: a plain kraft-coloured tile with a small outline of the range, like a gap in a printed catalogue.
        <div className="grid size-full place-items-center">
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
      <span className="text-base font-semibold tracking-tight tabular-nums sm:text-[17px]">{aud(p.priceCents)}</span>
      <span className="text-xs whitespace-nowrap text-leaf-900/60"> / <T>{p.unit}</T></span>
      {special && <span className="ml-1.5 text-xs text-leaf-900/45 line-through">{aud(p.listPriceCents)}</span>}
      <span className="block text-[11px] text-leaf-900/50">{p.gst ? <T>{"+ GST"}</T> : <T>{"GST free"}</T>}{special && <T>{" · your price"}</T>}</span>
    </p>
  );
}

/**
 * A product in a list. In the grid (default) it's a card with the photo on top; inside a
 * ProductGrid switched to "list" it becomes a compact row (small photo on the left), so a
 * customer who knows what they want sees far more at once. A product without a photo gets a
 * shorter tile than one with a photo, so cards aren't mostly empty space.
 */
export function ProductCard({ p, signedIn, morph, eager }: { p: CatalogItem; signedIn: boolean; morph?: boolean; eager?: boolean }) {
  const href = `/products/${encodeURIComponent(p.sku)}`;
  return (
    <div className="press reveal group relative flex flex-col group-data-[view=list]/view:flex-row group-data-[view=list]/view:overflow-hidden group-data-[view=list]/view:rounded-lg group-data-[view=list]/view:bg-white group-data-[view=list]/view:ring-1 group-data-[view=list]/view:ring-leaf-950/8">
      <Link href={href} className="block shrink-0 overflow-hidden rounded-lg group-data-[view=list]/view:w-20 group-data-[view=list]/view:rounded-none sm:group-data-[view=list]/view:w-24">
        <ProductImage
          p={p}
          morph={morph}
          eager={eager}
          className={cx(p.hasImage ? "aspect-[5/4]" : "aspect-[2/1]", "group-data-[view=list]/view:aspect-auto group-data-[view=list]/view:h-full group-data-[view=list]/view:min-h-20")}
        />
      </Link>
      <FavouriteButton productId={p.id} sku={p.sku} favourite={p.favourite} signedIn={signedIn} variant="float" className="absolute top-2 right-2 z-10 group-data-[view=list]/view:hidden" />
      <div className="flex min-w-0 flex-1 flex-col px-0.5 pt-3 pb-1 group-data-[view=list]/view:px-3 group-data-[view=list]/view:py-2.5 sm:group-data-[view=list]/view:py-3">
        <Link href={href} className="line-clamp-2 text-sm leading-snug font-medium text-leaf-950 underline-offset-[3px] decoration-leaf-950/30 hover:underline sm:text-[15px]">
          {p.name}
        </Link>
        <p className="mt-1 line-clamp-1 text-xs text-leaf-900/55">
          {p.packSize}
          {p.minQty > 1 && (
            <>
              {" "}
              <Tx>{`· min ${p.minQty}`}</Tx>
            </>
          )}
          <span className="hidden font-mono text-[10.5px] text-leaf-900/35 group-data-[view=list]/view:inline">
            {p.packSize ? " · " : ""}
            {p.sku}
          </span>
        </p>
        <p className="mt-0.5 font-mono text-[10.5px] tracking-wide text-leaf-900/35 group-data-[view=list]/view:hidden">{p.sku}</p>
        {/* In a list row: the price (with stock under it) on the left, ordering on the right, on one line. */}
        <div className="mt-auto group-data-[view=list]/view:flex group-data-[view=list]/view:items-end group-data-[view=list]/view:gap-3">
          <div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-1 pt-3 group-data-[view=list]/view:min-w-0 group-data-[view=list]/view:flex-1 group-data-[view=list]/view:flex-col group-data-[view=list]/view:items-start group-data-[view=list]/view:gap-0.5 group-data-[view=list]/view:pt-1.5">
            <Price p={p} signedIn={signedIn} />
            <StockLabel stock={p.stock} />
          </div>
          {p.priceCents !== null && (
            <div className="mt-3 group-data-[view=list]/view:mt-0 group-data-[view=list]/view:w-[8.75rem] group-data-[view=list]/view:shrink-0 sm:group-data-[view=list]/view:w-48">
              <AddToCart productId={p.id} minQty={p.minQty} stock={p.stock} packSize={p.packSize} unit={p.unit} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** "1 product", "12 products", or "Coming soon" for a range with nothing in it yet. */
export function ProductCount({ n }: { n: number }) {
  if (n <= 0) return <T>{"Coming soon"}</T>;
  return <T vars={{ n }}>{n === 1 ? "{n} product" : "{n} products"}</T>;
}
