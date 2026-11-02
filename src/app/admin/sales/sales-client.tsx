"use client";

import { ClipboardList, ShoppingBag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteSales, setFulfilment } from "@/app/actions/sales";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { Badge, btn, Card, cx, EmptyState, PageHeader, Stat } from "@/components/ui";
import { prettyDate } from "@/lib/dates";
import type { FulfilmentStatus, PaymentMethod, PaymentStatus, SalesStatus } from "@/lib/db/schema";
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
};

export function SalesClient({ rows, view, today, todaySalesCents, unpaidCount, isAdmin }: { rows: Row[]; view: string; today: string; todaySalesCents: number; unpaidCount: number; isAdmin: boolean }) {
  const tr = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const router = useRouter();
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const toPick = confirmed.filter((r) => r.fulfilment === "new").length;
  const ids = [...selected];

  const bulk = (status: FulfilmentStatus) =>
    start(async () => {
      const r = await setFulfilment(ids, status);
      setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Updated") : r.error, tone: r.ok ? "ok" : "warn" });
      if (r.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });

  return (
    <>
      <PageHeader
        title={tr("Sales Orders")}
        subtitle={tr("Orders from the online shop. Confirmed orders go to the route planner automatically on their delivery day.")}
        actions={
          <Link href={`/admin/sales/picklist?${ids.length ? `ids=${ids.join(",")}` : `date=${today}`}`} className={btn("secondary")}>
            <ClipboardList className="size-4" /> {ids.length ? tr(`Pick list (${ids.length})`) : tr("Today's pick list")}
          </Link>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={tr("Sales today")} value={aud(todaySalesCents)} icon={ShoppingBag} tone="green" />
        <Stat label={tr("To pick")} value={toPick} hint={tr("Confirmed, not started in the warehouse")} tone="amber" />
        <Stat label={tr("Awaiting payment")} value={unpaidCount} hint={tr("In this view")} tone="violet" />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[
          ["open", "Open"],
          ["unpaid", "Unpaid"],
          ["all", "All"],
          ["cancelled", "Cancelled"],
        ].map(([v, label]) => (
          <Link key={v} href={`/admin/sales?view=${v}`} className={btn(view === v ? "primary" : "ghost", "sm")}>
            {<Tx>{label}</Tx>}
          </Link>
        ))}
        {ids.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500">{ids.length} {" "}{tr("selected:")}</span>
            {(["picking", "packed", "loaded"] as const).map((f) => (
              <button key={f} disabled={pending} onClick={() => bulk(f)} className={btn("secondary", "sm")}>
                {<Tx>{FULFILMENT[f].label}</Tx>}
              </button>
            ))}
            {isAdmin && (
              <button
                disabled={pending}
                className={btn("danger", "sm")}
                onClick={() => {
                  if (!confirm(`Permanently delete ${ids.length} order${ids.length === 1 ? "" : "s"}?\n\nTheir items, delivery and proof of delivery are removed and undelivered stock goes back on the shelf. Use it for test orders only. Card payments are not refunded by this.`)) return;
                  start(async () => {
                    const r = await deleteSales(ids);
                    setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Deleted") : r.error, tone: r.ok ? "ok" : "warn" });
                    if (r.ok) {
                      setSelected(new Set());
                      router.refresh();
                    }
                  });
                }}
              >
                <Trash2 className="size-3.5" /> {" "}{tr("Delete")}</button>
            )}
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={ShoppingBag} title={tr("No orders here")}>
            {tr("Orders placed in the online shop appear here.")}</EmptyState>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={tr("Select all")}
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </th>
                <th className="px-2 py-2.5 font-medium">{tr("Order")}</th>
                <th className="px-2 py-2.5 font-medium">{tr("Delivery day")}</th>
                <th className="px-2 py-2.5 font-medium">{tr("Order")}</th>
                <th className="px-2 py-2.5 font-medium">{tr("Payment")}</th>
                <th className="px-2 py-2.5 font-medium">{tr("Warehouse")}</th>
                <th className="px-2 py-2.5 font-medium">{tr("Delivery")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{tr("Total")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={cx("border-b border-line last:border-0 hover:bg-slate-50/60", r.status === "cancelled" && "opacity-60")}>
                  <td className="px-3 py-2.5">
                    <input type="checkbox" aria-label={`Select ${r.number}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td className="px-2 py-2.5">
                    <Link href={`/admin/sales/${r.id}`} className="font-semibold text-blue-700 hover:underline">
                      {r.number}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {r.customer} · {r.items} {" "}{tr("item")}{r.items === 1 ? "" : "s"}
                    </p>
                  </td>
                  <td className={cx("px-2 py-2.5", r.deliveryDate === today && "font-semibold")}>{<Tx>{prettyDate(r.deliveryDate, { weekday: "short", day: "numeric", month: "short" })}</Tx>}</td>
                  <td className="px-2 py-2.5">
                    <Badge tone={SALES_STATUS[r.status].tone}>{<Tx>{SALES_STATUS[r.status].label}</Tx>}</Badge>
                  </td>
                  <td className="px-2 py-2.5">
                    <Badge tone={r.paymentStatus === "unpaid" && r.dueDate && r.dueDate < today ? "red" : PAYMENT_STATUS[r.paymentStatus].tone}>
                      {r.paymentStatus === "unpaid" && r.dueDate && r.dueDate < today ? tr("Overdue") : PAYMENT_STATUS[r.paymentStatus].label}
                    </Badge>
                    <p className="mt-0.5 text-[11px] text-slate-400">{PAYMENT_METHOD_LABEL[r.paymentMethod]}</p>
                  </td>
                  <td className="px-2 py-2.5">{r.status === "confirmed" ? <Badge tone={FULFILMENT[r.fulfilment].tone}>{<Tx>{FULFILMENT[r.fulfilment].label}</Tx>}</Badge> : "—"}</td>
                  <td className="px-2 py-2.5">{r.delivery ? <Badge tone={DELIVERY[r.delivery].tone}>{<Tx>{DELIVERY[r.delivery].label}</Tx>}</Badge> : "—"}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{aud(r.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}
