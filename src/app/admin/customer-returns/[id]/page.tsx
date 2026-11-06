import { asc, eq } from "drizzle-orm";
import { ArrowLeft, Check } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, Card, CardHeader, cx } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { creditBalance } from "@/lib/credit";
import { CUSTOMER_RESOLUTION, CUSTOMER_RETURN_REASON, CUSTOMER_RETURN_STATUS, REFUND_METHOD, RETURNED_CONDITION } from "@/lib/customer-return-labels";
import { getDb } from "@/lib/db";
import { customerReturnItems, customerReturns, customers, salesOrders, users } from "@/lib/db/schema";
import { aud } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { isUuid } from "@/lib/purchasing/common";
import { money, qtyText, toCents } from "@/lib/purchasing/labels";
import { CheckInForm, CompleteForm, CustomerReturnButtons } from "./customer-return-steps";

export const metadata: Metadata = { title: "Customer Return" };

export default async function CustomerReturnPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(STAFF);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = await getDb();
  const [row] = await db
    .select({ r: customerReturns, customer: customers, so: salesOrders })
    .from(customerReturns)
    .innerJoin(customers, eq(customers.id, customerReturns.customerId))
    .innerJoin(salesOrders, eq(salesOrders.id, customerReturns.salesOrderId))
    .where(eq(customerReturns.id, id))
    .limit(1);
  if (!row) notFound();
  const { r, customer, so } = row;
  const [items, people, s, credit, [exchange]] = await Promise.all([
    db.select().from(customerReturnItems).where(eq(customerReturnItems.customerReturnId, id)).orderBy(asc(customerReturnItems.name)),
    db.select({ id: users.id, name: users.name }).from(users),
    getSettings(db),
    creditBalance(db, customer.id),
    r.exchangeOrderId ? db.select({ id: salesOrders.id, number: salesOrders.number }).from(salesOrders).where(eq(salesOrders.id, r.exchangeOrderId)).limit(1) : Promise.resolve([]),
  ]);
  const who = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" });
  const steps = [
    { label: "Return created", done: true, when: fmt.format(r.createdAt), by: who(r.createdBy) },
    { label: "Goods checked in", done: !!r.receivedAt, when: r.receivedAt ? fmt.format(r.receivedAt) : null, by: who(r.receivedBy) },
    { label: r.resolution === "refund" ? "Refunded" : "Store credit given", done: r.status === "completed", when: r.completedAt ? fmt.format(r.completedAt) : null, by: who(r.completedBy) },
  ];

  return (
    <>
      <Link href="/admin/customer-returns" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> <T>{"Customer Returns"}</T>
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900"><T>{"Customer return"}</T> {r.returnNumber}</h1>
          <p className="mt-1 text-sm text-slate-500">
            <Link href={`/admin/customers/${customer.id}`} className="text-blue-700 hover:underline">{customer.name}</Link> · <T>{"order"}</T>{" "}
            <Link href={`/admin/sales/${so.id}`} className="text-blue-700 hover:underline">{so.number}</Link> · <Tx>{CUSTOMER_RETURN_REASON[r.reason]}</Tx>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={CUSTOMER_RETURN_STATUS[r.status].tone}><Tx>{CUSTOMER_RETURN_STATUS[r.status].label}</Tx></Badge>
            <Badge tone="slate"><Tx>{CUSTOMER_RESOLUTION[r.resolution].label}</Tx></Badge>
          </div>
        </div>
        <CustomerReturnButtons id={r.id} status={r.status} resolution={r.resolution} customerId={customer.id} exchangeOrder={exchange ?? null} />
      </div>

      <ol className="mb-4 grid gap-2 sm:grid-cols-3">
        {steps.map((st, i) => (
          <li key={i} className={cx("rounded-xl border px-3 py-2 text-xs", r.status === "cancelled" ? "border-dashed border-line text-slate-400" : st.done ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-line bg-white text-slate-500")}>
            <p className="flex items-center gap-1 font-semibold">{st.done && <Check className="size-3.5" />} {i + 1}. <Tx>{st.label}</Tx></p>
            {st.when && <p className="mt-0.5">{st.when}{st.by && ` · ${st.by}`}</p>}
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          {r.status === "requested" ? (
            <CheckInForm id={r.id} lines={items.map((it) => ({ id: it.id, sku: it.sku, name: it.name, unit: it.unit, qty: it.qty }))} />
          ) : (
            <Card className="overflow-x-auto">
              <CardHeader title={<T>{"Products"}</T>} />
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium"><T>{"Product"}</T></th>
                    <th className="px-2 py-2 text-right font-medium"><T>{"Returning"}</T></th>
                    <th className="px-2 py-2 text-right font-medium"><T>{"Received"}</T></th>
                    <th className="px-2 py-2 font-medium"><T>{"Condition"}</T></th>
                    <th className="px-4 py-2 text-right font-medium"><T>{"Value"}</T></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t border-line">
                      <td className="px-4 py-2.5"><p className="font-medium">{it.name}</p><p className="text-xs text-slate-500">{it.sku}</p></td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{qtyText(it.qty)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{qtyText(it.receivedQty)}</td>
                      <td className="px-2 py-2.5 text-slate-600">{it.condition ? <Tx>{RETURNED_CONDITION[it.condition]}</Tx> : "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(it.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {r.status === "received" && <CompleteForm id={r.id} resolution={r.resolution} total={r.total} paidByCard={so.paymentMethod === "card"} />}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title={<T>{"Value"}</T>} />
            <dl className="space-y-1 p-4 text-sm">
              <div className="flex justify-between text-slate-600"><dt><T>{"Goods (ex GST)"}</T></dt><dd className="tabular-nums">{money(r.subtotal)}</dd></div>
              <div className="flex justify-between text-slate-600"><dt><T>{"GST"}</T></dt><dd className="tabular-nums">{money(r.gst)}</dd></div>
              <div className="flex justify-between pt-1 font-semibold"><dt><T>{"Back to the customer"}</T></dt><dd className="tabular-nums">{money(r.total)}</dd></div>
              {r.status === "completed" && r.resolution === "refund" && (
                <p className="pt-2 text-slate-600"><T>{"Refunded by"}</T> <Tx>{r.refundMethod ? REFUND_METHOD[r.refundMethod] : "—"}</Tx>{r.refundReference && ` · ${r.refundReference}`}</p>
              )}
              {r.status === "completed" && r.resolution !== "refund" && <p className="pt-2 text-slate-600"><T>{"Added to store credit"}</T> {money(r.creditAmount)}</p>}
              <p className="pt-2 text-xs text-slate-500">
                <T>{"Store credit available now:"}</T>{" "}
                <Link href={`/admin/customers/${customer.id}#credit`} className="font-medium text-blue-700 hover:underline">{aud(toCents(credit))}</Link>
              </p>
            </dl>
          </Card>
          {r.notes && (
            <Card>
              <CardHeader title={<T>{"Notes"}</T>} />
              <p className="p-4 text-sm whitespace-pre-wrap text-slate-600">{r.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
