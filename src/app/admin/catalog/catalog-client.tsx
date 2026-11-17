"use client";

import { ArrowLeft, Check, FileText, ImageOff, Search, ShoppingCart, X } from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";
import { Modal } from "@/components/client-ui";
import { LoadMore, usePaged } from "@/components/load-more";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { btn, cx, inputCls } from "@/components/ui";
import { aud } from "@/lib/money";
import { LOW_STOCK } from "@/lib/stock";

type Product = {
  id: string;
  name: string;
  sku: string;
  category: string;
  description: string;
  packSize: string;
  unit: string;
  /** What this store pays (its own price, or the list price). */
  priceCents: number;
  listCents: number;
  minQty: number;
  stock: number;
  image: string | null;
  /** How many stores (of this store's kind, when known) bought it over the last year. */
  stores: number;
};

type Store = { id: string; name: string; type: string | null; active: boolean };

/** Most products one quote or order starts with. */
const MAX_PICKED = 50;

export function CatalogClient({ store, products }: { store: Store | null; products: Product[] }) {
  const tr = useT();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<Product | null>(null);

  const categories = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of products) n.set(p.category, (n.get(p.category) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [products]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => (!category || p.category === category) && (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)));
  }, [products, q, category]);

  // Big photos: a page at a time (more as it scrolls), so the grid stays quick on a phone.
  const paged = usePaged(shown, `${q}|${category}`, 48);
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length < MAX_PICKED ? [...x, id] : x));
  const query = new URLSearchParams({ ...(store ? { customer: store.id } : {}), add: picked.join(",") }).toString();
  const canSell = !store || store.active;

  return (
    <div className={cx("mx-auto max-w-6xl", picked.length > 0 && "pb-24")}>
      <header className="mb-4">
        {store && (
          <Link href={`/admin/customers/${store.id}`} className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" /> {store.name}
          </Link>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{tr("Catalogue")}</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {store ? tr("Prices for {name}, ex GST.", { name: store.name }) : tr("List prices, ex GST. Open it from a store's page to see that store's prices.")}
          {store?.type && <> {tr("What other {type} stores buy comes first.", { type: tr(store.type) })}</>}
        </p>
      </header>

      {/* Search and categories stay at the top while scrolling, just under the phone's top bar (100px: logo row and menu row). */}
      <div className="sticky top-[100px] z-20 -mx-4 mb-4 space-y-2 bg-canvas/85 px-4 py-2 backdrop-blur-sm lg:top-0">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search products or codes")} className={cx(inputCls, "pl-9")} />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
          {[null, ...categories].map((c) => (
            <button
              key={c ?? "all"}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cx(
                "h-8 shrink-0 rounded-full border px-3 text-sm whitespace-nowrap transition-colors duration-150",
                category === c ? "border-slate-900 bg-slate-900 text-white" : "border-line bg-white text-slate-600 hover:text-slate-900",
              )}
            >
              {c ? tr(c) : tr("All")}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-500">{tr("No products match.")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {paged.visible.map((p) => {
            const on = picked.includes(p.id);
            return (
              <li key={p.id} className={cx("relative overflow-hidden rounded-xl border bg-white transition-shadow duration-150", on ? "border-blue-600 ring-1 ring-blue-600" : "border-line hover:shadow-card")}>
                <button type="button" onClick={() => setOpen(p)} className="block w-full text-left">
                  <div className="relative aspect-square bg-white">
                    {p.image ? (
                      <Image src={p.image} alt="" fill sizes="(min-width: 1024px) 260px, (min-width: 640px) 33vw, 50vw" className="object-contain p-3" />
                    ) : (
                      <span className="grid size-full place-items-center text-slate-300">
                        <ImageOff className="size-6" />
                      </span>
                    )}
                  </div>
                  <div className="border-t border-line px-3 py-2.5">
                    <p className="line-clamp-2 text-[13px] leading-snug font-medium text-slate-900">{p.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{p.packSize || p.unit}</p>
                    <p className="mt-1.5 flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900 tabular-nums">{aud(p.priceCents)}</span>
                      <StockNote stock={p.stock} />
                    </p>
                  </div>
                </button>
                {canSell && (
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    aria-pressed={on}
                    aria-label={on ? tr("Remove {name}", { name: p.name }) : tr("Pick {name}", { name: p.name })}
                    className={cx(
                      "absolute top-2 right-2 grid size-7 place-items-center rounded-full border transition-colors duration-150",
                      on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white/90 text-transparent hover:border-slate-400",
                    )}
                  >
                    <Check className="size-4" strokeWidth={3} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <LoadMore remaining={paged.remaining} onMore={paged.more} />

      {/* Picked products: start a quote or an order with them. */}
      {picked.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 animate-rise px-4 pb-[max(env(safe-area-inset-bottom),1rem)] lg:left-[16.5rem]">
          <div className="glass mx-auto flex max-w-3xl items-center gap-2 rounded-2xl px-3 py-2.5">
            <button type="button" onClick={() => setPicked([])} className={btn("ghost", "icon", "shrink-0")} aria-label={tr("Clear")}>
              <X className="size-4" />
            </button>
            <p className="min-w-0 flex-1 text-sm font-medium text-slate-900">{tr(picked.length === 1 ? "1 product picked" : "{n} products picked", { n: picked.length })}</p>
            <Link href={`/admin/quotes/new?${query}`} className={btn("secondary", "md", "shrink-0")}>
              <FileText className="size-4" /> {tr("Quote")}
            </Link>
            <Link href={`/admin/sales/new?${query}`} className={btn("primary", "md", "shrink-0")}>
              <ShoppingCart className="size-4" /> {tr("Order")}
            </Link>
          </div>
        </div>
      )}

      <Modal open={open !== null} onClose={() => setOpen(null)} title={open?.name ?? ""}>
        {open && (
          <div className="space-y-4">
            <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-xl border border-line bg-white">
              {open.image ? (
                <Image src={open.image} alt="" fill sizes="384px" className="object-contain p-4" />
              ) : (
                <span className="grid size-full place-items-center text-slate-300">
                  <ImageOff className="size-8" />
                </span>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">{tr("Price")}</dt>
                <dd className="text-lg font-semibold text-slate-900 tabular-nums">
                  {aud(open.priceCents)} <span className="text-xs font-normal text-slate-500">/ {tr(open.unit)}</span>
                </dd>
                {open.priceCents !== open.listCents && <dd className="text-xs text-slate-500 line-through tabular-nums">{aud(open.listCents)}</dd>}
              </div>
              <div>
                <dt className="text-xs text-slate-500">{tr("Stock")}</dt>
                <dd className="mt-1">
                  <StockNote stock={open.stock} long />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{tr("Pack size")}</dt>
                <dd className="text-slate-800">{open.packSize || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{tr("Code")}</dt>
                <dd className="font-mono text-xs text-slate-700">{open.sku}</dd>
              </div>
            </dl>
            {open.description && <p className="text-sm whitespace-pre-line text-slate-600">{open.description}</p>}
            {open.stores > 0 && <p className="text-xs text-slate-500">{tr(open.stores === 1 ? "1 store buys it" : "{n} stores buy it", { n: open.stores })}</p>}
            {canSell && (
              <button
                type="button"
                className={btn(picked.includes(open.id) ? "secondary" : "primary", "lg", "w-full")}
                onClick={() => {
                  toggle(open.id);
                  setOpen(null);
                }}
              >
                {picked.includes(open.id) ? tr("Remove from picked") : tr("Pick for a quote or order")}
              </button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function StockNote({ stock, long }: { stock: number; long?: boolean }) {
  const tr = useT();
  const [label, tone] = stock <= 0 ? ["Out of stock", "text-red-600"] : stock <= LOW_STOCK ? ["Low stock", "text-amber-700"] : ["In stock", "text-emerald-700"];
  return (
    <span className={cx("shrink-0 text-[11px] font-medium", tone, long && "text-sm")}>
      {tr(label)}
      {long && stock > 0 && <span className="font-normal text-slate-500"> · {stock}</span>}
    </span>
  );
}
