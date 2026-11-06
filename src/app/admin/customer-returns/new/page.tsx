import { and, desc, eq, ilike, or } from "drizzle-orm";
import { ArrowLeft, Search } from "lucide-react";
import type { Metadata } from "next";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { btn, Card, CardHeader, cx, inputCls } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { creditBalance } from "@/lib/credit";
import { orderReturnBlocker, returnableOrderLines } from "@/lib/customer-returns";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { customers, orders, salesOrders } from "@/lib/db/schema";
import { aud } from "@/lib/money";
import { isUuid } from "@/lib/purchasing/common";
import { getT } from "@/lib/i18n/server";
import { CustomerReturnForm } from "./customer-return-form";

export const metadata: Metadata = { title: "New Customer Return" };

/** Step 1: find the order (number, customer name or email), then choose what's coming back. */
export default async function NewCustomerReturnPage({ searchParams }: { searchParams: Promise<{ order?: string; q?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const db = await getDb();
  const back = (
    <Link href="/admin/customer-returns" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
      <ArrowLeft className="size-4" /> <T>{"Customer Returns"}</T>
    </Link>
  );
  const [row] = sp.order && isUuid(sp.order) ? await db.select({ so: salesOrders, customer: customers }).from(salesOrders).innerJoin(customers, eq(customers.id, salesOrders.customerId)).where(eq(salesOrders.id, sp.order)).limit(1) : [];

  if (!row) {
    const tr = await getT();
    const q = (sp.q ?? "").trim().slice(0, 100);
    const found = await db
      .select({ id: salesOrders.id, number: salesOrders.number, deliveryDate: salesOrders.deliveryDate, totalCents: salesOrders.totalCents, customer: customers.name, email: customers.email })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .innerJoin(orders, eq(orders.id, salesOrders.deliveryOrderId))
      .where(and(eq(salesOrders.status, "confirmed"), eq(orders.status, "delivered"), q ? or(ilike(salesOrders.number, `%${q}%`), ilike(customers.name, `%${q}%`), ilike(customers.email, `%${q}%`)) : undefined))
      .orderBy(desc(salesOrders.deliveryDate))
      .limit(50);
    return (
      <>
        {back}
        <h1 className="mb-1 text-xl font-semibold tracking-tight text-slate-900"><T>{"New customer return"}</T></h1>
        <p className="mb-4 text-sm text-slate-500"><T>{"Find the delivered order the goods came on. Prices, GST and quantities come from the order."}</T></p>
        <form className="mb-3 flex gap-2">
          <div className="relative w-full sm:w-96">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <input name="q" defaultValue={q} placeholder={tr("Order number, customer name or email")} className={cx(inputCls, "pl-9")} />
          </div>
          <button className={btn("secondary")}><T>{"Search"}</T></button>
        </form>
        <Card>
          <CardHeader title={<T>{"Delivered orders"}</T>} />
          <ul className="divide-y divide-line text-sm">
            {found.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/customer-returns/new?order=${o.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
                  <span>
                    <span className="font-semibold text-blue-700">{o.number}</span> <span className="text-slate-500">{o.customer}{o.email && ` · ${o.email}`}</span>
                  </span>
                  <span className="text-xs text-slate-500"><Tx>{prettyDate(o.deliveryDate)}</Tx> · {aud(o.totalCents)}</span>
                </Link>
              </li>
            ))}
            {!found.length && <li className="px-4 py-6 text-center text-slate-500"><T>{"No delivered orders match."}</T></li>}
          </ul>
        </Card>
      </>
    );
  }

  const blocked = await orderReturnBlocker(db, row.so);
  const [lines, credit] = await Promise.all([returnableOrderLines(db, row.so.id), creditBalance(db, row.customer.id)]);
  return (
    <>
      {back}
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-slate-900"><T>{"New customer return"}</T></h1>
      <p className="mb-4 text-sm text-slate-500">
        {row.customer.name} · <Link href={`/admin/sales/${row.so.id}`} className="text-blue-700 hover:underline">{row.so.number}</Link> · <T>{"delivered"}</T> <Tx>{prettyDate(row.so.deliveryDate)}</Tx> · <T>{"store credit"}</T> {aud(Math.round(credit * 100))}
      </p>
      {blocked ? (
        <Card className="p-6 text-sm text-slate-600"><Tx>{blocked}</Tx></Card>
      ) : (
        <CustomerReturnForm
          salesOrderId={row.so.id}
          paid={row.so.paymentStatus === "paid"}
          lines={lines.map((l) => ({ id: l.id, sku: l.sku, name: l.name, unit: l.unit, qty: l.qty, already: l.alreadyReturned, returnable: l.returnable, unitPriceCents: l.unitPriceCents, gst: l.gst }))}
        />
      )}
    </>
  );
}
