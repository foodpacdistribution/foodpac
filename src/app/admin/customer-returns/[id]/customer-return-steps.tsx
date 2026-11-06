"use client";

import { PackageCheck, ShoppingBag, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelReturnForCustomer, checkInCustomerReturn, completeReturnForCustomer } from "@/app/actions/customer-returns";
import { FormError, Toast, type ToastMessage } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { ActionButton } from "@/components/purchasing-ui";
import { btn, Card, CardHeader, cx, Field, inputCls } from "@/components/ui";
import { REFUND_METHOD, RETURNED_CONDITION } from "@/lib/customer-return-labels";
import type { CustomerRefundMethod, CustomerReturnResolution, CustomerReturnStatus, ReturnedCondition } from "@/lib/db/schema";
import { money, qtyText } from "@/lib/purchasing/labels";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error);
      setToast({ id: Date.now(), text: r.message ?? "Saved", tone: "ok" });
      router.refresh();
    });
  return { pending, error, toast, setToast, run };
}

/** Step 2: what actually came back, and whether each product can be sold again. */
export function CheckInForm({ id, lines }: { id: string; lines: { id: string; sku: string; name: string; unit: string; qty: number }[] }) {
  const tr = useT();
  const { pending, error, toast, setToast, run } = useRun();
  const [rows, setRows] = useState(() => Object.fromEntries(lines.map((l) => [l.id, { receivedQty: String(l.qty), condition: "restock" as ReturnedCondition }])));
  return (
    <Card>
      <CardHeader title={tr("Check the goods in")} subtitle={tr("Only goods marked Back on the shelf go into stock. Damaged or written-off goods are recorded but can't be sold.")} />
      <div className="space-y-3 p-4">
        <table className="w-full text-sm">
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="py-2">
                  <p className="font-medium">{l.name}</p>
                  <p className="text-xs text-slate-500">{l.sku} · {tr("{n} coming back", { n: qtyText(l.qty) })}</p>
                </td>
                <td className="py-2 pl-2">
                  <input value={rows[l.id].receivedQty} inputMode="numeric" aria-label={tr("Received")} onChange={(e) => setRows({ ...rows, [l.id]: { ...rows[l.id], receivedQty: e.target.value } })} className={cx(inputCls, "w-20")} />
                </td>
                <td className="py-2 pl-2">
                  <select value={rows[l.id].condition} aria-label={tr("Condition")} onChange={(e) => setRows({ ...rows, [l.id]: { ...rows[l.id], condition: e.target.value as ReturnedCondition } })} className={inputCls}>
                    {Object.entries(RETURNED_CONDITION).map(([k, v]) => (
                      <option key={k} value={k}>{tr(v)}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <FormError message={error} />
        <button type="button" disabled={pending} className={btn("primary")} onClick={() => run(() => checkInCustomerReturn(id, lines.map((l) => ({ id: l.id, ...rows[l.id] }))))}>
          <PackageCheck className="size-4" /> {tr("Goods checked in")}
        </button>
      </div>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </Card>
  );
}

/** Step 3: give the customer their money back, or their store credit. */
export function CompleteForm({ id, resolution, total, paidByCard }: { id: string; resolution: CustomerReturnResolution; total: number; paidByCard: boolean }) {
  const tr = useT();
  const { pending, error, toast, setToast, run } = useRun();
  const [method, setMethod] = useState<CustomerRefundMethod>(paidByCard ? "card" : "bank_transfer");
  const [reference, setReference] = useState("");
  return (
    <Card className="border-emerald-200">
      <CardHeader title={resolution === "refund" ? tr("Refund the customer") : tr("Give store credit")} />
      <div className="space-y-3 p-4">
        {resolution === "refund" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Refunded by">
              <select value={method} onChange={(e) => setMethod(e.target.value as CustomerRefundMethod)} className={inputCls}>
                {Object.entries(REFUND_METHOD).map(([k, v]) => (
                  <option key={k} value={k}>{tr(v)}</option>
                ))}
              </select>
            </Field>
            <Field label="Reference" hint={method === "card" ? "Card orders are refunded through Stripe automatically." : "Bank reference or receipt number."}>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} />
            </Field>
          </div>
        ) : (
          <p className="text-sm text-slate-600">{tr("{amount} goes onto the customer's store credit, with a record of where it came from.", { amount: money(total) })}</p>
        )}
        <FormError message={error} />
        <button
          type="button"
          disabled={pending}
          className={btn("success")}
          onClick={() =>
            confirm(resolution === "refund" ? tr("Refund {amount} to the customer?", { amount: money(total) }) : tr("Add {amount} store credit?", { amount: money(total) })) &&
            run(() => completeReturnForCustomer(id, resolution === "refund" ? { method, reference } : undefined))
          }
        >
          {resolution === "refund" ? tr("Refund {amount}", { amount: money(total) }) : tr("Add {amount} store credit", { amount: money(total) })}
        </button>
      </div>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </Card>
  );
}

export function CustomerReturnButtons({ id, status, resolution, customerId, exchangeOrder }: { id: string; status: CustomerReturnStatus; resolution: CustomerReturnResolution; customerId: string; exchangeOrder: { id: string; number: string } | null }) {
  const tr = useT();
  return (
    <div className="flex flex-wrap gap-2">
      {status === "completed" && resolution === "exchange" &&
        (exchangeOrder ? (
          <Link href={`/admin/sales/${exchangeOrder.id}`} className={btn("secondary")}>
            <ShoppingBag className="size-4" /> {tr("Exchange order {number}", { number: exchangeOrder.number })}
          </Link>
        ) : (
          <Link href={`/admin/sales/new?customer=${customerId}&exchange=${id}`} className={btn("primary")}>
            <ShoppingBag className="size-4" /> {tr("Create exchange order")}
          </Link>
        ))}
      {status === "requested" && (
        <ActionButton run={() => cancelReturnForCustomer(id)} variant="danger" confirmText="Cancel this return? Nothing has come back yet, so stock and credit don't change.">
          <XCircle className="size-4" /> {tr("Cancel return")}
        </ActionButton>
      )}
    </div>
  );
}
