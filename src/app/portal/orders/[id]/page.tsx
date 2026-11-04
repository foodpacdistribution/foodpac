import { and, eq } from "drizzle-orm";
import { ArrowLeft, FileText, MapPin, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { salesOrderItems, salesOrders } from "@/lib/db/schema";
import { aud, PAYMENT_METHOD_LABEL } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { deliveryStatuses } from "@/lib/portal";
import { stripeEnabled } from "@/lib/stripe";
import { formatMinutesClock } from "@/lib/time";
import { OrderPill, PaymentPill, Pill, POD_LABEL, WarehousePill } from "../../badges";
import { StageBadge, StageSteps } from "../../stage";
import { OrderActions } from "./order-actions";
import { T, Tx } from "@/components/i18n";

export const metadata: Metadata = { title: "Order" };

export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["customer"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !user.customerId) notFound();
  const db = await getDb();
  const [so] = await db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.id, id), eq(salesOrders.customerId, user.customerId)))
    .limit(1);
  if (!so) notFound();
  const [items, s, delivery] = await Promise.all([
    db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id)),
    getSettings(db),
    deliveryStatuses(db, so.deliveryOrderId ? [so.deliveryOrderId] : []),
  ]);
  const d = so.deliveryOrderId ? delivery.get(so.deliveryOrderId) : null;
  const canCancel = so.status !== "cancelled" && so.fulfilment === "new" && (!d || d.stage === "received" || d.stage === "scheduled");
  const placed = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" }).format(so.createdAt);

  return (
    <>
      <Link href="/portal/orders" className="inline-flex items-center gap-1.5 text-sm text-leaf-900/60 hover:text-leaf-900">
        <ArrowLeft className="size-4" /> {" "}<T>{"All orders"}</T></Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight"><T>{"Order"}</T>{" "}{so.number}</h1>
          <p className="mt-0.5 text-sm text-leaf-900/60"><T>{"Placed"}</T>{" "}{placed}</p>
        </div>
        <OrderActions id={so.id} canCancel={canCancel} canPay={so.status === "pending" && so.paymentMethod === "card" && so.paymentStatus !== "paid" && stripeEnabled()} />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Status label={<T>{"Order"}</T>}>
          <OrderPill s={so.status} />
        </Status>
        <Status label={<T>{"Payment"}</T>}>
          <PaymentPill s={so.paymentStatus} />
        </Status>
        <Status label={<T>{"Warehouse"}</T>}>{so.status === "cancelled" ? <Pill tone="slate">—</Pill> : <WarehousePill s={so.fulfilment} />}</Status>
        <Status label={<T>{"Delivery"}</T>}>{d ? <StageBadge stage={d.stage} /> : <Pill tone="slate">{so.status === "cancelled" ? "—" : <T>{"Waiting"}</T>}</Pill>}</Status>
        <Status label={<T>{"Proof of delivery"}</T>}>{d ? <Pill tone={POD_LABEL[d.pod].tone}>{<Tx>{POD_LABEL[d.pod].label}</Tx>}</Pill> : <Pill tone="slate">—</Pill>}</Status>
      </div>

      {d && so.status !== "cancelled" && (
        <div className="mt-4 rounded-3xl border border-leaf-950/10 bg-white p-5">
          <StageSteps stage={d.stage} />
          <Link
            href={`/portal/track/${so.deliveryOrderId}`}
            className="mt-5 flex items-center justify-center gap-2 rounded-full bg-leaf-50 py-2.5 text-sm font-semibold text-leaf-800 hover:bg-leaf-100"
          >
            <Truck className="size-4" />
            {d.stage === "out_for_delivery" ? <T>{"Track the van live"}</T> : d.stage === "delivered" ? <T>{"See photo, signature and route"}</T> : <T>{"Delivery details"}</T>}
          </Link>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section className="overflow-hidden rounded-3xl border border-leaf-950/10 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-leaf-50/60 text-left text-xs text-leaf-900/60">
              <tr>
                <th className="px-4 py-2.5 font-medium"><T>{"Product"}</T></th>
                <th className="px-2 py-2.5 text-right font-medium"><T>{"Qty"}</T></th>
                <th className="px-2 py-2.5 text-right font-medium"><T>{"Price"}</T></th>
                <th className="px-4 py-2.5 text-right font-medium"><T>{"Total"}</T></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-leaf-950/5">
                  <td className="px-4 py-3">
                    <p className="font-medium">{it.name}</p>
                    <p className="text-xs text-leaf-900/50">
                      {it.sku} · {it.packSize}
                    </p>
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    {it.qty} <span className="text-xs text-leaf-900/50">{it.unit}</span>
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">{aud(it.unitPriceCents)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{aud(it.lineCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="space-y-1 border-t border-leaf-950/10 px-4 py-3 text-sm">
            <Row label={<T>{"Subtotal"}</T>} value={aud(so.subtotalCents)} />
            <Row label={<T>{"Delivery"}</T>} value={so.deliveryFeeCents ? aud(so.deliveryFeeCents) : "Free"} />
            <Row label={<T>{"GST"}</T>} value={aud(so.gstCents)} />
            <Row label={<T>{"Total"}</T>} value={aud(so.totalCents)} strong />
          </dl>
        </section>
        <section className="space-y-4">
          <div className="rounded-3xl border border-leaf-950/10 bg-white p-5 text-sm">
            <h2 className="flex items-center gap-1.5 font-semibold">
              <MapPin className="size-4 text-leaf-700" /> {" "}<T>{"Delivery"}</T></h2>
            <p className="mt-2">{<Tx>{prettyDate(so.deliveryDate)}</Tx>}</p>
            {(so.windowStartMin !== null || so.windowEndMin !== null) && (
              <p className="text-leaf-900/70">
                <T>{"Window"}</T>{" "}{so.windowStartMin !== null ? formatMinutesClock(so.windowStartMin) : <T>{"any time"}</T>} – {so.windowEndMin !== null ? formatMinutesClock(so.windowEndMin) : <T>{"end of day"}</T>}
              </p>
            )}
            <p className="mt-2">{so.recipient}</p>
            <p className="text-leaf-900/70">{so.address}</p>
            {so.phone && <p className="text-leaf-900/70">{so.phone}</p>}
            {so.instructions && <p className="mt-2 text-leaf-900/70">“{so.instructions}”</p>}
          </div>
          <div className="rounded-3xl border border-leaf-950/10 bg-white p-5 text-sm">
            <h2 className="flex items-center gap-1.5 font-semibold">
              <FileText className="size-4 text-leaf-700" /> {" "}<T>{"Payment"}</T></h2>
            <p className="mt-2"><Tx>{PAYMENT_METHOD_LABEL[so.paymentMethod]}</Tx></p>
            {so.dueDate && so.paymentStatus === "unpaid" && <p className="text-leaf-900/70"><T>{"Due"}</T>{" "}{<Tx>{prettyDate(so.dueDate)}</Tx>}</p>}
            {so.paymentMethod === "bank_transfer" && so.paymentStatus === "unpaid" && so.status !== "cancelled" && (
              <p className="mt-2 rounded-xl bg-[#f5f1e8] p-3 text-xs whitespace-pre-wrap text-leaf-900/80">
                {s.bankDetails || <T>{"Our team will send you our bank details."}</T>}
                {"\n"}<T>{"Reference:"}</T>{" "}{so.number}
              </p>
            )}
            <Link href={`/portal/orders/${so.id}/invoice`} className="mt-3 inline-flex text-sm font-semibold text-leaf-700 hover:underline">
              <T>{"View tax invoice"}</T></Link>
          </div>
        </section>
      </div>
    </>
  );
}

function Status({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-leaf-950/10 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-leaf-900/45">{<Tx>{label}</Tx>}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value, strong }: { label: React.ReactNode; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "pt-1 font-display text-base font-semibold" : "text-leaf-900/70"}`}>
      <dt>{<Tx>{label}</Tx>}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
