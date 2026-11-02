import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { prettyDate } from "@/lib/dates";
import { aud } from "@/lib/money";
import { OrderPill, PaymentPill } from "../badges";
import { StageBadge } from "../stage";
import type { listSalesOrders } from "./data";
import { T, Tx } from "@/components/i18n";

export function SalesOrderList({ rows }: { rows: Awaited<ReturnType<typeof listSalesOrders>> }) {
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-leaf-950/10 bg-white">
      {rows.map((o) => (
        <Link key={o.id} href={`/portal/orders/${o.id}`} className="group flex items-center gap-3 border-b border-leaf-950/5 px-4 py-3.5 last:border-0 hover:bg-leaf-50/50">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {o.number} <span className="font-normal text-leaf-900/50">· <T vars={{ n: o.items }}>{o.items === 1 ? "{n} item" : "{n} items"}</T></span>
            </p>
            <p className="text-xs text-leaf-900/60"><T>{"Delivery"}</T>{" "}{<Tx>{prettyDate(o.deliveryDate)}</Tx>}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <OrderPill s={o.status} />
              {o.status !== "cancelled" && <PaymentPill s={o.paymentStatus} />}
              {o.delivery && <StageBadge stage={o.delivery.stage} />}
            </div>
          </div>
          <p className="font-display font-semibold tabular-nums">{aud(o.totalCents)}</p>
          <ChevronRight className="size-4 text-leaf-900/30" />
        </Link>
      ))}
    </div>
  );
}
