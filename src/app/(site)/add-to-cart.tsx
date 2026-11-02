"use client";

import { Minus, Plus, ShoppingCart } from "lucide-react";
import { useState, useTransition } from "react";
import { addToCart } from "@/app/actions/shop";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { cx, Spinner } from "@/components/ui";

/** Quantity stepper (starts at the minimum order) and Add to cart. Stock is checked again at checkout. */
export function AddToCart({ productId, minQty, stock, size = "md" }: { productId: string; minQty: number; stock: number; size?: "md" | "lg" }) {
  const [qty, setQty] = useState(minQty);
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const out = stock <= 0;
  const lg = size === "lg";
  return (
    <div className="flex items-center gap-2">
      <div className={cx("flex items-center rounded-full border border-leaf-950/15 bg-white", lg ? "h-12" : "h-9")}>
        <button type="button" aria-label="Less" disabled={qty <= minQty} onClick={() => setQty((q) => Math.max(minQty, q - 1))} className={cx("grid place-items-center text-leaf-900 disabled:opacity-30", lg ? "size-12" : "size-9")}>
          <Minus className="size-3.5" />
        </button>
        <input
          aria-label="Quantity"
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0))}
          onBlur={() => setQty((q) => Math.max(minQty, q))}
          className={cx("bg-transparent text-center font-semibold tabular-nums outline-none", lg ? "w-12 text-base" : "w-8 text-sm")}
        />
        <button type="button" aria-label="More" onClick={() => setQty((q) => q + 1)} className={cx("grid place-items-center text-leaf-900", lg ? "size-12" : "size-9")}>
          <Plus className="size-3.5" />
        </button>
      </div>
      <button
        type="button"
        disabled={out || pending}
        onClick={() =>
          start(async () => {
            const r = await addToCart(productId, Math.max(minQty, qty));
            setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Added") : r.error, tone: r.ok ? "ok" : "warn" });
          })
        }
        className={cx(
          "inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-leaf-700 font-semibold text-white transition-colors hover:bg-leaf-800 disabled:opacity-50",
          lg ? "h-12 px-6 text-base" : "h-9 px-3 text-sm",
        )}
      >
        {pending ? <Spinner className="size-3.5" /> : <ShoppingCart className="size-4" />}
        {out ? "Out of stock" : "Add"}
        {lg && !out && " to cart"}
      </button>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
