"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createReturnForCustomer } from "@/app/actions/customer-returns";
import { FormError } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { btn, Card, CardHeader, cx, Field, inputCls } from "@/components/ui";
import { CUSTOMER_RESOLUTION, CUSTOMER_RETURN_REASON } from "@/lib/customer-return-labels";
import type { CustomerReturnResolution } from "@/lib/db/schema";
import { aud } from "@/lib/money";
import { lineTotal, purchaseTotals, toCents } from "@/lib/purchasing/labels";

type Line = { id: string; sku: string; name: string; unit: string; qty: number; already: number; returnable: number; unitPriceCents: number; gst: boolean };

export function CustomerReturnForm({ salesOrderId, paid, lines }: { salesOrderId: string; paid: boolean; lines: Line[] }) {
  const tr = useT();
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [resolution, setResolution] = useState<CustomerReturnResolution>("credit");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = lines.map((l) => ({ l, n: Math.max(0, Math.round(Number(qty[l.id]) || 0)) })).filter((x) => x.n > 0);
  const value = purchaseTotals(chosen.map(({ l, n }) => ({ lineTotal: lineTotal(n, l.unitPriceCents / 100), gst: l.gst })));

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await createReturnForCustomer({ salesOrderId, reason, resolution, notes, lines: lines.map((l) => ({ salesOrderItemId: l.id, qty: qty[l.id] ?? "0" })) });
      if (!r.ok) return setError(r.error);
      router.push(`/admin/customer-returns/${r.data!.id}`);
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <Card className="overflow-x-auto">
        <CardHeader title={tr("What's coming back")} />
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">{tr("Product")}</th>
              <th className="px-2 py-2 text-right font-medium">{tr("Bought")}</th>
              <th className="px-2 py-2 text-right font-medium">{tr("Already returned")}</th>
              <th className="px-2 py-2 font-medium">{tr("Returning now")}</th>
              <th className="px-4 py-2 text-right font-medium">{tr("Price paid")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const over = Number(qty[l.id] ?? 0) > l.returnable;
              return (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-slate-500">{l.sku}{!l.gst && ` · ${tr("GST free")}`}</p>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{l.qty} {l.unit}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">{l.already || "—"}</td>
                  <td className="px-2 py-2">
                    <input value={qty[l.id] ?? ""} placeholder="0" disabled={!l.returnable} inputMode="numeric" aria-label={tr("Returning now")} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} className={cx(inputCls, "w-20", over && "border-red-400 bg-red-50")} />
                    {over && <p className="mt-0.5 text-[11px] text-red-600">{tr("Max {n}", { n: l.returnable })}</p>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{aud(l.unitPriceCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <dl className="space-y-1 border-t border-line px-4 py-3 text-sm">
          <div className="flex justify-between text-slate-600"><dt>{tr("Goods (ex GST)")}</dt><dd className="tabular-nums">{aud(toCents(value.subtotal))}</dd></div>
          <div className="flex justify-between text-slate-600"><dt>{tr("GST")}</dt><dd className="tabular-nums">{aud(toCents(value.gst))}</dd></div>
          <div className="flex justify-between pt-1 text-base font-semibold"><dt>{tr("Back to the customer")}</dt><dd className="tabular-nums">{aud(toCents(value.total))}</dd></div>
          <p className="text-xs text-slate-500">{tr("Delivery isn't refunded.")}</p>
        </dl>
      </Card>
      <Card className="h-fit">
        <CardHeader title={tr("Return")} />
        <div className="space-y-3 p-4">
          <Field label="Reason">
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
              <option value="" disabled>{tr("Choose…")}</option>
              {Object.entries(CUSTOMER_RETURN_REASON).map(([k, v]) => (
                <option key={k} value={k}>{tr(v)}</option>
              ))}
            </select>
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-slate-600">{tr("The customer gets")}</legend>
            {(Object.keys(CUSTOMER_RESOLUTION) as CustomerReturnResolution[]).map((k) => {
              const off = k === "refund" && !paid;
              return (
                <label key={k} className={cx("flex cursor-pointer gap-2 rounded-lg border p-2.5 text-sm", resolution === k ? "border-blue-500 bg-blue-50" : "border-line", off && "cursor-not-allowed opacity-50")}>
                  <input type="radio" name="resolution" disabled={off} checked={resolution === k} onChange={() => setResolution(k)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{tr(CUSTOMER_RESOLUTION[k].label)}</span>
                    <span className="block text-xs text-slate-500">{off ? tr("Not paid yet: give store credit and apply it to the order instead.") : tr(CUSTOMER_RESOLUTION[k].hint)}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <Field label="Notes">
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} h-auto py-2`} />
          </Field>
          <FormError message={error} />
          <button type="button" disabled={pending || !chosen.length || !reason} onClick={submit} className={btn("primary", "md", "w-full")}>
            {pending ? tr("Saving…") : tr("Create return")}
          </button>
          <p className="text-xs text-slate-500">{tr("Next: check the goods in when they arrive. Nothing goes back on the shelf until then.")}</p>
        </div>
      </Card>
    </div>
  );
}
