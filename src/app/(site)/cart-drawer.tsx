"use client";

import { ArrowRight, ShoppingBag, TriangleAlert, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type CartSnapshot, cartSnapshot } from "@/app/actions/shop";
import { Drawer } from "@/components/drawer";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { cx } from "@/components/ui";
import { aud } from "@/lib/money";
import { CartQty } from "./cart/cart-line";
import { RollingAmount } from "./cart-badge";
import { ProductImage } from "./shop-ui";

/** Opens the cart panel from anywhere on the page (the header's cart, the phone's cart bar). */
export function openCart() {
  window.dispatchEvent(new Event("cart:open"));
}

/**
 * The cart, sliding in from the right over the page the customer is on: change quantities, take
 * things out, see the total and how far from free delivery, then check out, or close it and carry
 * on shopping exactly where they were. The cart page (/cart) is still there for links to it.
 */
export function CartDrawer() {
  const tr = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [cart, setCart] = useState<CartSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCart(await cartSnapshot());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const on = () => {
      setOpen(true);
      void load();
    };
    window.addEventListener("cart:open", on);
    return () => window.removeEventListener("cart:open", on);
  }, [load]);

  // Following a link out of the panel (a product, Checkout) closes it.
  const [path, setPath] = useState(pathname);
  if (path !== pathname) {
    setPath(pathname);
    setOpen(false);
  }

  const close = useCallback(() => setOpen(false), []);
  const items = cart?.lines.reduce((t, l) => t + l.qty, 0) ?? 0;
  const gap = cart && cart.freeOverCents > 0 ? Math.max(0, cart.freeOverCents - cart.subtotalCents) : 0;
  const blocked = !cart || !cart.priced || cart.belowMinimum || cart.lines.some((l) => l.issue);

  return (
    <Drawer open={open} onClose={close} side="right" label={tr("Your cart")} className={cx("w-[min(26rem,92vw)] overflow-hidden bg-cream text-leaf-950", open && "shadow-[-24px_0_48px_-24px_rgb(11_42_28/0.35)]")}>
      <div className="flex shrink-0 items-center justify-between border-b border-leaf-950/10 px-5 py-4">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {tr("Your cart")}
          {items > 0 && <span className="ml-2 text-sm font-normal text-leaf-900/50 tabular-nums">{items}</span>}
        </h2>
        <button type="button" onClick={close} aria-label={tr("Close")} className="-mr-2 grid size-10 place-items-center rounded-full text-leaf-900/70 transition-colors hover:bg-leaf-950/5 hover:text-leaf-950">
          <X className="size-5" />
        </button>
      </div>

      {cart && cart.priced && cart.lines.length > 0 && cart.freeOverCents > 0 && (
        // How close the order is to free delivery.
        <div className="shrink-0 border-b border-leaf-950/10 px-5 py-3 text-xs text-leaf-900/70">
          {gap > 0 ? tr("Add {more} more for free delivery", { more: aud(gap) }) : tr("Your order has free delivery")}
          <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-leaf-950/8">
            <div className="h-full rounded-full bg-leaf-700 transition-[width] duration-700 ease-out" style={{ width: `${Math.min(100, Math.round((cart.subtotalCents / cart.freeOverCents) * 100))}%` }} />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {!cart && loading ? (
          <ul className="divide-y divide-leaf-950/8 px-5" aria-busy>
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex gap-4 py-5">
                <span className="size-16 shrink-0 animate-pulse rounded-lg bg-leaf-950/8" />
                <span className="flex-1 space-y-2 pt-1">
                  <span className="block h-3.5 w-3/4 animate-pulse rounded bg-leaf-950/8" />
                  <span className="block h-3 w-1/2 animate-pulse rounded bg-leaf-950/8" />
                </span>
              </li>
            ))}
          </ul>
        ) : !cart || cart.lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
            <ShoppingBag className="size-9 text-leaf-900/25" strokeWidth={1.5} />
            <p className="mt-4 font-semibold">{tr("Your cart is empty")}</p>
            <Link href="/products" className="mt-4 text-sm font-semibold text-leaf-800 underline underline-offset-4 decoration-leaf-800/30 hover:decoration-leaf-800">
              {tr("Browse products")}
            </Link>
          </div>
        ) : (
          <ul className={cx("divide-y divide-leaf-950/8 px-5 transition-opacity", loading && "opacity-70")}>
            {cart.lines.map((l) => (
              <li key={l.id} className="flex gap-4 py-5">
                <Link href={`/products/${encodeURIComponent(l.sku)}`} className="shrink-0 overflow-hidden rounded-lg">
                  <ProductImage p={{ ...l, updatedAt: new Date(l.updatedAt) }} sizes="64px" className="size-16" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/products/${encodeURIComponent(l.sku)}`} className="line-clamp-2 text-sm leading-snug font-medium hover:underline">
                      {l.name}
                    </Link>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{cart.priced ? aud(l.lineCents) : ""}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-leaf-900/50">
                    {l.priceCents !== null && `${aud(l.byCarton && l.per ? l.priceCents * l.per : l.priceCents)} / ${tr(l.byCarton ? "carton" : l.unit)}`}
                    {l.byCarton && l.per && ` · ${l.units} ${tr(l.unit)}`}
                  </p>
                  {l.issue && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-red-700">
                      <TriangleAlert className="size-3.5 shrink-0" /> {l.issue}
                    </p>
                  )}
                  <div className="mt-2.5">
                    <CartQty productId={l.id} qty={l.qty} minQty={l.minQty} unit={l.unit} per={l.per} byCarton={l.byCarton} onChanged={load} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {cart && cart.lines.length > 0 && (
        <div className="shrink-0 border-t border-leaf-950/10 bg-cream px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {cart.priced ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-leaf-900/70">{tr("Total incl. GST")}</span>
                <RollingAmount cents={cart.totalCents} className="font-display text-xl font-semibold" />
              </div>
              <p className="mt-1 text-xs text-leaf-900/50">
                {tr("Subtotal")} {aud(cart.subtotalCents)} · {tr("Delivery")} {cart.deliveryFeeCents ? aud(cart.deliveryFeeCents) : tr("Free")} · {tr("GST")} {aud(cart.gstCents)}
              </p>
              {cart.belowMinimum && <p className="mt-2 text-xs text-red-700">{tr("The minimum order is {amount} before GST.", { amount: aud(cart.minOrderCents) })}</p>}
            </>
          ) : (
            <p className="text-sm text-leaf-900/70">{tr("Waiting for account approval")}</p>
          )}
          {blocked ? (
            <Link href="/cart" className="mt-4 flex h-12 w-full items-center justify-center rounded-md bg-leaf-950/8 text-sm font-semibold text-leaf-900/70">
              {tr("Review your cart")}
            </Link>
          ) : (
            <Link href="/checkout" className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-tomato text-base font-semibold text-white transition-colors hover:bg-tomato-dark">
              {tr("Checkout")} <ArrowRight className="size-4" />
            </Link>
          )}
          <button type="button" onClick={close} className="mt-2 h-10 w-full text-sm font-medium text-leaf-900/70 transition-colors hover:text-leaf-950">
            {tr("Continue shopping")}
          </button>
        </div>
      )}
    </Drawer>
  );
}

/** The header's cart: opens the panel (a plain link to /cart until the page's script has loaded). */
export function CartButton({ className, label, children }: { className: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href="/cart"
      data-cart-target="header"
      aria-label={label}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        openCart();
      }}
    >
      {children}
    </Link>
  );
}
