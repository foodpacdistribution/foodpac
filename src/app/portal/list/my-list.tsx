"use client";

import { Minus, Plus, ShoppingCart } from "lucide-react";
import { useState, useTransition } from "react";
import { addManyToCart } from "@/app/actions/shop";
import { bumpCart } from "@/app/(site)/cart-badge";
import { FavouriteButton } from "@/app/(site)/favourite-button";
import { ProductImage } from "@/app/(site)/shop-ui";
import { Toast, type ToastMessage } from "@/components/client-ui";
import Link from "@/components/link";
import { cx, Spinner } from "@/components/ui";
import { useT } from "@/components/i18n";
import { aud } from "@/lib/money";
import type { CatalogItem } from "@/lib/shop";

/** The list with a quantity per product (starting at its minimum order) and one "add all" button. */
export function MyList({ items, priced }: { items: CatalogItem[]; priced: boolean }) {
  const tr = useT();
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(items.map((p) => [p.id, p.stock > 0 ? p.minQty : 0])));
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [pending, start] = useTransition();
  const q = (id: string) => qty[id] ?? 0;
  const set = (id: string, n: number) => setQty((s) => ({ ...s, [id]: Math.max(0, Math.min(9999, Math.round(n) || 0)) }));
  const chosen = items.filter((p) => q(p.id) > 0 && p.stock > 0);
  const total = chosen.reduce((t, p) => t + (p.priceCents ?? 0) * Math.max(q(p.id), p.minQty), 0);

  return (
    <>
      <ul className="mt-6 divide-y divide-leaf-950/10 overflow-hidden rounded-2xl border border-leaf-950/10 bg-white">
        {items.map((p) => {
          const out = p.stock <= 0;
          return (
            <li key={p.id} className={cx("flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap sm:gap-4 sm:p-4", out && "bg-leaf-950/[0.02]")}>
              <Link href={`/products/${encodeURIComponent(p.sku)}`} className="size-14 shrink-0 overflow-hidden rounded-xl ring-1 ring-leaf-950/10">
                <ProductImage p={p} sizes="56px" className="size-full [&_span.text-center]:hidden" />
              </Link>
              {/* Phones: name and price take the first line, quantity and heart wrap under it. */}
              <div className="min-w-0 flex-1 basis-[calc(100%-4.25rem)] sm:basis-0">
                <Link href={`/products/${encodeURIComponent(p.sku)}`} className="line-clamp-1 font-semibold hover:text-leaf-700">
                  {p.name}
                </Link>
                <p className="text-xs text-leaf-900/55">
                  {p.sku} · {p.packSize}
                  {p.minQty > 1 && <> · {tr("min {n}", { n: p.minQty })}</>}
                </p>
                <p className="mt-0.5 text-sm">
                  {priced && p.priceCents !== null && (
                    <>
                      <span className="font-semibold tabular-nums">{aud(p.priceCents)}</span>
                      <span className="text-leaf-900/55"> / {tr(p.unit)}</span>
                    </>
                  )}
                  <span className={cx("ml-2 text-xs font-medium", out ? "text-red-600" : "text-leaf-700")}>{tr(out ? "Out of stock" : "In stock")}</span>
                </p>
              </div>
              {priced && (
                <div className={cx("ml-[4.25rem] flex h-9 shrink-0 items-center rounded-full border border-leaf-950/15 bg-white sm:ml-0", out && "opacity-40")}>
                  <button type="button" disabled={out || q(p.id) <= 0} aria-label={tr("Less")} onClick={() => set(p.id, q(p.id) - 1 < p.minQty ? 0 : q(p.id) - 1)} className="grid size-9 place-items-center disabled:opacity-30">
                    <Minus className="size-3.5" />
                  </button>
                  <input
                    aria-label={tr("Quantity")}
                    inputMode="numeric"
                    disabled={out}
                    value={q(p.id)}
                    onChange={(e) => set(p.id, Number(e.target.value.replace(/\D/g, "")))}
                    className="w-10 bg-transparent text-center text-sm font-semibold tabular-nums outline-none"
                  />
                  <button type="button" disabled={out} aria-label={tr("More")} onClick={() => set(p.id, Math.max(q(p.id) + 1, p.minQty))} className="grid size-9 place-items-center">
                    <Plus className="size-3.5" />
                  </button>
                </div>
              )}
              <FavouriteButton productId={p.id} sku={p.sku} favourite={p.favourite} signedIn className="ml-auto shrink-0 sm:ml-0" />
            </li>
          );
        })}
      </ul>

      {priced ? (
        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-leaf-900 px-4 py-3 text-cream shadow-[0_-8px_24px_-16px_rgb(17_58_39/0.6)] sm:px-5">
          <p className="text-sm">
            {tr(chosen.length === 1 ? "{n} product" : "{n} products", { n: chosen.length })}
            {total > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-white tabular-nums">{aud(total)}</span> <span className="text-cream/60">{tr("ex GST")}</span>
              </>
            )}
          </p>
          <button
            type="button"
            disabled={pending || chosen.length === 0}
            onClick={() =>
              start(async () => {
                const r = await addManyToCart(chosen.map((p) => ({ productId: p.id, qty: q(p.id) })));
                if (r.ok) bumpCart((r.data as { units: number } | undefined)?.units ?? 0);
                setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Added") : r.error, tone: r.ok ? "ok" : "warn" });
              })
            }
            className="inline-flex h-11 items-center gap-2 rounded-full bg-tomato px-5 text-sm font-semibold text-white transition-[background-color,scale] hover:bg-tomato-dark active:scale-[0.97] disabled:opacity-50"
          >
            {pending ? <Spinner className="size-4" /> : <ShoppingCart className="size-4" />}
            {tr("Add to cart")}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-leaf-900/60">{tr("Prices and ordering open as soon as your account is approved.")}</p>
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}
