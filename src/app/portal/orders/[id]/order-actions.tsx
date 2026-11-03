"use client";

import { CreditCard, RotateCcw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelMyOrder, payPendingOrder, reorder } from "@/app/actions/shop";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { Spinner } from "@/components/ui";
import { useT } from "@/components/i18n";

export function OrderActions({ id, canCancel, canPay }: { id: string; canCancel: boolean; canPay: boolean }) {
  const tr = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, then?: () => void) =>
    start(async () => {
      const r = await fn();
      setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Done") : r.error, tone: r.ok ? "ok" : "warn" });
      if (r.ok) then?.();
    });
  const btn = "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-50";
  return (
    <div className="flex flex-wrap gap-2">
      {canPay && (
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await payPendingOrder(id);
              if (r.ok && r.data) window.location.href = r.data.redirect;
              else if (!r.ok) setToast({ id: Date.now(), text: r.error, tone: "warn" });
            })
          }
          className={`${btn} bg-tomato text-white hover:bg-tomato-dark`}
        >
          <CreditCard className="size-4" /> {" "}{tr("Pay now")}</button>
      )}
      <button disabled={pending} onClick={() => run(() => reorder(id), () => router.push("/cart"))} className={`${btn} bg-leaf-700 text-white hover:bg-leaf-800`}>
        {pending ? <Spinner className="size-3.5" /> : <RotateCcw className="size-4" />} {" "}{tr("Buy again")}</button>
      {canCancel && (
        <button
          disabled={pending}
          onClick={() => confirm("Cancel this order? Any card payment will be refunded.") && run(() => cancelMyOrder(id))}
          className={`${btn} border border-red-200 bg-white text-red-700 hover:bg-red-50`}
        >
          <XCircle className="size-4" /> {" "}{tr("Cancel order")}</button>
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
