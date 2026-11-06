import { eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Tx } from "@/components/i18n";
import { Card } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { goodsReceipts, purchaseOrderItems, purchaseOrders } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { isUuid } from "@/lib/purchasing/common";
import { poEditBlocker } from "@/lib/purchasing/orders";
import { todayIn } from "@/lib/time";
import { poFormData } from "../../form-data";
import { PoForm } from "../../po-form";

export const metadata: Metadata = { title: "Edit Purchase Order" };

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(STAFF);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = await getDb();
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
  if (!po) notFound();
  const [[{ n }], items, s, data] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(goodsReceipts).where(eq(goodsReceipts.purchaseOrderId, id)),
    db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id)),
    getSettings(db),
    poFormData(db, po.supplierId),
  ]);
  const blocked = poEditBlocker(po, n);
  if (blocked) return <Card className="p-6 text-sm text-slate-600"><Tx>{blocked}</Tx></Card>;
  return (
    <PoForm
      {...data}
      today={todayIn(s.timezone)}
      po={{
        id: po.id,
        poNumber: po.poNumber,
        supplierId: po.supplierId,
        supplierLocked: po.status !== "draft",
        orderDate: po.orderDate,
        expectedDate: po.expectedDate,
        supplierReference: po.supplierReference,
        notes: po.notes,
        lines: items.filter((i) => i.productId).map((i) => ({ productId: i.productId!, qty: i.orderedQty, unitCost: i.unitCost })),
      }}
    />
  );
}
