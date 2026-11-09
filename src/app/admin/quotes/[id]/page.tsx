import { eq } from "drizzle-orm";
import { ArrowLeft, Printer, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LinkPending } from "@/components/client-ui";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, CardHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { customers, salesOrders, users } from "@/lib/db/schema";
import { emailEnabled } from "@/lib/email";
import { aud, PAYMENT_TERMS_LABEL } from "@/lib/money";
import { customerEmail } from "@/lib/notify";
import { getSettings } from "@/lib/planning";
import { QUOTE_STATUS, quoteState } from "@/lib/quote-status";
import { quoteEditBlocker, quoteWithItems } from "@/lib/quotes";
import { todayIn } from "@/lib/time";
import { QuoteActions } from "./quote-actions";

export const metadata: Metadata = { title: "Quote" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser(STAFF);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const found = await quoteWithItems(db, id);
  if (!found) notFound();
  const { quote: q, items } = found;
  const [[c], s, emailTo, [by], [so]] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, q.customerId)).limit(1),
    getSettings(db),
    customerEmail(db, q.customerId),
    q.createdBy ? db.select({ name: users.name }).from(users).where(eq(users.id, q.createdBy)).limit(1) : Promise.resolve([]),
    q.salesOrderId ? db.select({ id: salesOrders.id, number: salesOrders.number, status: salesOrders.status }).from(salesOrders).where(eq(salesOrders.id, q.salesOrderId)).limit(1) : Promise.resolve([]),
  ]);
  const today = todayIn(s.timezone);
  const state = quoteState(q, today);
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" });
  const open = !quoteEditBlocker(q);

  return (
    <>
      <Link href="/admin/quotes" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> <T>{"Quotations"}</T>
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            <T vars={{ number: q.number }}>{"Quote {number}"}</T>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {c.name} <span className="font-mono text-xs">{c.code}</span> · <T vars={{ when: fmt.format(q.createdAt) }}>{"made {when}"}</T>
            {by && (
              <>
                {" "}
                <T vars={{ name: by.name }}>{"by {name}"}</T>
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={QUOTE_STATUS[state].tone}>
              <Tx>{QUOTE_STATUS[state].label}</Tx>
            </Badge>
            {so && (
              <Link href={`/admin/sales/${so.id}`}>
                <Badge tone="green">
                  <T vars={{ number: so.number }}>{"Order {number}"}</T>
                  {so.status === "cancelled" && (
                    <>
                      {" "}
                      · <T>{"cancelled"}</T>
                    </>
                  )}
                </Badge>
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/quotes/${q.id}/print`} className={btn("secondary")}>
            <Printer className="size-4" /> <T>{"Print / PDF"}</T>
            <LinkPending />
          </Link>
          <QuoteActions id={q.id} number={q.number} status={q.status} open={open} isAdmin={me.role === "admin"} emailTo={emailTo} emailEnabled={emailEnabled()} sentAt={q.sentAt ? fmt.format(q.sentAt) : null} />
          {open && (
            <Link href={`/admin/sales/new?quote=${q.id}`} className={btn("primary")}>
              <ShoppingBag className="size-4" /> <T>{"Convert to sales order"}</T>
              <LinkPending />
            </Link>
          )}
        </div>
      </div>

      {state === "expired" && open && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <T vars={{ date: prettyDate(q.validUntil, { day: "numeric", month: "long", year: "numeric" }) }}>
            {"This quote ran out on {date}. You can still turn it into an order, or copy it to send fresh prices."}
          </T>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader title={<T>{"Products"}</T>} />
          <table className="w-full text-sm">
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">{it.name}</p>
                    <p className="text-xs text-slate-500">
                      {it.sku} · {it.packSize}
                      {!it.gst && (
                        <>
                          {" "}
                          · <T>{"GST free"}</T>
                        </>
                      )}
                      {!it.productId && (
                        <>
                          {" "}
                          · <span className="text-red-600"><T>{"product deleted"}</T></span>
                        </>
                      )}
                    </p>
                  </td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap tabular-nums">
                    {it.qty} {it.unit}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-500">{aud(it.unitPriceCents)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{aud(it.lineCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="space-y-1 border-t border-line px-4 py-3 text-sm">
            {(
              [
                ["Subtotal", aud(q.subtotalCents)],
                ["Delivery", q.deliveryFeeCents ? aud(q.deliveryFeeCents) : "Free"],
                ["GST", aud(q.gstCents)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between text-slate-600">
                <dt>
                  <T>{k}</T>
                </dt>
                <dd className="tabular-nums">{v === "Free" ? <T>{"Free"}</T> : v}</dd>
              </div>
            ))}
            <div className="flex justify-between pt-1 text-base font-semibold">
              <dt>
                <T>{"Total"}</T>
              </dt>
              <dd className="tabular-nums">{aud(q.totalCents)}</dd>
            </div>
          </dl>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={<T>{"Customer"}</T>} />
            <div className="space-y-1 p-4 text-sm">
              <p className="font-medium">
                {c.name} <span className="font-mono text-xs text-slate-500">{c.code}</span>
              </p>
              {c.address && <p className="text-slate-600">{c.address}</p>}
              {c.phone && <p className="text-slate-600">{c.phone}</p>}
              {emailTo && <p className="text-slate-600">{emailTo}</p>}
              <p className="text-slate-600">
                <T>{PAYMENT_TERMS_LABEL[c.paymentTerms]}</T>
              </p>
            </div>
          </Card>
          <Card>
            <CardHeader title={<T>{"Quote details"}</T>} />
            <div className="space-y-1.5 p-4 text-sm">
              <p>
                <T>{"Valid until"}</T>: <span className="font-medium">{<Tx>{prettyDate(q.validUntil)}</Tx>}</span>
              </p>
              {q.sentAt && (
                <p className="text-slate-600">
                  <T vars={{ when: fmt.format(q.sentAt), to: q.sentTo ?? "" }}>{"Emailed {when} to {to}"}</T>
                </p>
              )}
              {q.acceptedAt && (
                <p className="text-slate-600">
                  <T vars={{ when: fmt.format(q.acceptedAt) }}>{"Accepted {when}"}</T>
                </p>
              )}
              {q.notes && <p className="mt-2 rounded-lg bg-slate-50 p-2 whitespace-pre-wrap text-slate-700">{q.notes}</p>}
              {q.internalNote && (
                <p className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900">
                  <T>{"Note:"}</T> {q.internalNote}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
