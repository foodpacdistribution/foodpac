"use client";

import { Check, Minus, Plus, ShoppingCart } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { addToCart } from "@/app/actions/shop";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { cx } from "@/components/ui";
import { bumpCart } from "./cart-badge";
import { useT } from "@/components/i18n";

/** Quantity stepper (starts at the minimum order) and Add to cart. Stock is checked again at checkout. */
export function AddToCart({ productId, minQty, stock, size = "md" }: { productId: string; minQty: number; stock: number; size?: "md" | "lg" }) {
  const tr = useT();
  const [qty, setQty] = useState(minQty);
  const [, start] = useTransition();
  const [added, setAdded] = useState(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // "Added ✓" for a moment after each click, then back to "Add".
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(0), 1600);
    return () => clearTimeout(t);
  }, [added]);
  const out = stock <= 0;
  const lg = size === "lg";
  return (
    // A container, so the label hides by the space this control actually has, not the screen width:
    // two cards side by side on a phone are narrower than the 380px rule used to assume.
    <div className={cx("@container flex items-center", lg ? "gap-2" : "gap-1.5")}>
      <div className={cx("flex shrink-0 items-center rounded-md border border-leaf-950/20 bg-white", lg ? "h-12" : "h-9")}>
        <button type="button" aria-label={tr("Less")} disabled={qty <= minQty} onClick={() => setQty((q) => Math.max(minQty, q - 1))} className={cx("grid place-items-center text-leaf-900 disabled:opacity-30", lg ? "size-12" : "size-8 sm:size-9")}>
          <Minus className="size-3.5" />
        </button>
        <input
          aria-label={tr("Quantity")}
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0))}
          onBlur={() => setQty((q) => Math.max(minQty, q))}
          className={cx("bg-transparent text-center font-semibold tabular-nums outline-none", lg ? "w-12 text-base" : "w-7 text-sm sm:w-8")}
        />
        <button type="button" aria-label={tr("More")} onClick={() => setQty((q) => q + 1)} className={cx("grid place-items-center text-leaf-900", lg ? "size-12" : "size-8 sm:size-9")}>
          <Plus className="size-3.5" />
        </button>
      </div>
      <button
        type="button"
        disabled={out}
        onClick={() => {
          // Show it in the cart straight away; undo if the server says no.
          const n = Math.max(minQty, qty);
          bumpCart(n);
          setAdded((k) => k + 1);
          start(async () => {
            const r = await addToCart(productId, n);
            if (!r.ok) {
              bumpCart(-n);
              setAdded(0);
              setToast({ id: Date.now(), text: r.error, tone: "warn" });
            }
          });
        }}
        className={cx(
          "inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md font-semibold text-white transition-colors duration-150 disabled:opacity-50",
          added > 0 ? "bg-leaf-700" : "bg-leaf-800 hover:bg-leaf-900",
          lg ? "h-12 px-3 text-base sm:px-6" : "h-9 px-2 text-sm sm:px-3",
        )}
      >
        {added > 0 ? (
          <span key={added} className="flex animate-pop items-center gap-2">
            <Check className="size-4 shrink-0" strokeWidth={3} /> <span className={cx(!lg && "@max-[11rem]:sr-only")}>{tr("Added")}</span></span>
        ) : (
          <>
            <ShoppingCart className="size-4 shrink-0" />
            <span className={cx("truncate", !lg && "@max-[11rem]:sr-only")}>{tr(out ? (lg ? "Out of stock" : "Sold out") : "Add")}</span>
            {lg && !out && tr(" to cart")}
          </>
        )}
      </button>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
