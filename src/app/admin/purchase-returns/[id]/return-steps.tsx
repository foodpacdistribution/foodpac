"use client";

import { PackagePlus, Truck, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { finishReturn, receiveGoods, saveSupplierResponse, sendReturnToSupplier } from "@/app/actions/purchasing";
import { FormError, Toast, type ToastMessage } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { ActionButton } from "@/components/purchasing-ui";
import { btn, Card, CardHeader, cx, Field, inputCls } from "@/components/ui";
import type { PurchaseReturnStatus, ReturnResolution } from "@/lib/db/schema";
import { qtyText, RESOLUTION_LABEL } from "@/lib/purchasing/labels";

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

/** Step 2: what the supplier said, line by line, and whether they'll refund or exchange. */
export function SupplierResponseForm(p: { id: string; answered: boolean; response: string | null; resolution: ReturnResolution | null; lines: { id: string; sku: string; name: string; requested: number; accepted: number | null }[] }) {
  const tr = useT();
  const { pending, error, toast, setToast, run } = useRun();
  const [acc, setAcc] = useState<Record<string, string>>(() => Object.fromEntries(p.lines.map((l) => [l.id, String(l.accepted ?? l.requested)])));
  const [response, setResponse] = useState(p.response ?? "");
  const [resolution, setResolution] = useState<string>(p.resolution ?? "refund");
  const total = p.lines.reduce((t, l) => t + (Number(acc[l.id]) || 0), 0);
  const save = () => run(() => saveSupplierResponse(p.id, { lines: p.lines.map((l) => ({ id: l.id, acceptedQty: acc[l.id] ?? "0" })), response, resolution }));
  return (
    <Card>
      <CardHeader title={tr(p.answered ? "Supplier's answer (can be corrected until the goods go out)" : "Record the supplier's answer")} />
      <div className="space-y-3 p-4">
        <table className="w-full text-sm">
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="py-2">
                  <p className="font-medium">{l.name}</p>
                  <p className="text-xs text-slate-500">{l.sku} · {tr("{n} asked for", { n: qtyText(l.requested) })}</p>
                </td>
                <td className="py-2 text-right">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-500">
                    {tr("Accepted")}
                    <input value={acc[l.id]} inputMode="numeric" onChange={(e) => setAcc({ ...acc, [l.id]: e.target.value })} className={cx(inputCls, "w-20", Number(acc[l.id]) > l.requested && "border-red-400 bg-red-50")} />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {total > 0 && (
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-slate-600">{tr("The supplier will")}</legend>
            <div className="flex flex-wrap gap-2">
              {(["refund", "exchange"] as const).map((m) => (
                <label key={m} className={cx("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", resolution === m ? "border-blue-500 bg-blue-50" : "border-line")}>
                  <input type="radio" name="resolution" checked={resolution === m} onChange={() => setResolution(m)} /> {tr(RESOLUTION_LABEL[m])}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Field label="What the supplier said">
          <textarea rows={2} value={response} onChange={(e) => setResponse(e.target.value)} placeholder={tr("e.g. accepted by email from Sam, 6 Nov")} className={`${inputCls} h-auto py-2`} />
        </Field>
        <FormError message={error} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} onClick={save} className={btn("primary")}>
            {total === 0 ? tr("Supplier rejected the return") : tr("Save supplier's answer")}
          </button>
          <span className="text-xs text-slate-500">{total === 0 ? tr("Rejected: the return closes and stock stays as it is.") : tr("Stock doesn't change until the goods are sent back.")}</span>
        </div>
      </div>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </Card>
  );
}

/** Step 3: the accepted goods leave the warehouse. This is where stock goes down. */
export function DispatchForm(p: { id: string; lines: { id: string; sku: string; name: string; unit: string; accepted: number }[] }) {
  const tr = useT();
  const { pending, error, toast, setToast, run } = useRun();
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(p.lines.map((l) => [l.id, String(l.accepted)])));
  return (
    <Card className="border-violet-200">
      <CardHeader title={tr("Send the goods back")} subtitle={tr("Only what the supplier accepted can go. Stock goes down when you confirm.")} />
      <div className="space-y-3 p-4">
        <table className="w-full text-sm">
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="py-2">
                  <p className="font-medium">{l.name}</p>
                  <p className="text-xs text-slate-500">{l.sku} · {tr("{n} accepted", { n: qtyText(l.accepted) })}</p>
                </td>
                <td className="py-2 text-right">
                  <input value={qty[l.id]} inputMode="numeric" aria-label={tr("Sending")} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} className={cx(inputCls, "w-20", Number(qty[l.id]) > l.accepted && "border-red-400 bg-red-50")} />{" "}
                  <span className="text-xs text-slate-500">{l.unit}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <FormError message={error} />
        <button
          type="button"
          disabled={pending}
          className={btn("primary")}
          onClick={() => confirm(tr("Send these goods back to the supplier? They come off stock now.")) && run(() => sendReturnToSupplier(p.id, p.lines.map((l) => ({ id: l.id, qty: qty[l.id] ?? "0" }))))}
        >
          <Truck className="size-4" /> {tr("Goods sent back")}
        </button>
      </div>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </Card>
  );
}

export function ReturnButtons({ id, status, refundMethod, today, draftReplacement }: { id: string; status: PurchaseReturnStatus; refundMethod: ReturnResolution | null; today: string; draftReplacement: string | null }) {
  const tr = useT();
  return (
    <div className="flex flex-wrap gap-2">
      {status === "dispatched" && refundMethod === "exchange" &&
        (draftReplacement ? (
          <Link href={`/admin/goods-receipts/${draftReplacement}`} className={btn("success")}>
            <PackagePlus className="size-4" /> {tr("Continue checking replacements in")}
          </Link>
        ) : (
          <ActionButton run={() => receiveGoods({ returnId: id }, today)} variant="success" goTo={(g) => `/admin/goods-receipts/${g}`}>
            <PackagePlus className="size-4" /> {tr("Receive replacements")}
          </ActionButton>
        ))}
      {status === "dispatched" && (
        <ActionButton run={() => finishReturn(id, "close")} confirmText="Close this return as settled? Use this when the supplier has settled it some other way (e.g. a lower refund).">
          {tr("Close as settled")}
        </ActionButton>
      )}
      {status === "open" && (
        <ActionButton run={() => finishReturn(id, "cancel")} variant="danger" confirmText="Cancel this return request? Nothing has left the warehouse, so stock doesn't change.">
          <XCircle className="size-4" /> {tr("Cancel request")}
        </ActionButton>
      )}
    </div>
  );
}
