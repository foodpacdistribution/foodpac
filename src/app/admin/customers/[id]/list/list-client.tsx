"use client";

import { Heart, Lightbulb, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { addListItems, removeListItem, setListItemQty } from "@/app/actions/price-match";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { Badge, btn, Card, CardHeader, cx, EmptyState, inputCls, Spinner } from "@/components/ui";
import type { ListItem } from "@/lib/customer-list";
import { aud } from "@/lib/money";

type Product = { id: string; sku: string; name: string; packSize: string; unit: string; minQty: number; priceCents: number };
type Result = { ok: boolean; message?: string; error?: string };

export function CustomerListClient({ customerId, items, products, suggestions }: { customerId: string; items: ListItem[]; products: Product[]; suggestions: Product[] }) {
  const tr = useT();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const onList = useMemo(() => new Set(items.map((i) => i.productId)), [items]);

  const run = (key: string, fn: () => Promise<Result>) => {
    setBusy(key);
    start(async () => {
      const r = await fn();
      setBusy(null);
      setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Saved") : (r.error ?? "Something went wrong"), tone: r.ok ? "ok" : "warn" });
    });
  };
  const add = (ps: Product[]) => run("add", () => addListItems(customerId, ps.map((p) => ({ productId: p.id, qty: p.minQty }))));

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Heart className="size-4 text-rose-500" /> {tr("On their list")}</span>} subtitle={items.length ? tr("{n} products", { n: items.length }) : undefined} />
        <div className="border-b border-line p-3">
          <AddProduct products={products.filter((p) => !onList.has(p.id))} onPick={(p) => add([p])} busy={busy === "add"} />
        </div>
        {!items.length ? (
          <EmptyState icon={Heart} title="Nothing on their list yet">
            {"Search above, or price match their products: every product you price match goes on the list."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <Row
                key={i.productId}
                item={i}
                busy={busy === i.productId}
                onQty={(qty) => run(i.productId, () => setListItemQty(customerId, i.productId, qty))}
                onRemove={() => run(i.productId, () => removeListItem(customerId, i.productId))}
              />
            ))}
          </ul>
        )}
      </Card>

      {suggestions.length > 0 && (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Lightbulb className="size-4 text-amber-500" /> {tr("Worth adding")}</span>}
            subtitle="What stores like this one buy."
            action={
              <button disabled={busy === "add"} onClick={() => add(suggestions)} className={btn("secondary", "sm")}>
                <Plus className="size-3.5" /> {tr("Add all")}
              </button>
            }
          />
          <ul className="divide-y divide-line text-sm">
            {suggestions.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{p.name}</span>
                  <span className="block text-xs text-slate-500">
                    {[p.sku, p.packSize].filter(Boolean).join(" · ")} · {aud(p.priceCents)}
                  </span>
                </span>
                <button disabled={busy === "add"} onClick={() => add([p])} className={btn("ghost", "icon")} aria-label={tr("Add {name}", { name: p.name })}>
                  <Plus className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function Row({ item: i, busy, onQty, onRemove }: { item: ListItem; busy: boolean; onQty: (qty: number | null) => void; onRemove: () => void }) {
  const tr = useT();
  const [qty, setQty] = useState(i.qty === null ? "" : String(i.qty));
  const commit = () => {
    const n = qty.trim() ? Math.round(Number(qty)) : null;
    if (n === i.qty || (n !== null && !(n > 0))) return setQty(i.qty === null ? "" : String(i.qty));
    onQty(n);
  };
  return (
    <li className={cx("flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap", !i.active && "opacity-60")}>
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <p className="font-medium text-slate-900">{i.name}</p>
        <p className="text-xs text-slate-500">
          {[i.sku, i.packSize].filter(Boolean).join(" · ")} · <span className="font-medium text-slate-700 tabular-nums">{aud(i.priceCents)}</span>
          {i.priceCents < i.listCents && <span className="ml-1 text-slate-400 line-through tabular-nums">{aud(i.listCents)}</span>}
          {" / "}
          {tr(i.unit)}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-slate-400">
          {i.byCustomer ? <span>{tr("Added by the customer")}</span> : i.addedByName && <span>{tr("Added by {name}", { name: i.addedByName })}</span>}
          {!i.active && <Badge>{"Not on sale"}</Badge>}
          {i.active && i.stock <= 0 && <Badge tone="amber">{"Out of stock"}</Badge>}
        </p>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-500">
        {tr("Usual qty")}
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          inputMode="numeric"
          placeholder={String(i.minQty)}
          aria-label={tr("Usual quantity of {name}", { name: i.name })}
          className={cx(inputCls, "w-20 text-right tabular-nums")}
        />
      </label>
      <button disabled={busy} onClick={onRemove} className={btn("ghost", "icon")} aria-label={tr("Remove {name}", { name: i.name })}>
        {busy ? <Spinner /> : <Trash2 className="size-4" />}
      </button>
    </li>
  );
}

function AddProduct({ products, onPick, busy }: { products: Product[]; onPick: (p: Product) => void; busy: boolean }) {
  const tr = useT();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return products.filter((p) => words.every((w) => p.name.toLowerCase().includes(w) || p.sku.toLowerCase().includes(w))).slice(0, 8);
  }, [products, q]);
  const pick = (p: Product) => {
    onPick(p);
    setQ("");
  };
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-3 left-3 size-4 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) {
              e.preventDefault();
              pick(shown[0]);
            }
          }}
          placeholder={tr("Add a product: type its name or code")}
          autoComplete="off"
          className={cx(inputCls, "h-11 pl-9 text-base")}
        />
        {busy && <Spinner className="absolute top-3.5 right-3 text-slate-400" />}
      </div>
      {shown.length > 0 && (
        <ul className="mt-1.5 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => pick(p)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{p.name}</span>
                  <span className="block text-xs text-slate-500">{[p.sku, p.packSize].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-slate-600 tabular-nums">
                  {aud(p.priceCents)} <Plus className="size-4 text-blue-600" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
