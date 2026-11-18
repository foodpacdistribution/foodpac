"use client";

import { Check, Minus, Plus, ShoppingCart } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { addToCart } from "@/app/actions/shop";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { cx } from "@/components/ui";
import { cartonSize } from "@/lib/stock-units";
import { bumpCart, flyToCart } from "./cart-badge";
import { SellBy } from "./sell-by";
import { useT } from "@/components/i18n";

/**
 * Quantity stepper (starts at the minimum order) and Add to cart. Stock is checked again at checkout.
 * Products sold by the pack with a carton size can also be ordered in whole cartons.
 */
export function AddToCart({
  productId,
  minQty: unitMin,
  stock,
  packSize = "",
  unit = "",
  size = "md",
}: {
  productId: string;
  minQty: number;
  stock: number;
  packSize?: string;
  unit?: string;
  size?: "md" | "lg";
}) {
  const tr = useT();
  const per = cartonSize(packSize, unit);
  const [byCarton, setByCarton] = useState(false);
  // In cartons: at least enough cartons for the minimum order.
  const minQty = byCarton && per ? Math.max(1, Math.ceil(unitMin / per)) : unitMin;
  const [qty, setQty] = useState(unitMin);
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
    <div className={cx("@container", per && "space-y-1.5")}>
      {per && (
        <SellBy
          unit={unit}
          per={per}
          byCarton={byCarton}
          onChange={(c) => {
            setByCarton(c);
            setQty(c ? Math.max(1, Math.ceil(unitMin / per)) : unitMin);
          }}
        />
      )}
      <div className={cx("flex items-center", lg ? "gap-2" : "gap-1.5")}>
        <div className={cx("flex shrink-0 items-center rounded-md border bg-white", lg ? "h-12 border-leaf-950/20" : "h-9 border-leaf-950/12")}>
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
          onClick={(e) => {
            // Show it in the cart straight away; undo if the server says no.
            const n = Math.max(minQty, qty);
            flyToCart(e.currentTarget);
            bumpCart(n);
            setAdded((k) => k + 1);
            start(async () => {
              const r = await addToCart(productId, n, byCarton);
              if (!r.ok) {
                bumpCart(-n);
                setAdded(0);
                setToast({ id: Date.now(), text: r.error, tone: "warn" });
              }
            });
          }}
          className={cx(
            "inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md font-semibold transition-[background-color,color,box-shadow,scale] duration-200 active:scale-95 disabled:opacity-50",
            // On a product's own page the main button; in a list a quiet outline that fills on hover,
            // so a page of products isn't a wall of dark buttons.
            lg
              ? cx("h-12 px-3 text-base text-white sm:px-6", added > 0 ? "bg-leaf-700" : "bg-leaf-800 hover:bg-leaf-900")
              : cx(
                  "h-9 px-2 text-sm sm:px-3",
                  added > 0 ? "bg-leaf-800 text-white" : "bg-white text-leaf-950 ring-1 ring-leaf-950/25 ring-inset hover:bg-leaf-950 hover:text-white hover:ring-leaf-950",
                ),
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
      </div>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
