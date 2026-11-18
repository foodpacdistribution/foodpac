"use client";

import { useT } from "@/components/i18n";
import { cx } from "@/components/ui";

/**
 * Packs or whole cartons, for products sold by the pack with a carton size. A carton is the same
 * price per pack; it just saves counting.
 */
export function SellBy({ unit, per, byCarton, onChange, className }: { unit: string; per: number; byCarton: boolean; onChange: (byCarton: boolean) => void; className?: string }) {
  const tr = useT();
  return (
    <div role="radiogroup" aria-label={tr("Order by")} className={cx("inline-flex rounded-md border border-leaf-950/15 bg-white p-0.5 text-xs", className)}>
      {[false, true].map((carton) => (
        <button
          key={String(carton)}
          type="button"
          role="radio"
          aria-checked={byCarton === carton}
          onClick={() => onChange(carton)}
          className={cx("rounded px-2 py-1 whitespace-nowrap transition-colors duration-150", byCarton === carton ? "bg-leaf-100 font-semibold text-leaf-950" : "text-leaf-900/60 hover:text-leaf-950")}
        >
          {carton ? tr("Carton of {n}", { n: per }) : tr(unit)}
        </button>
      ))}
    </div>
  );
}
