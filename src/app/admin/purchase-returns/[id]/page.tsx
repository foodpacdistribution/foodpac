import { asc, desc, eq } from "drizzle-orm";
import { ArrowLeft, Check, HandCoins } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addSupplierRefund } from "@/app/actions/purchasing";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { MoneyForm } from "@/components/purchasing-ui";
import { Badge, Card, CardHeader, cx } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { goodsReceipts, purchaseReturnItems, purchaseReturnPhotos, purchaseReturns, supplierRefunds, suppliers, users } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { isUuid } from "@/lib/purchasing/common";
import { GRN_STATUS, money, PAY_METHOD_LABEL, qtyText, RESOLUTION_LABEL, RETURN_STATUS, SUPPLIER_RESPONSE, toCents, unitMoney } from "@/lib/purchasing/labels";
import { refundPosition } from "@/lib/purchasing/returns";
import { todayIn } from "@/lib/time";
import { DispatchForm, ReturnButtons, SupplierResponseForm } from "./return-steps";

export const metadata: Metadata = { title: "Purchase Return" };

export default async function PurchaseReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser(STAFF);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = await getDb();
  const [row] = await db
    .select({ r: purchaseReturns, supplier: suppliers, grn: goodsReceipts })
    .from(purchaseReturns)
    .innerJoin(suppliers, eq(suppliers.id, purchaseReturns.supplierId))
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, purchaseReturns.goodsReceiptId))
    .where(eq(purchaseReturns.id, id))
    .limit(1);
  if (!row) notFound();
  const { r, supplier, grn } = row;
  const [items, photos, refunds, replacements, people, s, pos] = await Promise.all([
    db.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.purchaseReturnId, id)).orderBy(asc(purchaseReturnItems.name)),
    db.select({ id: purchaseReturnPhotos.id }).from(purchaseReturnPhotos).where(eq(purchaseReturnPhotos.purchaseReturnId, id)),
    db.select().from(supplierRefunds).where(eq(supplierRefunds.purchaseReturnId, id)).orderBy(asc(supplierRefunds.refundDate)),
    db.select().from(goodsReceipts).where(eq(goodsReceipts.purchaseReturnId, id)).orderBy(desc(goodsReceipts.createdAt)),
    db.select({ id: users.id, name: users.name }).from(users),
    getSettings(db),
    refundPosition(db, id),
  ]);
  const who = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" });
  const today = todayIn(s.timezone);
  const answered = r.supplierStatus !== "pending";
  const accepted = r.supplierStatus === "accepted" || r.supplierStatus === "partially_accepted";
  const draftReplacement = replacements.find((g) => g.status === "draft");

  const steps = [
    { label: "Request created", done: true, when: fmt.format(r.createdAt), by: who(r.createdBy) },
    { label: "Supplier's answer", done: answered, when: r.respondedAt ? fmt.format(r.respondedAt) : null, by: who(r.approvedBy) },
    { label: "Sent back · stock reduced", done: !!r.dispatchedAt, when: r.dispatchedAt ? fmt.format(r.dispatchedAt) : null, by: who(r.dispatchedBy), skip: r.supplierStatus === "rejected" },
    { label: r.refundMethod === "exchange" ? "Replacements received" : "Refund received", done: r.status === "closed" && !!r.dispatchedAt, when: r.closedAt && r.dispatchedAt ? fmt.format(r.closedAt) : null, skip: r.supplierStatus === "rejected" },
  ];

  return (
    <>
      <Link href="/admin/purchase-returns" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> <T>{"Purchase Returns"}</T>
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900"><T>{"Purchase return"}</T> {r.returnNumber}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {supplier.name} · <T>{"from"}</T> <Link href={`/admin/goods-receipts/${grn.id}`} className="text-blue-700 hover:underline">{grn.grnNumber}</Link> · <Tx>{prettyDate(r.returnDate)}</Tx>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={SUPPLIER_RESPONSE[r.supplierStatus].tone}><Tx>{SUPPLIER_RESPONSE[r.supplierStatus].label}</Tx></Badge>
            <Badge tone={RETURN_STATUS[r.status].tone}><Tx>{RETURN_STATUS[r.status].label}</Tx></Badge>
            {r.refundMethod && <Badge tone="slate"><Tx>{RESOLUTION_LABEL[r.refundMethod]}</Tx></Badge>}
          </div>
        </div>
        <ReturnButtons id={r.id} status={r.status} refundMethod={r.refundMethod} today={today} draftReplacement={draftReplacement?.id ?? null} />
      </div>

      <ol className="mb-4 grid gap-2 sm:grid-cols-4">
        {steps.map((st, i) => (
          <li key={i} className={cx("rounded-xl border px-3 py-2 text-xs", st.skip ? "border-dashed border-line text-slate-400" : st.done ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-line bg-white text-slate-500")}>
            <p className="flex items-center gap-1 font-semibold">
              {st.done && !st.skip && <Check className="size-3.5" />} {i + 1}. <Tx>{st.label}</Tx>
            </p>
            {st.when && !st.skip && <p className="mt-0.5">{st.when}{st.by && ` · ${st.by}`}</p>}
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <Card className="overflow-x-auto">
            <CardHeader title={<T>{"Products"}</T>} />
            <table className="w-full min-w-[600px] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium"><T>{"Product"}</T></th>
                  <th className="px-2 py-2 text-right font-medium"><T>{"Asked"}</T></th>
                  <th className="px-2 py-2 text-right font-medium"><T>{"Accepted"}</T></th>
                  <th className="px-2 py-2 text-right font-medium"><T>{"Sent back"}</T></th>
                  {r.refundMethod === "exchange" && <th className="px-2 py-2 text-right font-medium"><T>{"Replaced"}</T></th>}
                  <th className="px-4 py-2 text-right font-medium"><T>{"Unit cost"}</T></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t border-line">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{it.name}</p>
                      <p className="text-xs text-slate-500">{it.sku}{it.reason && ` · ${it.reason}`}</p>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{qtyText(it.requestedQty)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{qtyText(it.acceptedQty)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{qtyText(it.dispatchedQty)}</td>
                    {r.refundMethod === "exchange" && <td className="px-2 py-2.5 text-right tabular-nums">{qtyText(it.replacedQty)}</td>}
                    <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">{unitMoney(it.unitCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {r.status === "open" && (
            <SupplierResponseForm
              id={r.id}
              answered={answered}
              response={r.supplierResponse}
              resolution={r.refundMethod}
              lines={items.map((it) => ({ id: it.id, sku: it.sku, name: it.name, requested: it.requestedQty, accepted: it.acceptedQty }))}
            />
          )}
          {r.status === "open" && accepted && <DispatchForm id={r.id} lines={items.filter((it) => (it.acceptedQty ?? 0) > 0).map((it) => ({ id: it.id, sku: it.sku, name: it.name, unit: it.unit, accepted: it.acceptedQty ?? 0 }))} />}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={<T>{"Request"}</T>} />
            <div className="space-y-2 p-4 text-sm text-slate-600">
              <p><span className="font-medium text-slate-900"><Tx>{r.returnReason}</Tx></span></p>
              {r.notes && <p className="whitespace-pre-wrap">{r.notes}</p>}
              {r.supplierResponse && (
                <p className="rounded-lg bg-slate-50 p-2 whitespace-pre-wrap"><span className="font-medium"><T>{"Supplier:"}</T></span> {r.supplierResponse}</p>
              )}
              {photos.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {photos.map((p) => (
                    <a key={p.id} href={`/api/purchase-returns/${r.id}/photos/${p.id}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/purchase-returns/${r.id}/photos/${p.id}`} alt="" className="size-20 rounded-lg border border-line object-cover" />
                    </a>
                  ))}
                </div>
              )}
              {supplier.email && <p className="pt-1 text-xs"><T>{"Supplier email:"}</T> <a href={`mailto:${supplier.email}?subject=${encodeURIComponent(`Return request ${r.returnNumber}`)}`} className="text-blue-700 hover:underline">{supplier.email}</a></p>}
            </div>
          </Card>

          {r.dispatchedAt && r.refundMethod !== "exchange" && (
            <Card>
              <CardHeader
                title={<T>{"Refund from supplier"}</T>}
                action={
                  me.role === "admin" && r.status === "dispatched" && toCents(pos.outstanding) > 0 ? (
                    <MoneyForm action={addSupplierRefund} title="Record refund from supplier" buttonLabel={<><HandCoins className="size-3.5" /> <T>{"Record refund"}</T></>} idField="purchaseReturnId" options={[{ id: r.id, label: r.returnNumber, outstanding: pos.outstanding }]} today={today} variant="secondary" />
                  ) : undefined
                }
              />
              <ul className="divide-y divide-line text-sm">
                <li className="flex justify-between px-4 py-2.5 text-slate-600"><span><T>{"Due for goods sent back (incl. GST)"}</T></span><span className="tabular-nums">{money(pos.due)}</span></li>
                {refunds.map((f) => (
                  <li key={f.id} className="flex justify-between px-4 py-2.5">
                    <span>
                      <span className="font-medium">{f.refundNumber}</span>{" "}
                      <span className="text-xs text-slate-500"><Tx>{prettyDate(f.refundDate)}</Tx> · <Tx>{PAY_METHOD_LABEL[f.method]}</Tx>{f.reference && ` · ${f.reference}`}</span>
                    </span>
                    <span className="tabular-nums">{money(f.amount)}</span>
                  </li>
                ))}
                <li className="flex justify-between px-4 py-2.5 font-medium"><span><T>{"Still to be refunded"}</T></span><span className="tabular-nums">{money(pos.outstanding)}</span></li>
              </ul>
            </Card>
          )}
          {r.refundMethod === "exchange" && r.dispatchedAt && (
            <Card>
              <CardHeader title={<T>{"Replacement goods"}</T>} />
              <ul className="divide-y divide-line text-sm">
                {replacements.map((g) => (
                  <li key={g.id} className="flex items-center justify-between px-4 py-2.5">
                    <Link href={`/admin/goods-receipts/${g.id}`} className="font-medium text-blue-700 hover:underline">{g.grnNumber}</Link>
                    <Badge tone={GRN_STATUS[g.status].tone}><Tx>{GRN_STATUS[g.status].label}</Tx></Badge>
                  </li>
                ))}
                {!replacements.length && <li className="px-4 py-4 text-slate-500"><T>{"Waiting for the supplier to send replacements."}</T></li>}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
