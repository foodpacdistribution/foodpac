import { and, desc, eq, inArray } from "drizzle-orm";
import { ClipboardList, Plus } from "lucide-react";
import type { Metadata } from "next";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { purchaseOrders, type PurchaseOrderStatus, suppliers } from "@/lib/db/schema";
import { money, PO_STATUS, paymentState } from "@/lib/purchasing/labels";
import { paidByPo } from "@/lib/purchasing/orders";
import { isUuid } from "@/lib/purchasing/common";

export const metadata: Metadata = { title: "Purchase Orders" };

const VIEWS: Record<string, { label: string; statuses?: PurchaseOrderStatus[] }> = {
  open: { label: "Open", statuses: ["draft", "sent", "confirmed", "partially_received"] },
  received: { label: "Received", statuses: ["received", "closed"] },
  cancelled: { label: "Cancelled", statuses: ["cancelled"] },
  all: { label: "All" },
};

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ view?: string; supplier?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const view = VIEWS[sp.view ?? ""] ? sp.view! : "open";
  const supplier = sp.supplier && isUuid(sp.supplier) ? sp.supplier : null;
  const db = await getDb();
  const rows = await db
    .select({ po: purchaseOrders, supplier: suppliers.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(VIEWS[view].statuses ? inArray(purchaseOrders.status, VIEWS[view].statuses!) : undefined, supplier ? eq(purchaseOrders.supplierId, supplier) : undefined))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(300);
  const paid = await paidByPo(db, rows.map((r) => r.po.id));

  return (
    <>
      <PageHeader
        title={<T>{"Purchase Orders"}</T>}
        subtitle={<T>{"What we've ordered from suppliers. Goods go into stock when they're booked in on a goods receipt."}</T>}
        actions={
          <Link href="/admin/purchase-orders/new" className={btn("primary")}>
            <Plus className="size-4" /> <T>{"New purchase order"}</T>
          </Link>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {Object.entries(VIEWS).map(([v, { label }]) => (
          <Link key={v} href={`/admin/purchase-orders?view=${v}${supplier ? `&supplier=${supplier}` : ""}`} className={btn(view === v ? "primary" : "ghost", "sm")}>
            <Tx>{label}</Tx>
          </Link>
        ))}
      </div>
      <Card className="overflow-x-auto">
        {!rows.length ? (
          <EmptyState icon={ClipboardList} title="No purchase orders here">
            {"Create a purchase order to buy stock from a supplier."}
          </EmptyState>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium"><T>{"Purchase order"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Ordered"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Expected"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Status"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Payment"}</T></th>
                <th className="px-4 py-2.5 text-right font-medium"><T>{"Total"}</T></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ po, supplier: name }) => {
                const pay = paymentState(po.total, paid.get(po.id) ?? 0);
                return (
                  <tr key={po.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/purchase-orders/${po.id}`} className="font-semibold text-blue-700 hover:underline">
                        {po.poNumber}
                      </Link>
                      <p className="text-xs text-slate-500">{name}</p>
                    </td>
                    <td className="px-2 py-2.5"><Tx>{prettyDate(po.orderDate)}</Tx></td>
                    <td className="px-2 py-2.5">{po.expectedDate ? <Tx>{prettyDate(po.expectedDate)}</Tx> : "—"}</td>
                    <td className="px-2 py-2.5">
                      <Badge tone={PO_STATUS[po.status].tone}><Tx>{PO_STATUS[po.status].label}</Tx></Badge>
                    </td>
                    <td className="px-2 py-2.5">{po.status === "draft" || po.status === "cancelled" ? "—" : <Badge tone={pay.tone}><Tx>{pay.label}</Tx></Badge>}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(po.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
