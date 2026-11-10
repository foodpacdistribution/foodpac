import { eq } from "drizzle-orm";
import { ArrowLeft, ClipboardList, Pencil, Truck, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { LinkPending } from "@/components/client-ui";
import { notFound } from "next/navigation";
import { Badge, btn, Card, CardHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { emailEnabled } from "@/lib/email";
import { finaliseBlocker, reopenBlocker } from "@/lib/invoices";
import { customerEmail } from "@/lib/notify";
import { customerReturns, customers, orders, quotes, salesOrderItems, salesOrders, users } from "@/lib/db/schema";
import { creditBalance } from "@/lib/credit";
import { CUSTOMER_RETURN_STATUS } from "@/lib/customer-return-labels";
import { aud, FULFILMENT, PAYMENT_METHOD_LABEL, PAYMENT_STATUS, PAYMENT_TERMS_LABEL, SALES_STATUS } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { editBlocker } from "@/lib/staff-orders";
import { formatMinutesClock, todayIn } from "@/lib/time";
import { InvoiceActions } from "./invoice-actions";
import { ApplyCredit, MoveDay, SaleActions } from "./sale-actions";
import { T, Tx } from "@/components/i18n";

export const metadata: Metadata = { title: "Sales Order" };

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser(STAFF);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, id)).limit(1);
  if (!so) notFound();
  const [[c], items, s, [d], [by], emailTo, credit, returns, [fromQuote]] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, so.customerId)).limit(1),
    db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id)),
    getSettings(db),
    so.deliveryOrderId ? db.select().from(orders).where(eq(orders.id, so.deliveryOrderId)).limit(1) : Promise.resolve([]),
    so.userId ? db.select({ name: users.name, role: users.role }).from(users).where(eq(users.id, so.userId)).limit(1) : Promise.resolve([]),
    customerEmail(db, so.customerId),
    creditBalance(db, so.customerId),
    db.select().from(customerReturns).where(eq(customerReturns.salesOrderId, so.id)),
    db.select({ id: quotes.id, number: quotes.number }).from(quotes).where(eq(quotes.salesOrderId, so.id)).limit(1),
  ]);
  const dueCents = so.totalCents - so.creditAppliedCents;
  const canEdit = !editBlocker(so, d?.status ?? null);
  const waiting = items.reduce((n, it) => n + it.backorderQty, 0);
  // Orders entered in the back office say who took them.
  const enteredBy = by && by.role !== "customer" ? by.name : null;
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" });
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "medium" });
  const today = todayIn(s.timezone);
  // Same rule as the "Missed day" list: confirmed, its day has passed, not delivered.
  const missed = so.status === "confirmed" && so.deliveryDate < today && d?.status !== "delivered";
  const canCancel = so.status !== "cancelled" && (!d || d.status === "pending" || d.status === "planned" || d.status === "failed");

  return (
    <>
      <Link href="/admin/sales" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {" "}<T>{"Sales orders"}</T></Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900"><T>{"Order"}</T>{" "}{so.number}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {c.name} <span className="font-mono text-xs">{c.code}</span> {" "}<T>{"· placed"}</T>{" "}{fmt.format(so.createdAt)}
            {enteredBy && (
              <>
                {" "}
                <T vars={{ name: enteredBy }}>{"· entered by {name}"}</T>
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={SALES_STATUS[so.status].tone}>{<Tx>{SALES_STATUS[so.status].label}</Tx>}</Badge>
            <Badge tone={PAYMENT_STATUS[so.paymentStatus].tone}>{<Tx>{PAYMENT_STATUS[so.paymentStatus].label}</Tx>}</Badge>
            {so.status === "confirmed" && <Badge tone={FULFILMENT[so.fulfilment].tone}><T>{"Warehouse:"}</T>{" "}{<Tx>{FULFILMENT[so.fulfilment].label}</Tx>}</Badge>}
            {fromQuote && (
              <Link href={`/admin/quotes/${fromQuote.id}`}>
                <Badge tone="blue">
                  <T vars={{ number: fromQuote.number }}>{"From quote {number}"}</T>
                </Badge>
              </Link>
            )}
            {so.status !== "cancelled" && waiting > 0 && <Badge tone="red"><T vars={{ n: waiting }}>{"{n} waiting for stock"}</T></Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {so.status === "confirmed" && d?.status === "delivered" && (
            <Link href={`/admin/customer-returns/new?order=${so.id}`} className={btn("secondary")}>
              <Undo2 className="size-4" /> <T>{"Customer return"}</T>
              <LinkPending />
            </Link>
          )}
          {canEdit && (
            <Link href={`/admin/sales/${so.id}/edit`} className={btn("secondary")}>
              <Pencil className="size-4" /> <T>{"Edit order"}</T>
              <LinkPending />
            </Link>
          )}
        <SaleActions id={so.id} status={so.status} paymentStatus={so.paymentStatus} paymentMethod={so.paymentMethod} fulfilment={so.fulfilment} canCancel={canCancel} isAdmin={me.role === "admin"} />
        </div>
      </div>

      {missed && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="min-w-0 flex-1">
            <b>
              <T>{"Missed its delivery day"}</T> (<Tx>{prettyDate(so.deliveryDate, { weekday: "short", day: "numeric", month: "short" })}</Tx>)
            </b>{" "}
            <span className="text-red-800/80">
              {d?.status === "failed" ? <T>{"The drop failed. Move it to another day to send it again."}</T> : <T>{"It wasn't delivered. Move it to another day, or cancel it."}</T>}
            </span>
          </p>
          <MoveDay id={so.id} today={today} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader
            title={<T>{"Items"}</T>}
            action={
              <Link href={`/admin/sales/picklist?ids=${so.id}`} className={btn("secondary", "sm")}>
                <ClipboardList className="size-3.5" /> {" "}<T>{"Pick list"}</T></Link>
            }
          />
          <table className="w-full text-sm">
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">{it.name}</p>
                    <p className="text-xs text-slate-500">
                      {it.sku} · {it.packSize}
                    </p>
                    {it.backorderQty > 0 && so.status !== "cancelled" && (
                      <p className="mt-1">
                        <Badge tone="red">
                          {it.backorderQty === it.qty ? <T>{"Waiting for stock"}</T> : <T vars={{ n: it.backorderQty }}>{"{n} waiting for stock"}</T>}
                        </Badge>
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {it.qty} {it.unit}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-500">{aud(it.unitPriceCents)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{aud(it.lineCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="space-y-1 border-t border-line px-4 py-3 text-sm">
            {[
              ["Subtotal", aud(so.subtotalCents)],
              ["Delivery", so.deliveryFeeCents ? aud(so.deliveryFeeCents) : "Free"],
              ["GST", aud(so.gstCents)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-slate-600">
                <dt>{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between pt-1 text-base font-semibold">
              <dt><T>{"Total"}</T></dt>
              <dd className="tabular-nums">{aud(so.totalCents)}</dd>
            </div>
            {so.creditAppliedCents > 0 && (
              <>
                <div className="flex justify-between text-slate-600">
                  <dt><T>{"Paid with store credit"}</T></dt>
                  <dd className="tabular-nums">−{aud(so.creditAppliedCents)}</dd>
                </div>
                <div className="flex justify-between font-semibold">
                  <dt><T>{"Amount due"}</T></dt>
                  <dd className="tabular-nums">{aud(so.paymentStatus === "unpaid" ? dueCents : 0)}</dd>
                </div>
              </>
            )}
          </dl>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={<T>{"Delivery"}</T>} />
            <div className="space-y-1 p-4 text-sm">
              <p className="font-medium">{<Tx>{prettyDate(so.deliveryDate)}</Tx>}</p>
              {(so.windowStartMin !== null || so.windowEndMin !== null) && (
                <p className="text-slate-600">
                  <T>{"Window"}</T>{" "}{so.windowStartMin !== null ? formatMinutesClock(so.windowStartMin) : <T>{"any"}</T>} – {so.windowEndMin !== null ? formatMinutesClock(so.windowEndMin) : <T>{"end of day"}</T>}
                </p>
              )}
              <p>{so.recipient}</p>
              <p className="text-slate-600">{so.address}</p>
              {so.phone && <p className="text-slate-600">{so.phone}</p>}
              {so.instructions && <p className="text-slate-600">“{so.instructions}”</p>}
              {so.notes && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900"><T>{"Note:"}</T>{" "}{so.notes}</p>}
              {d ? (
                <Link href={`/admin/orders?date=${d.deliveryDate}&q=${encodeURIComponent(d.orderNumber)}`} className={btn("secondary", "sm", "mt-3")}>
                  <Truck className="size-3.5" /> {" "}<T>{"Delivery"}</T>{" "}{d.orderNumber} · {d.status}
                </Link>
              ) : (
                <p className="mt-2 text-xs text-slate-500">{so.status === "pending" ? <T>{"Sent to the planner once confirmed."}</T> : <T>{"No delivery."}</T>}</p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title={<T>{"Payment"}</T>} />
            <div className="space-y-1 p-4 text-sm">
              <p>{PAYMENT_METHOD_LABEL[so.paymentMethod]}</p>
              <p className="text-slate-600"><T>{"Account terms:"}</T>{" "}<T>{PAYMENT_TERMS_LABEL[c.paymentTerms]}</T></p>
              {so.dueDate && <p className="text-slate-600"><T>{"Due"}</T>{" "}{<Tx>{prettyDate(so.dueDate)}</Tx>}</p>}
              {so.paidAt && <p className="text-slate-600"><T>{"Paid"}</T>{" "}{fmt.format(so.paidAt)}</p>}
              {so.stripeSessionId && <p className="truncate text-xs text-slate-400"><T>{"Stripe"}</T>{" "}{so.stripeSessionId}</p>}
              <p className="pt-1 text-slate-600">
                <T>{"Store credit available:"}</T>{" "}
                <Link href={`/admin/customers/${c.id}#credit`} className="font-medium text-blue-700 hover:underline">{aud(Math.round(credit * 100))}</Link>
              </p>
              {so.status !== "cancelled" && so.paymentStatus === "unpaid" && credit > 0 && dueCents > 0 && <ApplyCredit id={so.id} maxCents={Math.min(dueCents, Math.round(credit * 100))} />}
            </div>
          </Card>
          {returns.length > 0 && (
            <Card>
              <CardHeader title={<T>{"Customer returns"}</T>} />
              <ul className="divide-y divide-line text-sm">
                {returns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-4 py-2.5">
                    <Link href={`/admin/customer-returns/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.returnNumber}</Link>
                    <Badge tone={CUSTOMER_RETURN_STATUS[r.status].tone}><Tx>{CUSTOMER_RETURN_STATUS[r.status].label}</Tx></Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title={<T>{"Invoice"}</T>} />
            <InvoiceActions
              id={so.id}
              number={so.number}
              invoiceStatus={so.invoiceStatus}
              issued={so.invoicedAt ? day.format(so.invoicedAt) : null}
              sentAt={so.invoiceSentAt ? fmt.format(so.invoiceSentAt) : null}
              sentTo={so.invoiceSentTo}
              finaliseBlocked={so.invoiceStatus === "proforma" ? finaliseBlocker(so) : null}
              reopenBlocked={reopenBlocker(so)}
              emailTo={emailTo}
              emailEnabled={emailEnabled()}
              waiting={so.status === "cancelled" ? 0 : waiting}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
