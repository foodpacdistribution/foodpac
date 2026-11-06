import { asc, desc, eq } from "drizzle-orm";
import { ArrowLeft, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addSupplierPayment } from "@/app/actions/purchasing";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { MoneyForm } from "@/components/purchasing-ui";
import { Badge, Card, CardHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { goodsReceipts, purchaseOrderItems, purchaseOrders, supplierPayments, suppliers, users } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { isUuid } from "@/lib/purchasing/common";
import { GRN_STATUS, money, PAY_METHOD_LABEL, PO_STATUS, paymentState, qtyText, toCents, unitMoney } from "@/lib/purchasing/labels";
import { poEditBlocker } from "@/lib/purchasing/orders";
import { todayIn } from "@/lib/time";
import { PoActions } from "./po-actions";

export const metadata: Metadata = { title: "Purchase Order" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser(STAFF);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = await getDb();
  const [row] = await db.select({ po: purchaseOrders, supplier: suppliers, by: users.name }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).leftJoin(users, eq(users.id, purchaseOrders.createdBy)).where(eq(purchaseOrders.id, id)).limit(1);
  if (!row) notFound();
  const { po, supplier } = row;
  const [items, receipts, payments, s] = await Promise.all([
    db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id)).orderBy(asc(purchaseOrderItems.name)),
    db.select().from(goodsReceipts).where(eq(goodsReceipts.purchaseOrderId, id)).orderBy(desc(goodsReceipts.createdAt)),
    db.select().from(supplierPayments).where(eq(supplierPayments.purchaseOrderId, id)).orderBy(asc(supplierPayments.paymentDate)),
    getSettings(db),
  ]);
  const today = todayIn(s.timezone);
  const paid = payments.reduce((t, p) => t + toCents(p.amount), 0) / 100;
  const left = (toCents(po.total) - toCents(paid)) / 100;
  const pay = paymentState(po.total, paid);
  const draft = receipts.find((r) => r.status === "draft");

  return (
    <>
      <Link href="/admin/purchase-orders" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> <T>{"Purchase Orders"}</T>
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            <T>{"Purchase order"}</T> {po.poNumber}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {supplier.name} · <T>{"ordered"}</T> <Tx>{prettyDate(po.orderDate)}</Tx>
            {row.by && (
              <>
                {" "}
                <T vars={{ name: row.by }}>{"· entered by {name}"}</T>
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={PO_STATUS[po.status].tone}><Tx>{PO_STATUS[po.status].label}</Tx></Badge>
            {po.status !== "draft" && po.status !== "cancelled" && <Badge tone={pay.tone}><Tx>{pay.label}</Tx></Badge>}
          </div>
        </div>
        <PoActions id={po.id} status={po.status} canEdit={!poEditBlocker(po, receipts.length)} today={today} hasDraftReceipt={draft?.id ?? null} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-x-auto">
          <CardHeader title={<T>{"Products"}</T>} />
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium"><T>{"Product"}</T></th>
                <th className="px-2 py-2 text-right font-medium"><T>{"Ordered"}</T></th>
                <th className="px-2 py-2 text-right font-medium"><T>{"Received"}</T></th>
                <th className="px-2 py-2 text-right font-medium"><T>{"Unit cost"}</T></th>
                <th className="px-4 py-2 text-right font-medium"><T>{"Line total"}</T></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">{it.name}</p>
                    <p className="text-xs text-slate-500">
                      {it.sku}
                      {!it.gst && <> · <T>{"GST free"}</T></>}
                    </p>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {qtyText(it.orderedQty)} {it.unit}
                  </td>
                  <td className={`px-2 py-2.5 text-right tabular-nums ${it.receivedQty >= it.orderedQty ? "text-emerald-700" : it.receivedQty > 0 ? "text-amber-700" : "text-slate-400"}`}>{qtyText(it.receivedQty)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-500">{unitMoney(it.unitCost)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(it.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="space-y-1 border-t border-line px-4 py-3 text-sm">
            <div className="flex justify-between text-slate-600"><dt><T>{"Subtotal (ex GST)"}</T></dt><dd className="tabular-nums">{money(po.subtotal)}</dd></div>
            <div className="flex justify-between text-slate-600"><dt><T>{"GST"}</T></dt><dd className="tabular-nums">{money(po.gst)}</dd></div>
            <div className="flex justify-between pt-1 text-base font-semibold"><dt><T>{"Total (incl. GST)"}</T></dt><dd className="tabular-nums">{money(po.total)}</dd></div>
          </dl>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={<T>{"Details"}</T>} />
            <dl className="space-y-1 p-4 text-sm text-slate-600">
              <p className="font-medium text-slate-900">{supplier.name}</p>
              {supplier.contactName && <p>{supplier.contactName}</p>}
              {supplier.email && <p>{supplier.email}</p>}
              {supplier.phone && <p>{supplier.phone}</p>}
              {po.expectedDate && <p><T>{"Expected"}</T> <Tx>{prettyDate(po.expectedDate)}</Tx></p>}
              {po.supplierReference && <p><T>{"Supplier's reference:"}</T> {po.supplierReference}</p>}
              {po.notes && <p className="mt-2 rounded-lg bg-amber-50 p-2 whitespace-pre-wrap text-amber-900">{po.notes}</p>}
            </dl>
          </Card>
          <Card>
            <CardHeader title={<T>{"Goods receipts"}</T>} />
            <ul className="divide-y divide-line text-sm">
              {receipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-4 py-2.5">
                  <Link href={`/admin/goods-receipts/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.grnNumber}</Link>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    <Tx>{prettyDate(r.receiptDate)}</Tx>
                    <Badge tone={GRN_STATUS[r.status].tone}><Tx>{GRN_STATUS[r.status].label}</Tx></Badge>
                  </span>
                </li>
              ))}
              {!receipts.length && <li className="px-4 py-4 text-slate-500"><T>{"Nothing received yet."}</T></li>}
            </ul>
          </Card>
          <Card>
            <CardHeader
              title={<T>{"Payments to supplier"}</T>}
              action={
                me.role === "admin" && po.status !== "draft" && po.status !== "cancelled" && toCents(left) > 0 ? (
                  <MoneyForm action={addSupplierPayment} title="Record payment to supplier" buttonLabel={<><Wallet className="size-3.5" /> <T>{"Record payment"}</T></>} idField="purchaseOrderId" options={[{ id: po.id, label: po.poNumber, outstanding: left }]} today={today} variant="secondary" />
                ) : undefined
              }
            />
            <ul className="divide-y divide-line text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-2.5">
                  <span>
                    <span className="font-medium">{p.paymentNumber}</span>{" "}
                    <span className="text-xs text-slate-500"><Tx>{prettyDate(p.paymentDate)}</Tx> · <Tx>{PAY_METHOD_LABEL[p.method]}</Tx>{p.reference && ` · ${p.reference}`}</span>
                  </span>
                  <span className="tabular-nums">{money(p.amount)}</span>
                </li>
              ))}
              <li className="flex justify-between px-4 py-2.5 font-medium">
                <span><T>{"Left to pay"}</T></span>
                <span className="tabular-nums">{money(po.status === "cancelled" ? 0 : left)}</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
