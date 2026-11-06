"use client";

import { BadgeCheck, ClipboardList, Download, Plus, Search, ShoppingBag, Trash2, X } from "lucide-react";
import Link from "@/components/link";
import { useState, useTransition } from "react";
import { deleteSales, markManyPaid, setFulfilment } from "@/app/actions/sales";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { Badge, btn, Card, cx, EmptyState, inputCls, PageHeader, Stat } from "@/components/ui";
import { toCsv } from "@/lib/product-import";
import { prettyDate } from "@/lib/dates";
import type { FulfilmentStatus, InvoiceStatus, PaymentMethod, PaymentStatus, SalesStatus } from "@/lib/db/schema";
import { aud, FULFILMENT, PAYMENT_METHOD_LABEL, PAYMENT_STATUS, SALES_STATUS } from "@/lib/money";
import type { PortalStage } from "@/lib/portal";
import { Tx, useT } from "@/components/i18n";

const DELIVERY: Record<PortalStage, { label: string; tone: "slate" | "violet" | "amber" | "green" | "red" }> = {
  received: { label: "Not planned", tone: "slate" },
  scheduled: { label: "Scheduled", tone: "violet" },
  out_for_delivery: { label: "Out for delivery", tone: "amber" },
  delivered: { label: "Delivered", tone: "green" },
  failed: { label: "Delivery failed", tone: "red" },
};

type Row = {
  id: string;
  number: string;
  customer: string;
  items: number;
  totalCents: number;
  deliveryDate: string;
  status: SalesStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  fulfilment: FulfilmentStatus;
  delivery: PortalStage | null;
  dueDate: string | null;
  invoiceStatus: InvoiceStatus;
  /** Units on this order still waiting for stock. */
  waiting: number;
};

export function SalesClient({
  rows,
  view,
  filters,
  today,
  todaySalesCents,
  unpaidCount,
  isAdmin,
}: {
  rows: Row[];
  view: string;
  filters: { q: string; from: string; to: string };
  today: string;
  todaySalesCents: number;
  unpaidCount: number;
  isAdmin: boolean;
}) {
  const tr = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const toPick = confirmed.filter((r) => r.fulfilment === "new").length;
  const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const filtered = !!(filters.q || filters.from || filters.to);
  const viewTotal = rows.filter((r) => r.status !== "cancelled").reduce((t, r) => t + r.totalCents, 0);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, clear = true) =>
    start(async () => {
      const r = await fn();
      setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Updated") : (r.error ?? "Something went wrong"), tone: r.ok ? "ok" : "warn" });
      if (r.ok && clear) setSelected(new Set());
    });

  const paymentBadge = (r: Row) => {
    const overdue = r.paymentStatus === "unpaid" && r.dueDate && r.dueDate < today;
    return <Badge tone={overdue ? "red" : PAYMENT_STATUS[r.paymentStatus].tone}>{overdue ? tr("Overdue") : tr(PAYMENT_STATUS[r.paymentStatus].label)}</Badge>;
  };

  return (
    <>
      <PageHeader
        title={tr("Sales Orders")}
        subtitle={tr("Orders from the online shop and orders entered here by staff. Confirmed orders go to the route planner automatically on their delivery day.")}
        actions={
          <>
            {rows.length > 0 && (
              <button className={btn("secondary")} onClick={() => exportCsv(rows)}>
                <Download className="size-4" /> {tr("Export CSV")}
              </button>
            )}
            <Link href={ids.length ? `/admin/sales/picklist?ids=${ids.join(",")}` : "/admin/sales/picklist"} className={btn("secondary")}>
              <ClipboardList className="size-4" /> {ids.length ? tr(`Pick list (${ids.length})`) : tr("Pick list")}
            </Link>
            <Link href="/admin/sales/new" className={btn("primary")}>
              <Plus className="size-4" /> {tr("New order")}
            </Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={tr("Sales today")} value={aud(todaySalesCents)} icon={ShoppingBag} tone="green" />
        <Stat label={tr("To pick")} value={toPick} hint={tr("Confirmed, not started in the warehouse")} tone="amber" />
        <Stat label={tr("Awaiting payment")} value={unpaidCount} hint={tr("In this view")} tone="violet" />
        <Stat label={tr("Total in view")} value={aud(viewTotal)} hint={tr("{n} orders", { n: rows.length })} />
      </div>

      <form action="/admin/sales" className="mb-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <label className="relative w-full sm:w-64">
          <span className="sr-only">{tr("Search")}</span>
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
          <input type="search" name="q" defaultValue={filters.q} placeholder={tr("Order number or customer")} className={cx(inputCls, "pl-9")} />
        </label>
        <label className="w-[calc(50%-4px)] text-xs text-slate-500 sm:w-auto">
          {tr("Delivery from")}
          <input type="date" name="from" defaultValue={filters.from} className={cx(inputCls, "mt-0.5 w-full sm:w-auto")} />
        </label>
        <label className="w-[calc(50%-4px)] text-xs text-slate-500 sm:w-auto">
          {tr("to")}
          <input type="date" name="to" defaultValue={filters.to} className={cx(inputCls, "mt-0.5 w-full sm:w-auto")} />
        </label>
        <button className={btn("secondary")}>{tr("Search")}</button>
        {filtered && (
          <Link href={`/admin/sales?view=${view}`} className={btn("ghost")}>
            <X className="size-4" /> {tr("Clear")}
          </Link>
        )}
      </form>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[
          ["open", "Open"],
          ["invoice", "To invoice"],
          ["unpaid", "Unpaid"],
          ["all", "All"],
          ["cancelled", "Cancelled"],
        ].map(([v, label]) => {
          const qs = new URLSearchParams({ view: v, ...(filters.q && { q: filters.q }), ...(filters.from && { from: filters.from }), ...(filters.to && { to: filters.to }) });
          return (
            <Link key={v} href={`/admin/sales?${qs}`} className={btn(view === v ? "primary" : "ghost", "sm")}>
              {<Tx>{label}</Tx>}
            </Link>
          );
        })}
      </div>

      {ids.length > 0 && (
        <div className="sticky top-28 z-20 mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50/95 px-3 py-2 shadow-sm backdrop-blur lg:top-2">
          <span className="mr-1 text-xs font-semibold text-blue-900">{tr("{n} selected", { n: ids.length })}</span>
          {(["picking", "packed", "loaded"] as const).map((f) => (
            <button key={f} disabled={pending} onClick={() => run(() => setFulfilment(ids, f))} className={btn("secondary", "sm")}>
              {<Tx>{FULFILMENT[f].label}</Tx>}
            </button>
          ))}
          <button disabled={pending} onClick={() => run(() => markManyPaid(ids))} className={btn("secondary", "sm")}>
            <BadgeCheck className="size-3.5" /> {tr("Mark paid")}
          </button>
          {isAdmin && (
            <button
              disabled={pending}
              className={btn("danger", "sm")}
              onClick={() => {
                if (!confirm(tr("Permanently delete {n} orders?\n\nTheir items, delivery and proof of delivery are removed and undelivered stock goes back on the shelf. Use it for test orders only. Card payments are not refunded by this.", { n: ids.length }))) return;
                run(() => deleteSales(ids));
              }}
            >
              <Trash2 className="size-3.5" /> {" "}{tr("Delete")}</button>
          )}
          <button className={cx(btn("ghost", "sm"), "ml-auto")} onClick={() => setSelected(new Set())}>
            {tr("Clear")}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={ShoppingBag} title={tr("No orders here")}>
            {filtered ? tr("Try another search or date range.") : tr("Orders placed in the online shop appear here.")}</EmptyState>
        </Card>
      ) : (
        <>
          {/* Phones: one card per order. */}
          <div className="space-y-2 md:hidden">
            <label className="flex items-center gap-2 px-1 text-xs text-slate-500">
              <input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
              {tr("Select all")} ({rows.length})
            </label>
            {rows.map((r) => (
              <Card key={r.id} className={cx("p-3", r.status === "cancelled" && "opacity-60", selected.has(r.id) && "ring-2 ring-blue-400")}>
                <div className="flex gap-3">
                  <input type="checkbox" aria-label={`Select ${r.number}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="mt-1" />
                  <Link href={`/admin/sales/${r.id}`} className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-blue-700">{r.number}</span>
                      <span className="font-semibold tabular-nums">{aud(r.totalCents)}</span>
                    </span>
                    <span className="block truncate text-sm text-slate-700">{r.customer}</span>
                    <span className="block text-xs text-slate-500">
                      <Tx>{prettyDate(r.deliveryDate, { weekday: "short", day: "numeric", month: "short" })}</Tx> · {tr(r.items === 1 ? "{n} item" : "{n} items", { n: r.items })}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone={SALES_STATUS[r.status].tone}>{<Tx>{SALES_STATUS[r.status].label}</Tx>}</Badge>
                      {paymentBadge(r)}
                      {r.status === "confirmed" && r.invoiceStatus === "proforma" && <Badge tone="amber">{tr("Proforma")}</Badge>}
                      {r.status === "confirmed" && <Badge tone={FULFILMENT[r.fulfilment].tone}>{<Tx>{FULFILMENT[r.fulfilment].label}</Tx>}</Badge>}
                      {r.delivery && <Badge tone={DELIVERY[r.delivery].tone}>{<Tx>{DELIVERY[r.delivery].label}</Tx>}</Badge>}
                      {r.waiting > 0 && r.status !== "cancelled" && <Badge tone="red">{tr("{n} waiting for stock", { n: r.waiting })}</Badge>}
                    </span>
                  </Link>
                </div>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input type="checkbox" aria-label={tr("Select all")} checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
                  </th>
                  <th className="px-2 py-2.5 font-medium">{tr("Order")}</th>
                  <th className="px-2 py-2.5 font-medium">{tr("Delivery day")}</th>
                  <th className="px-2 py-2.5 font-medium">{tr("Status")}</th>
                  <th className="px-2 py-2.5 font-medium">{tr("Payment")}</th>
                  <th className="px-2 py-2.5 font-medium">{tr("Warehouse")}</th>
                  <th className="px-2 py-2.5 font-medium">{tr("Delivery")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{tr("Total")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={cx("border-b border-line last:border-0 hover:bg-slate-50/60", r.status === "cancelled" && "opacity-60", selected.has(r.id) && "bg-blue-50/50")}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" aria-label={`Select ${r.number}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="px-2 py-2.5">
                      <Link href={`/admin/sales/${r.id}`} className="font-semibold text-blue-700 hover:underline">
                        {r.number}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {r.customer} · {tr(r.items === 1 ? "{n} item" : "{n} items", { n: r.items })}
                      </p>
                      {r.waiting > 0 && r.status !== "cancelled" && <Badge tone="red" className="mt-1">{tr("{n} waiting for stock", { n: r.waiting })}</Badge>}
                    </td>
                    <td className={cx("px-2 py-2.5", r.deliveryDate === today && "font-semibold")}>{<Tx>{prettyDate(r.deliveryDate, { weekday: "short", day: "numeric", month: "short" })}</Tx>}</td>
                    <td className="px-2 py-2.5">
                      <Badge tone={SALES_STATUS[r.status].tone}>{<Tx>{SALES_STATUS[r.status].label}</Tx>}</Badge>
                    </td>
                    <td className="px-2 py-2.5">
                      {paymentBadge(r)}
                      {r.status === "confirmed" && r.invoiceStatus === "proforma" && <Badge tone="amber" className="ml-1">{tr("Proforma")}</Badge>}
                      <p className="mt-0.5 text-[11px] text-slate-400">{tr(PAYMENT_METHOD_LABEL[r.paymentMethod])}</p>
                    </td>
                    <td className="px-2 py-2.5">{r.status === "confirmed" ? <Badge tone={FULFILMENT[r.fulfilment].tone}>{<Tx>{FULFILMENT[r.fulfilment].label}</Tx>}</Badge> : "—"}</td>
                    <td className="px-2 py-2.5">{r.delivery ? <Badge tone={DELIVERY[r.delivery].tone}>{<Tx>{DELIVERY[r.delivery].label}</Tx>}</Badge> : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">{aud(r.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

function exportCsv(rows: Row[]) {
  const csv = toCsv([
    ["Order", "Customer", "Delivery date", "Status", "Payment", "Payment method", "Due", "Warehouse", "Items", "Total (AUD)"],
    ...rows.map((r) => [
      r.number,
      r.customer,
      r.deliveryDate,
      SALES_STATUS[r.status].label,
      PAYMENT_STATUS[r.paymentStatus].label,
      PAYMENT_METHOD_LABEL[r.paymentMethod],
      r.dueDate ?? "",
      FULFILMENT[r.fulfilment].label,
      r.items,
      (r.totalCents / 100).toFixed(2),
    ]),
  ]);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  Object.assign(document.createElement("a"), { href: url, download: `foodpac-sales-${new Date().toISOString().slice(0, 10)}.csv` }).click();
  URL.revokeObjectURL(url);
}
