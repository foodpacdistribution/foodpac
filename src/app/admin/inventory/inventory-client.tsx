"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { adjustStock } from "@/app/actions/products";
import { FormError, Modal, Toast, type ToastMessage } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, cx, Field, inputCls, PageHeader } from "@/components/ui";
import type { MovementType } from "@/lib/db/schema";
import { MOVEMENT_LABEL, qtyText } from "@/lib/purchasing/labels";
import { LOW_STOCK } from "@/lib/stock";

type StockRow = { id: string; sku: string; name: string; unit: string; category: string; stock: number; active: boolean; reserved: number; waiting: number; onOrder: number; toReturn: number };
type Movement = { id: string; productId: string; sku: string; productName: string; movementType: MovementType; qty: number; balanceAfter: number; referenceType: string | null; referenceId: string | null; referenceNumber: string | null; note: string | null; by: string | null; createdAt: string };

const refLink = (m: Movement) =>
  m.referenceId && m.referenceType
    ? ({ goods_receipt: `/admin/goods-receipts/${m.referenceId}`, purchase_return: `/admin/purchase-returns/${m.referenceId}`, customer_return: `/admin/customer-returns/${m.referenceId}`, sales_order: `/admin/sales/${m.referenceId}` } as Record<string, string>)[m.referenceType]
    : undefined;

export function InventoryClient({ tab, filters, stock, ledger }: { tab: "stock" | "ledger"; filters: { productId: string; type: string }; stock: StockRow[]; ledger: Movement[] }) {
  const tr = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [low, setLow] = useState(false);
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const dq = useDeferredValue(q);
  const shown = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return stock.filter((p) => (!low || (p.active && p.stock <= LOW_STOCK)) && (!s || `${p.sku} ${p.name} ${p.category}`.toLowerCase().includes(s)));
  }, [stock, dq, low]);
  const lowCount = stock.filter((p) => p.active && p.stock <= LOW_STOCK).length;
  const go = (patch: Record<string, string>) => {
    const qs = new URLSearchParams({ tab: "ledger", ...(filters.productId && { product: filters.productId }), ...(filters.type && { type: filters.type }), ...patch });
    for (const [k, v] of [...qs.entries()]) if (!v) qs.delete(k);
    router.push(`/admin/inventory?${qs}`);
  };

  return (
    <>
      <PageHeader title={tr("Inventory")} subtitle={tr("Stock by product, and every change to it. The stock movements can't be edited or deleted: a mistake is fixed with a new adjustment.")} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Link href="/admin/inventory" className={btn(tab === "stock" ? "primary" : "ghost", "sm")}>{tr("Stock overview")}</Link>
        <Link href="/admin/inventory?tab=ledger" className={btn(tab === "ledger" ? "primary" : "ghost", "sm")}>{tr("Stock movements")}</Link>
      </div>

      {tab === "stock" ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search SKU, name or category")} className={cx(inputCls, "pl-9")} />
            </div>
            <button className={btn(low ? "primary" : "ghost", "sm")} onClick={() => setLow(!low)}>
              {tr("Low stock ({n})", { n: lowCount })}
            </button>
          </div>
          {/* Phones: one row per product, what's free to sell first. */}
          <Card className="divide-y divide-line md:hidden">
            {shown.map((p) => {
              const extra = [
                p.reserved ? `${tr("Reserved for orders")} ${p.reserved}` : null,
                p.waiting ? `${tr("Customers waiting")} ${p.waiting}` : null,
                p.onOrder ? `${tr("On order")} ${qtyText(p.onOrder)}` : null,
                p.toReturn ? `${tr("To return")} ${qtyText(p.toReturn)}` : null,
              ].filter(Boolean);
              return (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug text-slate-900">
                        {p.name} {!p.active && <Badge tone="slate">{tr("Hidden")}</Badge>}
                      </p>
                      <p className="truncate text-xs text-slate-500">{p.sku} · {tr(p.category)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cx("text-lg font-semibold leading-tight tabular-nums", p.active && p.stock <= LOW_STOCK ? "text-red-600" : "text-slate-900")}>{p.stock}</p>
                      <p className="text-[11px] text-slate-500">{tr("Available")}</p>
                    </div>
                  </div>
                  {extra.length > 0 && <p className={cx("mt-1 text-xs", p.waiting ? "text-red-600" : "text-slate-500")}>{extra.join(" · ")}</p>}
                  <div className="mt-2 flex gap-2">
                    <Link href={`/admin/inventory?tab=ledger&product=${p.id}`} className={btn("secondary", "sm", "h-9 flex-1")}>{tr("History")}</Link>
                    <button className={btn("secondary", "sm", "h-9 flex-1")} onClick={() => setAdjusting(p)}>
                      <SlidersHorizontal className="size-3.5" /> {tr("Adjust")}
                    </button>
                  </div>
                </div>
              );
            })}
          </Card>
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{tr("Product")}</th>
                  <th className="px-2 py-2.5 text-right font-medium" title={tr("Free to sell")}>{tr("Available")}</th>
                  <th className="px-2 py-2.5 text-right font-medium">{tr("Reserved for orders")}</th>
                  <th className="px-2 py-2.5 text-right font-medium">{tr("On hand")}</th>
                  <th className="px-2 py-2.5 text-right font-medium">{tr("Customers waiting")}</th>
                  <th className="px-2 py-2.5 text-right font-medium">{tr("On order")}</th>
                  <th className="px-2 py-2.5 text-right font-medium">{tr("To return")}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{p.name} {!p.active && <Badge tone="slate">{tr("Hidden")}</Badge>}</p>
                      <p className="text-xs text-slate-500">{p.sku} · {tr(p.category)}</p>
                    </td>
                    <td className={cx("px-2 py-2.5 text-right font-semibold tabular-nums", p.active && p.stock <= LOW_STOCK && "text-red-600")}>{p.stock}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{p.reserved || "—"}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{p.stock + p.reserved}</td>
                    <td className={cx("px-2 py-2.5 text-right tabular-nums", p.waiting ? "font-medium text-red-600" : "text-slate-400")}>{p.waiting || "—"}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{p.onOrder ? qtyText(p.onOrder) : "—"}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{p.toReturn ? qtyText(p.toReturn) : "—"}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <Link href={`/admin/inventory?tab=ledger&product=${p.id}`} className={btn("ghost", "sm")}>{tr("History")}</Link>
                      <button className={btn("ghost", "sm")} onClick={() => setAdjusting(p)}>
                        <SlidersHorizontal className="size-3.5" /> {tr("Adjust")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value={filters.productId} onChange={(e) => go({ product: e.target.value })} className={cx(inputCls, "w-full sm:w-72")} aria-label={tr("Product")}>
              <option value="">{tr("All products")}</option>
              {stock.map((p) => (
                <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>
              ))}
            </select>
            <select value={filters.type} onChange={(e) => go({ type: e.target.value })} className={cx(inputCls, "w-full sm:w-56")} aria-label={tr("Type")}>
              <option value="">{tr("All types")}</option>
              {Object.entries(MOVEMENT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{tr(v.label)}</option>
              ))}
            </select>
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{tr("When")}</th>
                  <th className="px-2 py-2.5 font-medium">{tr("Product")}</th>
                  <th className="px-2 py-2.5 font-medium">{tr("Type")}</th>
                  <th className="px-2 py-2.5 font-medium">{tr("Reference")}</th>
                  <th className="px-2 py-2.5 text-right font-medium">{tr("Change")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{tr("Balance")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((m) => {
                  const href = refLink(m);
                  return (
                    <tr key={m.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                        {m.createdAt}
                        {m.by && <p className="text-xs text-slate-400">{m.by}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <p className="font-medium">{m.productName}</p>
                        <p className="text-xs text-slate-500">{m.sku}</p>
                      </td>
                      <td className="px-2 py-2"><Badge tone={MOVEMENT_LABEL[m.movementType].tone}>{tr(MOVEMENT_LABEL[m.movementType].label)}</Badge></td>
                      <td className="px-2 py-2 text-slate-600">
                        {m.referenceNumber && (href ? <Link href={href} className="font-medium text-blue-700 hover:underline">{m.referenceNumber}</Link> : m.referenceNumber)}
                        {m.note && <p className="text-xs text-slate-500">{tr(m.note)}</p>}
                      </td>
                      <td className={cx("px-2 py-2 text-right font-semibold tabular-nums", m.qty > 0 ? "text-emerald-700" : "text-red-600")}>{m.qty > 0 ? `+${qtyText(m.qty)}` : qtyText(m.qty)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{qtyText(m.balanceAfter)}</td>
                    </tr>
                  );
                })}
                {!ledger.length && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">{tr("No stock movements match.")}</td></tr>
                )}
              </tbody>
            </table>
          </Card>
          {ledger.length >= 300 && <p className="mt-2 text-xs text-slate-500">{tr("Showing the latest 300. Choose a product to see its full history.")}</p>}
        </>
      )}
      <Modal open={!!adjusting} onClose={() => setAdjusting(null)} title={tr("Adjust stock")}>
        {adjusting && <AdjustForm key={adjusting.id} p={adjusting} onDone={() => setAdjusting(null)} />}
      </Modal>
    </>
  );
}

function AdjustForm({ p, onDone }: { p: StockRow; onDone: () => void }) {
  const tr = useT();
  const router = useRouter();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        <span className="font-medium text-slate-900">{p.name}</span> · {tr("{n} available now", { n: p.stock })}
      </p>
      <Field label="Change" hint="+5 to add, -3 to take off (damaged, lost, counted short). Goods from a supplier go on a goods receipt instead.">
        <input value={delta} onChange={(e) => setDelta(e.target.value)} inputMode="numeric" placeholder="-3" className={inputCls} />
      </Field>
      <Field label="Reason">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("e.g. stocktake, 2 cartons water damaged")} className={inputCls} />
      </Field>
      <FormError message={error} />
      <button
        className={btn("primary")}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            if (!reason.trim()) return setError(tr("Say why the stock is changing."));
            const r = await adjustStock(p.id, Math.round(Number(delta)), reason);
            if (!r.ok) return setError(r.error);
            setToast({ id: Date.now(), text: r.message ?? "Saved", tone: "ok" });
            router.refresh();
            onDone();
          })
        }
      >
        {tr("Save adjustment")}
      </button>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
