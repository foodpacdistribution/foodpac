import { desc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { Card, CardHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { goodsReceipts, purchaseOrders, suppliers } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { isUuid } from "@/lib/purchasing/common";
import { returnableLines } from "@/lib/purchasing/returns";
import { todayIn } from "@/lib/time";
import { ReturnRequestForm } from "./return-request-form";

export const metadata: Metadata = { title: "New Purchase Return" };

/** Step 1 of a return: pick the goods receipt the goods came in on, then what's going back and why. */
export default async function NewPurchaseReturnPage({ searchParams }: { searchParams: Promise<{ grn?: string }> }) {
  await requireUser(STAFF);
  const { grn: grnId } = await searchParams;
  const db = await getDb();
  const s = await getSettings(db);
  const back = (
    <Link href="/admin/purchase-returns" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
      <ArrowLeft className="size-4" /> <T>{"Purchase Returns"}</T>
    </Link>
  );

  const [grn] = grnId && isUuid(grnId)
    ? await db.select({ grn: goodsReceipts, supplier: suppliers.name, po: purchaseOrders.poNumber }).from(goodsReceipts).innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId)).leftJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.purchaseOrderId)).where(eq(goodsReceipts.id, grnId)).limit(1)
    : [];

  if (!grn || grn.grn.status !== "posted") {
    const recent = await db
      .select({ id: goodsReceipts.id, number: goodsReceipts.grnNumber, date: goodsReceipts.receiptDate, supplier: suppliers.name, po: purchaseOrders.poNumber })
      .from(goodsReceipts)
      .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.purchaseOrderId))
      .where(eq(goodsReceipts.status, "posted"))
      .orderBy(desc(goodsReceipts.receiptDate))
      .limit(100);
    return (
      <>
        {back}
        <h1 className="mb-1 text-xl font-semibold tracking-tight text-slate-900"><T>{"New purchase return"}</T></h1>
        <p className="mb-4 text-sm text-slate-500"><T>{"Choose the goods receipt the goods came in on. The return is checked against what was actually received."}</T></p>
        <Card>
          <CardHeader title={<T>{"Goods received"}</T>} />
          <ul className="divide-y divide-line text-sm">
            {recent.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/purchase-returns/new?grn=${r.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
                  <span>
                    <span className="font-semibold text-blue-700">{r.number}</span> <span className="text-slate-500">{r.supplier}{r.po && ` · ${r.po}`}</span>
                  </span>
                  <span className="text-xs text-slate-500"><Tx>{prettyDate(r.date)}</Tx></span>
                </Link>
              </li>
            ))}
            {!recent.length && <li className="px-4 py-6 text-center text-slate-500"><T>{"No goods have been received into stock yet."}</T></li>}
          </ul>
        </Card>
      </>
    );
  }

  const lines = await returnableLines(db, grn.grn.id);
  return (
    <>
      {back}
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-slate-900"><T>{"New purchase return"}</T></h1>
      <p className="mb-4 text-sm text-slate-500">
        {grn.supplier} · <T>{"from"}</T> {grn.grn.grnNumber}
        {grn.po && ` (${grn.po})`} · <Tx>{prettyDate(grn.grn.receiptDate)}</Tx>
      </p>
      <ReturnRequestForm
        goodsReceiptId={grn.grn.id}
        today={todayIn(s.timezone)}
        lines={lines.map((l) => ({ id: l.id, sku: l.sku, name: l.name, unit: l.unit, received: l.receivedQty, already: l.alreadyReturned, returnable: l.returnable, unitCost: l.unitCost }))}
      />
    </>
  );
}
