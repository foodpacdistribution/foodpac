import { desc, eq, inArray } from "drizzle-orm";
import { Wallet } from "lucide-react";
import type { Metadata } from "next";
import { addSupplierPayment } from "@/app/actions/purchasing";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { MoneyForm } from "@/components/purchasing-ui";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { purchaseOrders, supplierPayments, suppliers, users } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { money, PAY_METHOD_LABEL, toCents } from "@/lib/purchasing/labels";
import { paidByPo } from "@/lib/purchasing/orders";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Supplier Payments" };

export default async function SupplierPaymentsPage() {
  const me = await requireUser(STAFF);
  const db = await getDb();
  const [rows, open, s] = await Promise.all([
    db
      .select({ p: supplierPayments, supplier: suppliers.name, po: purchaseOrders.poNumber, by: users.name })
      .from(supplierPayments)
      .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, supplierPayments.purchaseOrderId))
      .leftJoin(users, eq(users.id, supplierPayments.createdBy))
      .orderBy(desc(supplierPayments.paymentDate), desc(supplierPayments.createdAt))
      .limit(300),
    db
      .select({ id: purchaseOrders.id, number: purchaseOrders.poNumber, total: purchaseOrders.total, supplier: suppliers.name })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(inArray(purchaseOrders.status, ["sent", "confirmed", "partially_received", "received", "closed"]))
      .orderBy(desc(purchaseOrders.createdAt)),
    getSettings(db),
  ]);
  const paid = await paidByPo(db, open.map((o) => o.id));
  const toPay = open
    .map((o) => ({ id: o.id, label: `${o.number} · ${o.supplier}`, outstanding: (toCents(o.total) - toCents(paid.get(o.id) ?? 0)) / 100 }))
    .filter((o) => toCents(o.outstanding) > 0);
  const owing = toPay.reduce((t, o) => t + toCents(o.outstanding), 0) / 100;

  return (
    <>
      <PageHeader
        title={<T>{"Supplier Payments"}</T>}
        subtitle={<T>{"Money paid to suppliers, against each purchase order. Suppliers give no credit, so nothing is carried on account."}</T>}
        actions={me.role === "admin" ? <MoneyForm action={addSupplierPayment} title="Record payment to supplier" buttonLabel={<><Wallet className="size-4" /> <T>{"Record payment"}</T></>} idField="purchaseOrderId" options={toPay} today={todayIn(s.timezone)} /> : undefined}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Stat label={<T>{"Still to pay on orders"}</T>} value={money(owing)} hint={<T vars={{ n: toPay.length }}>{"{n} purchase orders"}</T>} tone="amber" />
        <Stat label={<T>{"Paid (shown below)"}</T>} value={money(rows.reduce((t, r) => t + toCents(r.p.amount), 0) / 100)} hint={<T vars={{ n: rows.length }}>{"{n} payments"}</T>} tone="green" />
      </div>
      <Card className="overflow-x-auto">
        {!rows.length ? (
          <EmptyState icon={Wallet} title="No payments recorded yet" />
        ) : (
          <table className="w-full min-w-[680px] text-sm">
            <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium"><T>{"Payment"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Purchase order"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Method"}</T></th>
                <th className="px-4 py-2.5 text-right font-medium"><T>{"Amount"}</T></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, supplier, po, by }) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="font-semibold">{p.paymentNumber}</p>
                    <p className="text-xs text-slate-500"><Tx>{prettyDate(p.paymentDate)}</Tx>{by && ` · ${by}`}</p>
                  </td>
                  <td className="px-2 py-2.5">
                    <Link href={`/admin/purchase-orders/${p.purchaseOrderId}`} className="font-medium text-blue-700 hover:underline">{po}</Link>
                    <p className="text-xs text-slate-500">{supplier}</p>
                  </td>
                  <td className="px-2 py-2.5 text-slate-600"><Tx>{PAY_METHOD_LABEL[p.method]}</Tx>{p.reference && <p className="text-xs text-slate-400">{p.reference}</p>}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
