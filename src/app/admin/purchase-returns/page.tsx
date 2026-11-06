import { and, desc, eq, inArray } from "drizzle-orm";
import { Plus, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { goodsReceipts, purchaseReturns, type PurchaseReturnStatus, suppliers, type SupplierResponseStatus } from "@/lib/db/schema";
import { money, RESOLUTION_LABEL, RETURN_STATUS, SUPPLIER_RESPONSE } from "@/lib/purchasing/labels";

export const metadata: Metadata = { title: "Purchase Returns" };

const VIEWS: Record<string, { label: string; status?: PurchaseReturnStatus[]; supplier?: SupplierResponseStatus[] }> = {
  waiting: { label: "Waiting on supplier", status: ["open"], supplier: ["pending"] },
  to_send: { label: "To send back", status: ["open"], supplier: ["accepted", "partially_accepted"] },
  sent: { label: "Sent back", status: ["dispatched"] },
  closed: { label: "Closed", status: ["closed", "cancelled"] },
  all: { label: "All" },
};

export default async function PurchaseReturnsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const view = VIEWS[sp.view ?? ""] ? sp.view! : "all";
  const v = VIEWS[view];
  const db = await getDb();
  const rows = await db
    .select({ r: purchaseReturns, supplier: suppliers.name, grn: goodsReceipts.grnNumber })
    .from(purchaseReturns)
    .innerJoin(suppliers, eq(suppliers.id, purchaseReturns.supplierId))
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, purchaseReturns.goodsReceiptId))
    .where(and(v.status ? inArray(purchaseReturns.status, v.status) : undefined, v.supplier ? inArray(purchaseReturns.supplierStatus, v.supplier) : undefined))
    .orderBy(desc(purchaseReturns.createdAt))
    .limit(300);

  return (
    <>
      <PageHeader
        title={<T>{"Purchase Returns"}</T>}
        subtitle={<T>{"Goods we ask suppliers to take back. Stock only goes down when accepted goods actually leave the warehouse."}</T>}
        actions={
          <Link href="/admin/purchase-returns/new" className={btn("primary")}>
            <Plus className="size-4" /> <T>{"New return request"}</T>
          </Link>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {Object.entries(VIEWS).map(([k, { label }]) => (
          <Link key={k} href={`/admin/purchase-returns?view=${k}`} className={btn(view === k ? "primary" : "ghost", "sm")}>
            <Tx>{label}</Tx>
          </Link>
        ))}
      </div>
      <Card className="overflow-x-auto">
        {!rows.length ? (
          <EmptyState icon={Undo2} title="No purchase returns here">
            {"Start one from a goods receipt when goods are faulty or not needed."}
          </EmptyState>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium"><T>{"Return"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Reason"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Supplier's answer"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Status"}</T></th>
                <th className="px-4 py-2.5 text-right font-medium"><T>{"Refunded"}</T></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, supplier, grn }) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/purchase-returns/${r.id}`} className="font-semibold text-blue-700 hover:underline">{r.returnNumber}</Link>
                    <p className="text-xs text-slate-500">{supplier} · {grn} · <Tx>{prettyDate(r.returnDate)}</Tx></p>
                  </td>
                  <td className="px-2 py-2.5 text-slate-600"><Tx>{r.returnReason}</Tx></td>
                  <td className="px-2 py-2.5">
                    <Badge tone={SUPPLIER_RESPONSE[r.supplierStatus].tone}><Tx>{SUPPLIER_RESPONSE[r.supplierStatus].label}</Tx></Badge>
                    {r.refundMethod && <p className="mt-0.5 text-[11px] text-slate-400"><Tx>{RESOLUTION_LABEL[r.refundMethod]}</Tx></p>}
                  </td>
                  <td className="px-2 py-2.5"><Badge tone={RETURN_STATUS[r.status].tone}><Tx>{RETURN_STATUS[r.status].label}</Tx></Badge></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.refundAmount ? money(r.refundAmount) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
