"use client";

import { useState, useTransition } from "react";
import { setCustomerPrice } from "@/app/actions/products";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { Card, cx, inputCls, Spinner } from "@/components/ui";
import { aud } from "@/lib/money";

type Row = { id: string; sku: string; name: string; category: string; priceCents: number; unit: string; ownCents: number | null };

export function PriceList({ customerId, rows }: { customerId: string; rows: Row[] }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">Product</th>
            <th className="px-2 py-2.5 text-right font-medium">List price</th>
            <th className="px-4 py-2.5 font-medium">Customer price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <PriceRow key={r.id} customerId={customerId} row={r} onResult={setToast} />
          ))}
        </tbody>
      </table>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </Card>
  );
}

function PriceRow({ customerId, row: r, onResult }: { customerId: string; row: Row; onResult: (t: ToastMessage) => void }) {
  const initial = r.ownCents !== null ? (r.ownCents / 100).toFixed(2) : "";
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const save = () => {
    if (v === saved) return;
    start(async () => {
      const res = await setCustomerPrice(customerId, r.id, v);
      onResult({ id: Date.now(), text: res.ok ? `${r.name}: ${res.message}` : res.error, tone: res.ok ? "ok" : "warn" });
      if (res.ok) setSaved(v);
    });
  };
  const own = saved ? Math.round(Number(saved) * 100) : null;
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-2">
        <p className="font-medium text-slate-900">{r.name}</p>
        <p className="text-xs text-slate-500">
          {r.sku} · {r.category}
        </p>
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-slate-600">
        {aud(r.priceCents)} <span className="text-xs text-slate-400">/ {r.unit}</span>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <input
            value={v}
            onChange={(e) => setV(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            placeholder="List price"
            inputMode="decimal"
            className={cx(inputCls, "w-28")}
          />
          {pending && <Spinner className="text-slate-400" />}
          {own !== null && !pending && (
            <span className={cx("text-xs", own < r.priceCents ? "text-emerald-700" : "text-slate-500")}>
              {own < r.priceCents ? `${Math.round((1 - own / r.priceCents) * 100)}% off` : own > r.priceCents ? "above list" : ""}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
