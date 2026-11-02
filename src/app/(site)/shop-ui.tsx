import Image from "next/image";
import Link from "next/link";
import { ViewTransition } from "react";
import { cx } from "@/components/ui";
import { aud } from "@/lib/money";
import { productImageUrl } from "@/lib/product-image";
import type { CatalogItem } from "@/lib/shop";
import { AddToCart } from "./add-to-cart";
import { categoryInfo } from "./content";

/**
 * Product photo (optimised and cached for good), or the category icon when there's none.
 * `morph` names it for a view transition, so the photo glides from the card into the product
 * page. Only use it where each product appears once on the page.
 */
export function ProductImage({
  p,
  className,
  sizes = "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw",
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
        <Icon className="size-1/3 text-leaf-700/40" strokeWidth={1.4} />
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
      {stock <= 0 ? "Out of stock" : stock < 10 ? `Only ${stock} left` : "In stock"}
    </span>
  );
}

export function Price({ p, signedIn }: { p: Pick<CatalogItem, "priceCents" | "listPriceCents" | "unit" | "gst">; signedIn: boolean }) {
  if (p.priceCents === null) {
    return signedIn ? (
      <p className="text-sm text-leaf-900/60">Price shown once your account is approved</p>
    ) : (
      <Link href="/login?next=%2Fproducts" className="text-sm font-semibold text-leaf-700 underline-offset-2 hover:underline">
        Sign in for your price
      </Link>
    );
  }
  const special = p.listPriceCents !== null && p.priceCents < p.listPriceCents;
  return (
    <p className="leading-tight">
      <span className="font-display text-xl font-semibold tabular-nums">{aud(p.priceCents)}</span>
      <span className="text-xs text-leaf-900/60"> / {p.unit}</span>
      {special && <span className="ml-1.5 text-xs text-leaf-900/45 line-through">{aud(p.listPriceCents)}</span>}
      <span className="block text-[11px] text-leaf-900/50">{p.gst ? "+ GST" : "GST free"}{special && " · your price"}</span>
    </p>
  );
}

export function ProductCard({ p, signedIn, morph }: { p: CatalogItem; signedIn: boolean; morph?: boolean }) {
  return (
    <div className="reveal group flex flex-col overflow-hidden rounded-2xl border border-leaf-950/10 bg-white transition-[border-color,box-shadow,translate] duration-300 ease-out hover:-translate-y-0.5 hover:border-leaf-700/30 hover:shadow-[0_12px_28px_-12px_rgb(17_58_39/0.25)]">
      <Link href={`/products/${encodeURIComponent(p.sku)}`} className="block overflow-hidden">
        <ProductImage p={p} morph={morph} className="aspect-[4/3] transition-transform duration-500 ease-out group-hover:scale-[1.04]" />
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-leaf-900/45">{p.sku}</p>
        <Link href={`/products/${encodeURIComponent(p.sku)}`} className="mt-0.5 font-semibold leading-snug hover:text-leaf-700">
          {p.name}
        </Link>
        <p className="mt-0.5 text-xs text-leaf-900/60">
          {p.packSize}
          {p.minQty > 1 && ` · min ${p.minQty}`}
        </p>
        <div className="mt-3 flex items-end justify-between gap-2">
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
