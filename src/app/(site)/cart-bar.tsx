"use client";

import { ArrowRight, ShoppingCart } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { cx } from "@/components/ui";
import { aud } from "@/lib/money";
import { RollingAmount, useCartCount } from "./cart-badge";

/** Pages with their own bar at the bottom (or that are the cart already). */
const OWN_BAR = /^\/(cart|checkout|products\/)/;

/**
 * Phones: once something is in the cart, a bar along the bottom with how many items, the total
 * and the way to checkout, so the cart is a thumb away while browsing. It slides up on the first
 * add, the count moves the moment a button is tapped, and the total rolls to the new amount.
 */
export function CartBar({ count, totalCents, freeGapCents, freeOverCents }: { count: number; totalCents: number; freeGapCents: number; freeOverCents: number }) {
  const tr = useT();
  const pathname = usePathname();
  const { shown, pending, pulse } = useCartCount(count);
  const bar = useRef<HTMLDivElement>(null);
  const show = shown > 0 && !OWN_BAR.test(pathname);
  const spent = freeOverCents > 0 ? Math.min(100, Math.round(((freeOverCents - freeGapCents) / freeOverCents) * 100)) : 100;

  // Lets the back-to-top button sit above the bar.
  useEffect(() => {
    const root = document.documentElement;
    if (show && matchMedia("(max-width: 1023px)").matches) root.style.setProperty("--buy-bar", `${(bar.current?.offsetHeight ?? 0) + 12}px`);
    else root.style.removeProperty("--buy-bar");
    return () => {
      root.style.removeProperty("--buy-bar");
    };
  }, [show]);

  return (
    <>
      {/* Room under the footer so the bar never covers its last lines. */}
      {show && <div aria-hidden className="h-24 bg-leaf-950 lg:hidden" />}
      <div
        ref={bar}
        inert={!show}
        className={cx(
          "fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 overflow-hidden rounded-xl bg-leaf-950 text-white shadow-[0_12px_32px_-10px_rgb(11_42_28/0.65)] transition-[translate,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] lg:hidden",
          show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-[140%] opacity-0",
        )}
      >
        {freeOverCents > 0 && (
          // How close the order is to free delivery, along the top edge.
          <div className="h-1 bg-white/10">
            <div className={cx("h-full transition-[width] duration-700 ease-out", freeGapCents > 0 ? "bg-tomato" : "bg-leaf-600")} style={{ width: `${spent}%` }} />
          </div>
        )}
        <div className="flex items-center gap-3 py-2.5 pr-2.5 pl-3.5">
          <Link href="/cart" className="flex min-w-0 flex-1 items-center gap-3" aria-label={tr("View cart")}>
            <span data-cart-target="bar" className="relative grid size-10 shrink-0 place-items-center rounded-lg bg-white/10">
              <ShoppingCart className="size-5" />
              <span key={pulse} className={cx("absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-tomato px-1 text-[11px] font-semibold tabular-nums", pulse > 0 && "animate-bump")}>
                {shown > 99 ? "99+" : shown}
              </span>
            </span>
            <span className="min-w-0 leading-tight">
              <span className={cx("block text-[15px] font-semibold transition-opacity", pending !== 0 && "opacity-60")}>
                {totalCents > 0 ? <RollingAmount cents={totalCents} /> : tr("Your cart")}
              </span>
              <span className="block truncate text-xs text-white/65">
                {freeGapCents > 0 ? tr("Add {more} more for free delivery", { more: aud(freeGapCents) }) : freeOverCents > 0 ? tr("Free delivery") : tr(shown === 1 ? "1 item in your cart" : "{n} items in your cart", { n: shown })}
              </span>
            </span>
          </Link>
          <Link href="/checkout" className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-tomato px-4 text-sm font-semibold transition-transform active:scale-95">
            {tr("Checkout")} <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </>
  );
}
