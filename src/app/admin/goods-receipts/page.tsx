import { desc, eq, sql } from "drizzle-orm";
import { PackagePlus } from "lucide-react";
import type { Metadata } from "next";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { goodsReceiptItems, goodsReceipts, purchaseOrders, purchaseReturns, suppliers } from "@/lib/db/schema";
import { GRN_STATUS, qtyText } from "@/lib/purchasing/labels";

export const metadata: Metadata = { title: "Goods Receipts" };

export default async function GoodsReceiptsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireUser(STAFF);
  const view = (await searchParams).view === "draft" ? "draft" : "all";
  const db = await getDb();
  const rows = await db
    .select({
      grn: goodsReceipts,
      supplier: suppliers.name,
      po: purchaseOrders.poNumber,
      ret: purchaseReturns.returnNumber,
      units: sql<number>`(select coalesce(sum(i.received_qty), 0)::float8 from ${goodsReceiptItems} i where i.goods_receipt_id = ${goodsReceipts}.id)`,
    })
    .from(goodsReceipts)
    .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.purchaseOrderId))
    .leftJoin(purchaseReturns, eq(purchaseReturns.id, goodsReceipts.purchaseReturnId))
    .where(view === "draft" ? eq(goodsReceipts.status, "draft") : undefined)
    .orderBy(desc(goodsReceipts.createdAt))
    .limit(300);

  return (
    <>
      <PageHeader
        title={<T>{"Goods Receipts"}</T>}
        subtitle={<T>{"Deliveries from suppliers. Check what arrived, then put it into stock. To receive a delivery, open its purchase order and choose Receive goods."}</T>}
      />
      <div className="mb-3 flex gap-2">
        <Link href="/admin/goods-receipts" className={btn(view === "all" ? "primary" : "ghost", "sm")}><T>{"All"}</T></Link>
        <Link href="/admin/goods-receipts?view=draft" className={btn(view === "draft" ? "primary" : "ghost", "sm")}><T>{"Being checked"}</T></Link>
      </div>
      <Card className="overflow-x-auto">
        {!rows.length ? (
          <EmptyState icon={PackagePlus} title="No goods receipts yet">
            {"They're created when you receive goods against a purchase order."}
          </EmptyState>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium"><T>{"Goods receipt"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Against"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Arrived"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Status"}</T></th>
                <th className="px-4 py-2.5 text-right font-medium"><T>{"Units"}</T></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.grn.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/goods-receipts/${r.grn.id}`} className="font-semibold text-blue-700 hover:underline">{r.grn.grnNumber}</Link>
                    <p className="text-xs text-slate-500">{r.supplier}</p>
                  </td>
                  <td className="px-2 py-2.5 text-slate-600">{r.po ?? <><T>{"Replacements for"}</T> {r.ret}</>}</td>
                  <td className="px-2 py-2.5"><Tx>{prettyDate(r.grn.receiptDate)}</Tx></td>
                  <td className="px-2 py-2.5"><Badge tone={GRN_STATUS[r.grn.status].tone}><Tx>{GRN_STATUS[r.grn.status].label}</Tx></Badge></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{qtyText(Number(r.units))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
