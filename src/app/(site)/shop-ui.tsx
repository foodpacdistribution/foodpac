import Link from "next/link";
import { cx } from "@/components/ui";
import { aud } from "@/lib/money";
import type { CatalogItem } from "@/lib/shop";
import { AddToCart } from "./add-to-cart";
import { categoryInfo } from "./content";

export function ProductImage({ p, className }: { p: Pick<CatalogItem, "id" | "hasImage" | "category" | "name">; className?: string }) {
  const Icon = categoryInfo(p.category).icon;
  return (
    <div className={cx("grid place-items-center overflow-hidden bg-leaf-50", className)}>
      {p.hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- served from our own API
        <img src={`/api/products/${p.id}/image`} alt={p.name} className="size-full object-cover" />
      ) : (
        <Icon className="size-1/3 text-leaf-700/40" strokeWidth={1.4} />
      )}
    </div>
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

export function ProductCard({ p, signedIn }: { p: CatalogItem; signedIn: boolean }) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-leaf-950/10 bg-white transition-colors hover:border-leaf-700/30">
      <Link href={`/products/${encodeURIComponent(p.sku)}`} className="block">
        <ProductImage p={p} className="aspect-[4/3] transition-transform duration-300 group-hover:scale-[1.02]" />
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
