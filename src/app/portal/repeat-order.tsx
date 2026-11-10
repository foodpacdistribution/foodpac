"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reorder } from "@/app/actions/shop";
import { Toast, type ToastMessage } from "@/components/client-ui";
import Link from "@/components/link";
import { cx, Spinner } from "@/components/ui";
import { Tx, useT } from "@/components/i18n";
import { aud } from "@/lib/money";

/** "Order the same again": the latest order back in the cart in one tap (still-available products). */
export function RepeatOrder({
  order,
  className,
}: {
  order: { id: string; number: string; date: string; products: number; totalCents: number };
  className?: string;
}) {
  const tr = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  return (
    <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-3 rounded-3xl border border-leaf-950/10 bg-white p-4 sm:p-5", className)}>
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-leaf-100 text-leaf-800">
        <RotateCcw className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{tr("Same as last time?")}</p>
        <p className="text-sm text-leaf-900/60">
          <Link href={`/portal/orders/${order.id}`} className="underline-offset-2 hover:underline">
            {order.number}
          </Link>{" "}
          · <Tx>{order.date}</Tx> · {tr(order.products === 1 ? "{n} product" : "{n} products", { n: order.products })} · {aud(order.totalCents)}
        </p>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reorder(order.id);
            if (!r.ok) return setToast({ id: Date.now(), text: r.error, tone: "warn" });
            router.push("/cart");
            router.refresh();
          })
        }
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-leaf-700 px-5 text-sm font-semibold text-white hover:bg-leaf-800 disabled:opacity-50 sm:w-auto"
      >
        {pending ? <Spinner className="size-4" /> : <RotateCcw className="size-4" />}
        {tr("Order the same again")}
      </button>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
