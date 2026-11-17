"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { setCartQty } from "@/app/actions/shop";
import { cx, Spinner } from "@/components/ui";
import { useT } from "@/components/i18n";
import { SellBy } from "../sell-by";

/**
 * Quantity on a cart line: whole cartons when `byCarton`, otherwise units. Products with a carton
 * size can switch between the two, keeping about the same amount of goods.
 */
export function CartQty({ productId, qty, minQty, unit, per, byCarton }: { productId: string; qty: number; minQty: number; unit: string; per: number | null; byCarton: boolean }) {
  const tr = useT();
  const [pending, start] = useTransition();
  const set = (n: number, carton = byCarton) => start(async () => void (await setCartQty(productId, n, carton)));
  const least = byCarton ? 1 : minQty;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {per && (
        <SellBy
          unit={unit}
          per={per}
          byCarton={byCarton}
          onChange={(c) => {
            if (c === byCarton || pending) return;
            set(c ? Math.max(1, Math.round(qty / per)) : Math.max(minQty, qty * per), c);
          }}
        />
      )}
      <div className={cx("flex h-9 items-center rounded-md border border-leaf-950/15 bg-white", pending && "opacity-60")}>
        <button type="button" aria-label={tr("Less")} disabled={pending || qty <= least} onClick={() => set(qty - 1)} className="grid size-9 place-items-center disabled:opacity-30">
          <Minus className="size-3.5" />
        </button>
        <span className="w-8 text-center text-sm font-semibold tabular-nums">{pending ? <Spinner className="size-3" /> : qty}</span>
        <button type="button" aria-label={tr("More")} disabled={pending} onClick={() => set(qty + 1)} className="grid size-9 place-items-center">
          <Plus className="size-3.5" />
        </button>
      </div>
      <button type="button" aria-label={tr("Remove")} disabled={pending} onClick={() => set(0)} className="grid size-9 place-items-center rounded-md text-leaf-900/40 hover:bg-red-50 hover:text-red-600">
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
