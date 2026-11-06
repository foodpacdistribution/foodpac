import { asc, desc, eq } from "drizzle-orm";
import { ArrowLeft, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, CardHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { goodsReceiptItems, goodsReceipts, purchaseOrderItems, purchaseOrders, purchaseReturns, suppliers, users } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { isUuid } from "@/lib/purchasing/common";
import { GRN_STATUS, money, qtyText, RETURN_STATUS, SUPPLIER_RESPONSE, unitMoney } from "@/lib/purchasing/labels";
import { returnableLines } from "@/lib/purchasing/returns";
import { ReceiptForm } from "./receipt-form";

export const metadata: Metadata = { title: "Goods Receipt" };

export default async function GoodsReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(STAFF);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = await getDb();
  const [row] = await db
    .select({ grn: goodsReceipts, supplier: suppliers.name, po: purchaseOrders, ret: purchaseReturns, postedBy: users.name })
    .from(goodsReceipts)
    .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.purchaseOrderId))
    .leftJoin(purchaseReturns, eq(purchaseReturns.id, goodsReceipts.purchaseReturnId))
    .leftJoin(users, eq(users.id, goodsReceipts.postedBy))
    .where(eq(goodsReceipts.id, id))
    .limit(1);
  if (!row) notFound();
  const { grn } = row;
  const [items, poLines, returns, s] = await Promise.all([
    db.select().from(goodsReceiptItems).where(eq(goodsReceiptItems.goodsReceiptId, id)).orderBy(asc(goodsReceiptItems.name)),
    grn.purchaseOrderId ? db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, grn.purchaseOrderId)) : Promise.resolve([]),
    db.select().from(purchaseReturns).where(eq(purchaseReturns.goodsReceiptId, id)).orderBy(desc(purchaseReturns.createdAt)),
    getSettings(db),
  ]);
  const returnable = grn.status === "posted" ? (await returnableLines(db, id)).reduce((t, l) => t + l.returnable, 0) : 0;
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" });
  const source = row.po ? (
    <Link href={`/admin/purchase-orders/${row.po.id}`} className="text-blue-700 hover:underline">{row.po.poNumber}</Link>
  ) : row.ret ? (
    <><T>{"Replacements for"}</T> <Link href={`/admin/purchase-returns/${row.ret.id}`} className="text-blue-700 hover:underline">{row.ret.returnNumber}</Link></>
  ) : null;

  return (
    <>
      <Link href="/admin/goods-receipts" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> <T>{"Goods Receipts"}</T>
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900"><T>{"Goods receipt"}</T> {grn.grnNumber}</h1>
          <p className="mt-1 text-sm text-slate-500">{row.supplier} · {source}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={GRN_STATUS[grn.status].tone}><Tx>{GRN_STATUS[grn.status].label}</Tx></Badge>
          </div>
        </div>
        {grn.status === "posted" && returnable > 0 && (
          <Link href={`/admin/purchase-returns/new?grn=${grn.id}`} className={btn("secondary")}>
            <Undo2 className="size-4" /> <T>{"Return goods to supplier"}</T>
          </Link>
        )}
      </div>

      {grn.status === "draft" ? (
        <ReceiptForm
          id={grn.id}
          receiptDate={grn.receiptDate}
          deliveryReference={grn.deliveryReference}
          notes={grn.notes}
          lines={items.map((it) => {
            const pl = poLines.find((l) => l.id === it.purchaseOrderItemId);
            return { id: it.id, sku: it.sku, name: it.name, unit: it.unit, receivedQty: it.receivedQty, notes: it.notes, expected: pl ? pl.orderedQty - pl.receivedQty : it.receivedQty };
          })}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card className="overflow-x-auto">
            <CardHeader title={<T>{"Received into stock"}</T>} />
            <table className="w-full min-w-[480px] text-sm">
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t border-line">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{it.name}</p>
                      <p className="text-xs text-slate-500">{it.sku}{it.notes && ` · ${it.notes}`}</p>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{qtyText(it.receivedQty)} {it.unit}</td>
                    <td className="px-2 py-2.5 text-right text-slate-500 tabular-nums">{unitMoney(it.unitCost)}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(it.receivedQty * it.unitCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title={<T>{"Details"}</T>} />
              <div className="space-y-1 p-4 text-sm text-slate-600">
                <p><T>{"Arrived"}</T> <Tx>{prettyDate(grn.receiptDate)}</Tx></p>
                {grn.deliveryReference && <p><T>{"Delivery note:"}</T> {grn.deliveryReference}</p>}
                {grn.postedAt && <p><T>{"Put into stock"}</T> {fmt.format(grn.postedAt)}{row.postedBy && ` · ${row.postedBy}`}</p>}
                {grn.notes && <p className="mt-2 rounded-lg bg-amber-50 p-2 whitespace-pre-wrap text-amber-900">{grn.notes}</p>}
              </div>
            </Card>
            <Card>
              <CardHeader title={<T>{"Returns to supplier"}</T>} />
              <ul className="divide-y divide-line text-sm">
                {returns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <Link href={`/admin/purchase-returns/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.returnNumber}</Link>
                    <span className="flex flex-wrap justify-end gap-1">
                      <Badge tone={SUPPLIER_RESPONSE[r.supplierStatus].tone}><Tx>{SUPPLIER_RESPONSE[r.supplierStatus].label}</Tx></Badge>
                      <Badge tone={RETURN_STATUS[r.status].tone}><Tx>{RETURN_STATUS[r.status].label}</Tx></Badge>
                    </span>
                  </li>
                ))}
                {!returns.length && <li className="px-4 py-4 text-slate-500"><T>{"None. If anything's wrong with these goods, ask the supplier to take it back."}</T></li>}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
