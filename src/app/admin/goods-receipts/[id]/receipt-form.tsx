"use client";

import { PackageCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removeDraftReceipt, saveReceipt } from "@/app/actions/purchasing";
import { FormError, Toast, type ToastMessage } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { btn, Card, CardHeader, cx, Field, inputCls } from "@/components/ui";
import { qtyText } from "@/lib/purchasing/labels";

type Line = { id: string; sku: string; name: string; unit: string; receivedQty: number; notes: string | null; expected: number };

/** The warehouse counts what actually arrived, then puts it into stock. */
export function ReceiptForm(p: { id: string; receiptDate: string; deliveryReference: string | null; notes: string | null; lines: Line[] }) {
  const tr = useT();
  const router = useRouter();
  const [head, setHead] = useState({ receiptDate: p.receiptDate, deliveryReference: p.deliveryReference ?? "", notes: p.notes ?? "" });
  const [lines, setLines] = useState(() => p.lines.map((l) => ({ id: l.id, receivedQty: String(l.receivedQty), notes: l.notes ?? "" })));
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [pending, start] = useTransition();

  const run = (post: boolean) => {
    if (post && !confirm(tr("Put these goods into stock? The receipt is locked afterwards."))) return;
    start(async () => {
      setError(null);
      const r = await saveReceipt(p.id, { ...head, lines }, { post });
      if (!r.ok) return setError(r.error);
      setToast({ id: Date.now(), text: r.message ?? "Saved", tone: "ok" });
      router.refresh();
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <Card className="overflow-x-auto">
        <CardHeader title={tr("What arrived")} subtitle={tr("Count each product. Enter 0 for anything that didn't come or was refused at the door.")} />
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">{tr("Product")}</th>
              <th className="px-2 py-2 text-right font-medium">{tr("Expected")}</th>
              <th className="px-2 py-2 font-medium">{tr("Received")}</th>
              <th className="px-4 py-2 font-medium">{tr("Note")}</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l, i) => {
              const v = lines[i];
              const n = Number(v.receivedQty);
              return (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-slate-500">{l.sku} · {l.unit}</p>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">{qtyText(l.expected)}</td>
                  <td className="px-2 py-2">
                    <input
                      value={v.receivedQty}
                      inputMode="numeric"
                      aria-label={tr("Received")}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, receivedQty: e.target.value } : x)))}
                      className={cx(inputCls, "w-20", n !== l.expected && "border-amber-400 bg-amber-50")}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input value={v.notes} placeholder={tr("e.g. 2 cartons crushed")} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} className={inputCls} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card className="h-fit">
        <CardHeader title={tr("Delivery")} />
        <div className="space-y-3 p-4">
          <Field label="Date it arrived">
            <input type="date" value={head.receiptDate} onChange={(e) => setHead({ ...head, receiptDate: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Delivery note number">
            <input value={head.deliveryReference} onChange={(e) => setHead({ ...head, deliveryReference: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Notes">
            <textarea rows={3} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} className={`${inputCls} h-auto py-2`} />
          </Field>
          <FormError message={error} />
          <button type="button" disabled={pending} onClick={() => run(true)} className={btn("success", "md", "w-full")}>
            <PackageCheck className="size-4" /> {tr("Put into stock")}
          </button>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => run(false)} className={btn("secondary", "md", "flex-1")}>
              {tr("Save, finish later")}
            </button>
            <button
              type="button"
              disabled={pending}
              className={btn("ghost", "md", "text-red-600")}
              onClick={() =>
                confirm(tr("Delete this goods receipt? Nothing has gone into stock yet.")) &&
                start(async () => {
                  const r = await removeDraftReceipt(p.id);
                  if (!r.ok) return setError(r.error);
                  router.push("/admin/goods-receipts");
                })
              }
            >
              <Trash2 className="size-4" /> {tr("Delete")}
            </button>
          </div>
          <p className="text-xs text-slate-500">{tr("Stock only changes when you choose Put into stock. Customers waiting for these products get them first.")}</p>
        </div>
      </Card>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
