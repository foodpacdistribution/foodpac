"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { cx } from "@/components/ui";
import { aud } from "@/lib/money";
import { RollingAmount, useCartCount } from "./cart-badge";
import { openCart } from "./cart-drawer";

/** Pages with their own bar at the bottom (or that are the cart already). */
const OWN_BAR = /^\/(cart|checkout|products\/)/;

/**
 * Phones: once something is in the cart, a plain strip along the bottom (like the product page's
 * buy bar) with the total, how far from free delivery, and Checkout. The count moves the moment a
 * button is tapped; the total rolls to the new amount.
 */
export function CartBar({ count, totalCents, freeGapCents, freeOverCents }: { count: number; totalCents: number; freeGapCents: number; freeOverCents: number }) {
  const tr = useT();
  const pathname = usePathname();
  const { shown, pending } = useCartCount(count);
  const bar = useRef<HTMLDivElement>(null);
  const show = shown > 0 && !OWN_BAR.test(pathname);
  const spent = freeOverCents > 0 ? Math.min(100, Math.round(((freeOverCents - freeGapCents) / freeOverCents) * 100)) : 100;

  // Lets the back-to-top button sit above the bar.
  useEffect(() => {
    const root = document.documentElement;
    if (show && matchMedia("(max-width: 1023px)").matches) root.style.setProperty("--buy-bar", `${bar.current?.offsetHeight ?? 0}px`);
    else root.style.removeProperty("--buy-bar");
    return () => {
      root.style.removeProperty("--buy-bar");
    };
  }, [show]);

  return (
    <>
      {/* Room under the footer so the bar never covers its last lines. */}
      {show && <div aria-hidden className="h-[4.5rem] bg-leaf-950 lg:hidden" />}
      <div
        ref={bar}
        inert={!show}
        className={cx(
          "fixed inset-x-0 bottom-0 z-30 border-t border-leaf-950/15 bg-cream/95 pb-[env(safe-area-inset-bottom)] backdrop-blur transition-transform duration-300 ease-out lg:hidden",
          show ? "translate-y-0" : "translate-y-full",
        )}
      >
        {freeOverCents > 0 && (
          // How close the order is to free delivery: a thin rule along the top edge.
          <div className="h-[3px] bg-leaf-950/8">
            <div className="h-full bg-leaf-700 transition-[width] duration-700 ease-out" style={{ width: `${spent}%` }} />
          </div>
        )}
        <div className="flex items-center gap-4 px-4 py-2.5">
          <Link
            href="/cart"
            data-cart-target="bar"
            className="min-w-0 flex-1 leading-tight"
            aria-label={tr("View cart")}
            onClick={(e) => {
              // The cart slides in over the page instead of leaving it.
              e.preventDefault();
              openCart();
            }}
          >
            <span className={cx("block font-display text-lg font-semibold text-leaf-950 transition-opacity", pending !== 0 && "opacity-50")}>
              {totalCents > 0 ? <RollingAmount cents={totalCents} /> : tr(shown === 1 ? "1 item in your cart" : "{n} items in your cart", { n: shown })}
            </span>
            <span className="block truncate text-xs text-leaf-900/60">
              {tr(shown === 1 ? "1 item in your cart" : "{n} items in your cart", { n: shown })}
              {freeGapCents > 0 ? ` · ${tr("Add {more} more for free delivery", { more: aud(freeGapCents) })}` : freeOverCents > 0 ? ` · ${tr("Free delivery")}` : ""}
            </span>
          </Link>
          <Link href="/checkout" className="inline-flex h-11 shrink-0 items-center rounded-md bg-tomato px-5 text-sm font-semibold text-white hover:bg-tomato-dark">
            {tr("Checkout")}
          </Link>
        </div>
      </div>
    </>
  );
}
