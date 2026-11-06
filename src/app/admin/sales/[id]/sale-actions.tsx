"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { applyOrderCredit, cancelSale, confirmSale, deleteSales, markPaid, setFulfilment } from "@/app/actions/sales";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { btn, cx, inputCls } from "@/components/ui";
import type { FulfilmentStatus, PaymentMethod, PaymentStatus, SalesStatus } from "@/lib/db/schema";
import { FULFILMENT } from "@/lib/money";
import { useT } from "@/components/i18n";

/** Pay (part of) this unpaid order with the customer's store credit. */
export function ApplyCredit({ id, maxCents }: { id: string; maxCents: number }) {
  const tr = useT();
  const [amount, setAmount] = useState((maxCents / 100).toFixed(2));
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label={tr("Store credit to use")} className={cx(inputCls, "w-28")} />
      <button
        disabled={pending}
        className={btn("secondary", "sm")}
        onClick={() =>
          start(async () => {
            const r = await applyOrderCredit(id, amount);
            setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Done") : r.error, tone: r.ok ? "ok" : "warn" });
          })
        }
      >
        {tr("Use store credit")}
      </button>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

export function SaleActions(p: { id: string; status: SalesStatus; paymentStatus: PaymentStatus; paymentMethod: PaymentMethod; fulfilment: FulfilmentStatus; canCancel: boolean; isAdmin: boolean }) {
  const tr = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Done") : r.error, tone: r.ok ? "ok" : "warn" });
    });
  const steps: FulfilmentStatus[] = ["new", "picking", "packed", "loaded"];
  const next = steps[steps.indexOf(p.fulfilment) + 1];

  return (
    <div className="flex flex-wrap gap-2">
      {p.status === "pending" && (
        <button disabled={pending} onClick={() => run(() => confirmSale(p.id))} className={btn("primary")}>
          {tr("Confirm order")}</button>
      )}
      {p.status === "confirmed" && next && (
        <button disabled={pending} onClick={() => run(() => setFulfilment([p.id], next))} className={btn("primary")}>
          {tr("Mark")}{" "}{FULFILMENT[next].label.toLowerCase()}
        </button>
      )}
      {p.status !== "cancelled" && p.paymentMethod !== "card" && (
        <button disabled={pending} onClick={() => run(() => markPaid(p.id, p.paymentStatus !== "paid"))} className={btn(p.paymentStatus === "paid" ? "ghost" : "success")}>
          {p.paymentStatus === "paid" ? tr("Mark unpaid") : tr("Record payment")}
        </button>
      )}
      {p.canCancel && (
        <button
          disabled={pending}
          onClick={() => confirm("Cancel this order? Stock goes back on the shelf, the delivery is removed and card payments are refunded.") && run(() => cancelSale(p.id))}
          className={btn("danger")}
        >
          {tr("Cancel order")}</button>
      )}
      {p.isAdmin && (
        <button
          disabled={pending}
          className={btn("ghost", "md", "text-red-600")}
          onClick={() => {
            if (!confirm("Permanently delete this order?\n\nIts items, delivery and proof of delivery are removed and undelivered stock goes back on the shelf. Use it for test orders only.")) return;
            start(async () => {
              const r = await deleteSales([p.id]);
              if (r.ok) router.push("/admin/sales");
              else setToast({ id: Date.now(), text: r.error, tone: "warn" });
            });
          }}
        >
          {tr("Delete order")}</button>
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
