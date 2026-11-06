import { desc, eq } from "drizzle-orm";
import { HandCoins } from "lucide-react";
import type { Metadata } from "next";
import { addSupplierRefund } from "@/app/actions/purchasing";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { MoneyForm } from "@/components/purchasing-ui";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { purchaseReturns, supplierRefunds, suppliers, users } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { money, PAY_METHOD_LABEL, toCents } from "@/lib/purchasing/labels";
import { refundPosition } from "@/lib/purchasing/returns";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Supplier Refunds" };

export default async function SupplierRefundsPage() {
  const me = await requireUser(STAFF);
  const db = await getDb();
  const [rows, sent, s] = await Promise.all([
    db
      .select({ f: supplierRefunds, supplier: suppliers.name, ret: purchaseReturns.returnNumber, by: users.name })
      .from(supplierRefunds)
      .innerJoin(suppliers, eq(suppliers.id, supplierRefunds.supplierId))
      .innerJoin(purchaseReturns, eq(purchaseReturns.id, supplierRefunds.purchaseReturnId))
      .leftJoin(users, eq(users.id, supplierRefunds.createdBy))
      .orderBy(desc(supplierRefunds.refundDate), desc(supplierRefunds.createdAt))
      .limit(300),
    // Goods have gone back and the supplier hasn't paid it all yet.
    db
      .select({ id: purchaseReturns.id, number: purchaseReturns.returnNumber, supplier: suppliers.name, method: purchaseReturns.refundMethod })
      .from(purchaseReturns)
      .innerJoin(suppliers, eq(suppliers.id, purchaseReturns.supplierId))
      .where(eq(purchaseReturns.status, "dispatched")),
    getSettings(db),
  ]);
  const due = (await Promise.all(sent.filter((r) => r.method === "refund").map(async (r) => ({ id: r.id, label: `${r.number} · ${r.supplier}`, outstanding: (await refundPosition(db, r.id)).outstanding })))).filter((o) => toCents(o.outstanding) > 0);
  const owed = due.reduce((t, o) => t + toCents(o.outstanding), 0) / 100;

  return (
    <>
      <PageHeader
        title={<T>{"Supplier Refunds"}</T>}
        subtitle={<T>{"Money suppliers actually paid back for goods we returned. A supplier accepting a return isn't a refund until it's recorded here."}</T>}
        actions={me.role === "admin" ? <MoneyForm action={addSupplierRefund} title="Record refund from supplier" buttonLabel={<><HandCoins className="size-4" /> <T>{"Record refund"}</T></>} idField="purchaseReturnId" options={due} today={todayIn(s.timezone)} /> : undefined}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Stat label={<T>{"Suppliers still owe us"}</T>} value={money(owed)} hint={<T vars={{ n: due.length }}>{"{n} returns sent back"}</T>} tone="amber" />
        <Stat label={<T>{"Refunded (shown below)"}</T>} value={money(rows.reduce((t, r) => t + toCents(r.f.amount), 0) / 100)} hint={<T vars={{ n: rows.length }}>{"{n} refunds"}</T>} tone="green" />
      </div>
      <Card className="overflow-x-auto">
        {!rows.length ? (
          <EmptyState icon={HandCoins} title="No refunds recorded yet" />
        ) : (
          <table className="w-full min-w-[680px] text-sm">
            <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium"><T>{"Refund"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Purchase return"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Method"}</T></th>
                <th className="px-4 py-2.5 text-right font-medium"><T>{"Amount"}</T></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ f, supplier, ret, by }) => (
                <tr key={f.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="font-semibold">{f.refundNumber}</p>
                    <p className="text-xs text-slate-500"><Tx>{prettyDate(f.refundDate)}</Tx>{by && ` · ${by}`}</p>
                  </td>
                  <td className="px-2 py-2.5">
                    <Link href={`/admin/purchase-returns/${f.purchaseReturnId}`} className="font-medium text-blue-700 hover:underline">{ret}</Link>
                    <p className="text-xs text-slate-500">{supplier}</p>
                  </td>
                  <td className="px-2 py-2.5 text-slate-600"><Tx>{PAY_METHOD_LABEL[f.method]}</Tx>{f.reference && <p className="text-xs text-slate-400">{f.reference}</p>}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(f.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
