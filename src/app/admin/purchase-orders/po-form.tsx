"use client";

import { ArrowLeft, Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { savePurchaseOrder } from "@/app/actions/purchasing";
import { FormError } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { btn, Card, CardHeader, cx, Field, inputCls } from "@/components/ui";
import { lineTotal, money, purchaseTotals } from "@/lib/purchasing/labels";

export type PoFormProduct = { id: string; sku: string; name: string; unit: string; packSize: string; gst: boolean; stock: number; lastCost: number | null };
type Line = { key: string; productId: string; qty: string; unitCost: string };

let seq = 0;
const key = () => `l${++seq}`;

export function PoForm(p: {
  suppliers: { id: string; name: string }[];
  products: PoFormProduct[];
  today: string;
  po?: { id: string; poNumber: string; supplierId: string; supplierLocked: boolean; orderDate: string; expectedDate: string | null; supplierReference: string | null; notes: string | null; lines: { productId: string; qty: number; unitCost: number }[] };
  defaultSupplierId?: string;
}) {
  const tr = useT();
  const router = useRouter();
  const o = p.po;
  const [head, setHead] = useState({
    supplierId: o?.supplierId ?? p.defaultSupplierId ?? "",
    orderDate: o?.orderDate ?? p.today,
    expectedDate: o?.expectedDate ?? "",
    supplierReference: o?.supplierReference ?? "",
    notes: o?.notes ?? "",
  });
  const [lines, setLines] = useState<Line[]>(() => o?.lines.map((l) => ({ key: key(), productId: l.productId, qty: String(l.qty), unitCost: String(l.unitCost) })) ?? []);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(p.products.map((x) => [x.id, x])), [p.products]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return p.products.filter((x) => `${x.sku} ${x.name}`.toLowerCase().includes(s)).slice(0, 8);
  }, [q, p.products]);

  const add = (productId: string) => {
    const prod = byId.get(productId)!;
    setLines((ls) => (ls.some((l) => l.productId === productId) ? ls : [...ls, { key: key(), productId, qty: "1", unitCost: prod.lastCost !== null ? String(prod.lastCost) : "" }]));
    setQ("");
  };
  const set = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const computed = lines.map((l) => {
    const prod = byId.get(l.productId);
    const qty = Number(l.qty) || 0;
    const cost = Number(l.unitCost) || 0;
    return { ...l, prod, total: lineTotal(qty, cost), gst: prod?.gst ?? true };
  });
  const totals = purchaseTotals(computed.map((c) => ({ lineTotal: c.total, gst: c.gst })));

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await savePurchaseOrder(o?.id ?? null, { ...head, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitCost: l.unitCost })) });
      if (!r.ok) return setError(r.error);
      router.push(`/admin/purchase-orders/${r.data?.id ?? o?.id}`);
      router.refresh();
    });

  return (
    <>
      <Link href={o ? `/admin/purchase-orders/${o.id}` : "/admin/purchase-orders"} className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {o ? o.poNumber : tr("Purchase Orders")}
      </Link>
      <h1 className="mb-4 text-xl font-semibold tracking-tight text-slate-900">{o ? tr("Edit purchase order {number}", { number: o.poNumber }) : tr("New purchase order")}</h1>
      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader title={tr("Products")} subtitle={tr("Unit costs are ex GST, as on the supplier's price list.")} />
          <div className="border-b border-line p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Add a product: search SKU or name")} className={cx(inputCls, "pl-9")} />
              {matches.length > 0 && (
                <ul className="absolute inset-x-0 top-10 z-20 overflow-hidden rounded-lg border border-line bg-white shadow-pop">
                  {matches.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => add(m.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                        <span>
                          <span className="font-medium">{m.name}</span> <span className="text-xs text-slate-500">{m.sku} · {m.packSize}</span>
                        </span>
                        <span className="flex items-center gap-2 text-xs text-slate-500">
                          {tr("{n} in stock", { n: m.stock })} <Plus className="size-3.5" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {computed.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">{tr("Search above to add the products you're ordering.")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">{tr("Product")}</th>
                    <th className="px-2 py-2 font-medium">{tr("Qty")}</th>
                    <th className="px-2 py-2 font-medium">{tr("Unit cost (ex GST)")}</th>
                    <th className="px-2 py-2 text-right font-medium">{tr("Line total")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {computed.map((l) => (
                    <tr key={l.key} className="border-t border-line">
                      <td className="px-4 py-2">
                        <p className="font-medium">{l.prod?.name ?? tr("Product no longer exists")}</p>
                        <p className="text-xs text-slate-500">
                          {l.prod?.sku} · {l.prod?.unit}
                          {l.prod && !l.prod.gst && ` · ${tr("GST free")}`}
                        </p>
                      </td>
                      <td className="px-2 py-2">
                        <input value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} inputMode="numeric" className={cx(inputCls, "w-20")} aria-label={tr("Qty")} />
                      </td>
                      <td className="px-2 py-2">
                        <input value={l.unitCost} onChange={(e) => set(l.key, { unitCost: e.target.value })} inputMode="decimal" placeholder="0.00" className={cx(inputCls, "w-28")} aria-label={tr("Unit cost (ex GST)")} />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(l.total)}</td>
                      <td className="pr-3">
                        <button type="button" className={btn("ghost", "icon")} aria-label={tr("Remove")} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                          <Trash2 className="size-4 text-slate-400" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <dl className="space-y-1 border-t border-line px-4 py-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <dt>{tr("Subtotal (ex GST)")}</dt>
              <dd className="tabular-nums">{money(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-slate-600">
              <dt>{tr("GST")}</dt>
              <dd className="tabular-nums">{money(totals.gst)}</dd>
            </div>
            <div className="flex justify-between pt-1 text-base font-semibold">
              <dt>{tr("Total (incl. GST)")}</dt>
              <dd className="tabular-nums">{money(totals.total)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="h-fit">
          <CardHeader title={tr("Order details")} />
          <div className="space-y-3 p-4">
            <Field label="Supplier" hint={o?.supplierLocked ? "The supplier can't change once the order has gone to them." : undefined}>
              <select value={head.supplierId} disabled={o?.supplierLocked} onChange={(e) => setHead({ ...head, supplierId: e.target.value })} className={inputCls}>
                <option value="">{tr("Choose…")}</option>
                {p.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            {!p.suppliers.length && (
              <p className="text-xs text-amber-700">
                {tr("No suppliers yet.")}{" "}
                <Link href="/admin/suppliers" className="font-semibold underline">
                  {tr("Add one first")}
                </Link>
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Order date">
                <input type="date" value={head.orderDate} onChange={(e) => setHead({ ...head, orderDate: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Expected delivery">
                <input type="date" value={head.expectedDate} onChange={(e) => setHead({ ...head, expectedDate: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <Field label="Supplier's reference" hint="Their quote or order confirmation number.">
              <input value={head.supplierReference} onChange={(e) => setHead({ ...head, supplierReference: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Notes">
              <textarea rows={3} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} className={`${inputCls} h-auto py-2`} />
            </Field>
            <FormError message={error} />
            <button type="button" disabled={pending} onClick={submit} className={btn("primary", "md", "w-full")}>
              {pending ? tr("Saving…") : o ? tr("Save changes") : tr("Create purchase order")}
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}
