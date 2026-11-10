"use client";

import { History, Minus, Plus, Search, ShoppingCart, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { addManyToCart } from "@/app/actions/shop";
import { bumpCart } from "@/app/(site)/cart-badge";
import { ProductImage } from "@/app/(site)/shop-ui";
import { Toast, type ToastMessage } from "@/components/client-ui";
import Link from "@/components/link";
import { cx, Spinner } from "@/components/ui";
import { useT } from "@/components/i18n";
import { aud } from "@/lib/money";
import { matchProducts } from "@/lib/search-match";
import type { CatalogItem } from "@/lib/shop";

export type SheetItem = CatalogItem & { lastQty?: number; timesOrdered?: number };

/**
 * One page to order from: the customer's usual products with an empty quantity each (and what
 * they had last time), a search to add anything else, and one button that adds it all to the cart.
 */
export function OrderSheet({ usual, catalog }: { usual: SheetItem[]; catalog: CatalogItem[] }) {
  const tr = useT();
  const router = useRouter();
  const [rows, setRows] = useState<SheetItem[]>(usual);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [pending, start] = useTransition();

  const q = (id: string) => qty[id] ?? 0;
  const set = (id: string, n: number) => setQty((s) => ({ ...s, [id]: Math.max(0, Math.min(9999, Math.round(n) || 0)) }));
  const chosen = rows.filter((p) => q(p.id) > 0 && p.stock > 0);
  const total = chosen.reduce((t, p) => t + (p.priceCents ?? 0) * Math.max(q(p.id), p.minQty), 0);
  const withLast = rows.filter((p) => p.lastQty && p.stock > 0);

  // Search the whole range in the browser; products already on the sheet are left out.
  const entries = useMemo(() => catalog.map((p) => ({ ...p, barcode: null, updatedAt: String(p.updatedAt) })), [catalog]);
  const onSheet = new Set(rows.map((r) => r.id));
  const hits = query.trim() ? matchProducts(entries.filter((e) => !onSheet.has(e.id)), query, 8) : [];

  const add = (id: string) => {
    const p = catalog.find((c) => c.id === id);
    if (!p) return;
    setRows((r) => [...r, p]);
    if (p.stock > 0) set(p.id, p.minQty);
    setQuery("");
    setActive(0);
    // Straight to its quantity, so typing "cups ↵ 20" is all it takes.
    requestAnimationFrame(() => document.getElementById(`qty-${p.id}`)?.focus());
  };

  return (
    <>
      <div className="relative mt-5">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-leaf-900/40" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (!hits.length || !["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
            e.preventDefault();
            if (e.key === "ArrowDown") setActive((a) => Math.min(hits.length - 1, a + 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
            else add(hits[active].id);
          }}
          placeholder={tr("Add a product: type its name or code")}
          aria-label={tr("Add a product")}
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="sheet-hits"
          className="h-12 w-full rounded-2xl border border-leaf-950/15 bg-white pr-4 pl-11 text-[15px] placeholder:text-leaf-900/40 focus:border-leaf-600 focus:ring-2 focus:ring-leaf-600/20 focus:outline-none"
        />
        {hits.length > 0 && (
          <ul id="sheet-hits" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-2xl border border-leaf-950/10 bg-white shadow-lg">
            {hits.map((h, i) => {
              const p = catalog.find((c) => c.id === h.id)!;
              return (
                <li key={h.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => add(h.id)}
                    className={cx("flex w-full items-center gap-3 px-4 py-2.5 text-left", i === active && "bg-leaf-50")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block text-xs text-leaf-900/55">
                        {p.sku} · {p.packSize}
                      </span>
                    </span>
                    {p.priceCents !== null && <span className="shrink-0 text-sm font-semibold tabular-nums">{aud(p.priceCents)}</span>}
                    <Plus className="size-4 shrink-0 text-leaf-700" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {query.trim() && hits.length === 0 && (
          <p className="absolute inset-x-0 top-full z-30 mt-1.5 rounded-2xl border border-leaf-950/10 bg-white px-4 py-3 text-sm text-leaf-900/60 shadow-lg">
            {tr("No other product matches “{q}”.", { q: query.trim() })}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-leaf-950/15 bg-white px-6 py-10 text-center text-sm text-leaf-900/60">
          {tr("Search above to start your order. After your first order, the products you buy show up here with their last quantities.")}
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-xs font-semibold tracking-[0.14em] text-leaf-900/50 uppercase">{usual.length ? tr("Your usual products") : tr("Your order")}</h2>
            {withLast.length > 0 && (
              <button
                type="button"
                onClick={() => setQty((s) => ({ ...s, ...Object.fromEntries(withLast.map((p) => [p.id, Math.max(p.lastQty!, p.minQty)])) }))}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-leaf-950/15 bg-white px-3.5 text-sm font-semibold hover:border-leaf-700/40"
              >
                <History className="size-4" /> {tr("Same as last time")}
              </button>
            )}
          </div>
          <ul className="mt-3 divide-y divide-leaf-950/10 overflow-hidden rounded-2xl border border-leaf-950/10 bg-white">
            {rows.map((p) => {
              const out = p.stock <= 0;
              const isUsual = usual.some((u) => u.id === p.id);
              return (
                <li key={p.id} className={cx("flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap sm:gap-4 sm:px-4", out && "bg-leaf-950/[0.02]", q(p.id) > 0 && "bg-leaf-50/60")}>
                  <Link href={`/products/${encodeURIComponent(p.sku)}`} className="size-12 shrink-0 overflow-hidden rounded-xl ring-1 ring-leaf-950/10">
                    <ProductImage p={p} sizes="48px" className="size-full [&_span.text-center]:hidden" />
                  </Link>
                  <div className="min-w-0 flex-1 basis-[calc(100%-3.75rem)] sm:basis-0">
                    <p className="line-clamp-1 font-semibold">{p.name}</p>
                    <p className="text-xs text-leaf-900/55">
                      {p.sku} · {p.packSize}
                      {p.minQty > 1 && <> · {tr("min {n}", { n: p.minQty })}</>}
                    </p>
                    <p className="mt-0.5 text-sm">
                      {p.priceCents !== null && (
                        <>
                          <span className="font-semibold tabular-nums">{aud(p.priceCents)}</span>
                          <span className="text-leaf-900/55"> / {tr(p.unit)}</span>
                        </>
                      )}
                      {out && <span className="ml-2 text-xs font-medium text-red-600">{tr("Out of stock")}</span>}
                    </p>
                  </div>
                  {/* Phones: last time and quantity wrap under the name. */}
                  <div className="ml-[3.75rem] flex flex-1 items-center justify-end gap-2 sm:ml-0 sm:flex-none">
                    {p.lastQty && !out ? (
                      <button
                        type="button"
                        onClick={() => set(p.id, Math.max(p.lastQty!, p.minQty))}
                        title={tr("Use last time's quantity")}
                        className="mr-auto rounded-full px-2 py-1 text-xs text-leaf-900/60 hover:bg-leaf-100 hover:text-leaf-900 sm:mr-0"
                      >
                        {tr("Last: {n}", { n: p.lastQty })}
                      </button>
                    ) : null}
                    <div className={cx("flex h-10 shrink-0 items-center rounded-full border border-leaf-950/15 bg-white", out && "opacity-40")}>
                      <button type="button" disabled={out || q(p.id) <= 0} aria-label={tr("Less")} onClick={() => set(p.id, q(p.id) - 1 < p.minQty ? 0 : q(p.id) - 1)} className="grid size-10 place-items-center disabled:opacity-30">
                        <Minus className="size-3.5" />
                      </button>
                      <input
                        id={`qty-${p.id}`}
                        aria-label={tr("Quantity of {name}", { name: p.name })}
                        inputMode="numeric"
                        disabled={out}
                        value={q(p.id) || ""}
                        placeholder="0"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => set(p.id, Number(e.target.value.replace(/\D/g, "")))}
                        className="w-11 bg-transparent text-center text-sm font-semibold tabular-nums outline-none placeholder:text-leaf-900/30"
                      />
                      <button type="button" disabled={out} aria-label={tr("More")} onClick={() => set(p.id, Math.max(q(p.id) + 1, p.minQty))} className="grid size-10 place-items-center">
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                    {!isUsual && (
                      <button
                        type="button"
                        aria-label={tr("Remove {name}", { name: p.name })}
                        onClick={() => {
                          setRows((r) => r.filter((x) => x.id !== p.id));
                          set(p.id, 0);
                        }}
                        className="grid size-9 shrink-0 place-items-center rounded-full text-leaf-900/50 hover:bg-leaf-100 hover:text-leaf-900"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="sticky bottom-0 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-leaf-900 px-4 py-3 text-cream shadow-[0_-8px_24px_-16px_rgb(17_58_39/0.6)] sm:px-5">
        <p className="text-sm">
          {tr(chosen.length === 1 ? "{n} product" : "{n} products", { n: chosen.length })}
          {total > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-white tabular-nums">{aud(total)}</span> <span className="text-cream/60">{tr("ex GST")}</span>
            </>
          )}
        </p>
        <button
          type="button"
          disabled={pending || chosen.length === 0}
          onClick={() =>
            start(async () => {
              const r = await addManyToCart(chosen.map((p) => ({ productId: p.id, qty: q(p.id) })));
              if (r.ok) {
                bumpCart((r.data as { units: number } | undefined)?.units ?? 0);
                router.push("/cart");
              } else setToast({ id: Date.now(), text: r.error, tone: "warn" });
            })
          }
          className="inline-flex h-11 items-center gap-2 rounded-full bg-tomato px-5 text-sm font-semibold text-white transition-[background-color,scale] hover:bg-tomato-dark active:scale-[0.97] disabled:opacity-50"
        >
          {pending ? <Spinner className="size-4" /> : <ShoppingCart className="size-4" />}
          {tr("Add to cart")}
        </button>
      </div>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}
