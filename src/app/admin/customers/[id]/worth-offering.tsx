"use client";

import { FileText, Lightbulb, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { btn, Card, CardHeader, cx } from "@/components/ui";
import { aud } from "@/lib/money";

export type Offer = { id: string; name: string; sku: string; packSize: string; priceCents: number; stock: number; stores: number; of: number };

/**
 * Products this customer doesn't buy from us yet but stores like them do: something to bring up
 * on the next visit. Tick some and start a quote or an order with them already on it.
 */
export function WorthOffering({ customerId, items, canAct }: { customerId: string; items: Offer[]; canAct: boolean }) {
  const tr = useT();
  const [picked, setPicked] = useState<string[]>([]);
  if (!items.length) return null;
  const add = picked.length ? picked : items.map((i) => i.id);
  const query = `customer=${customerId}&add=${add.join(",")}`;
  const history = items[0].of > 0;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Lightbulb className="size-4 text-amber-500" /> {tr("Worth offering")}
          </span>
        }
        subtitle={history ? tr("Bought by stores that buy what this one buys, but not by this one yet.") : tr("No orders yet: what sells to the most stores.")}
      />
      <ul className="divide-y divide-line text-sm">
        {items.map((i) => (
          <li key={i.id}>
            <label className={cx("flex items-start gap-3 px-4 py-2.5", canAct && "cursor-pointer hover:bg-slate-50")}>
              {canAct && (
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={picked.includes(i.id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i.id] : p.filter((x) => x !== i.id)))}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-slate-900">{i.name}</span>
                <span className="block text-xs text-slate-500">
                  {[i.sku, i.packSize].filter(Boolean).join(" · ")} · {aud(i.priceCents)}
                  {i.stock <= 0 && <span className="text-red-600"> · {tr("Out of stock")}</span>}
                </span>
                <span className="block text-xs text-slate-500">
                  {history ? tr("{n} of {of} similar stores buy it", { n: i.stores, of: i.of }) : tr(i.stores === 1 ? "1 store buys it" : "{n} stores buy it", { n: i.stores })}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {canAct && (
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
          <Link href={`/admin/quotes/new?${query}`} className={btn("secondary", "sm")}>
            <FileText className="size-3.5" /> {picked.length ? tr("Quote {n}", { n: picked.length }) : tr("Quote all")}
          </Link>
          <Link href={`/admin/sales/new?${query}`} className={btn("primary", "sm")}>
            <ShoppingCart className="size-3.5" /> {picked.length ? tr("Order {n}", { n: picked.length }) : tr("Order all")}
          </Link>
        </div>
      )}
    </Card>
  );
}
