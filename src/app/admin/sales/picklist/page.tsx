import { and, asc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { PrintButton } from "@/components/print-button";
import { btn, Card } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { customers, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { T, Tx } from "@/components/i18n";

export const metadata: Metadata = { title: "Pick list" };

/** Warehouse pick list: totals per product (pick once), then each order's lines (pack per customer). */
export default async function PickListPage({ searchParams }: { searchParams: Promise<{ ids?: string; date?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const ids = (sp.ids ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 300);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : null;
  const db = await getDb();
  const so = await db
    .select({ so: salesOrders, customer: customers.name })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.status, "confirmed"), ids.length ? inArray(salesOrders.id, ids) : eq(salesOrders.deliveryDate, date ?? "")))
    .orderBy(asc(salesOrders.number));
  const items = so.length
    ? await db.select().from(salesOrderItems).where(inArray(salesOrderItems.salesOrderId, so.map((r) => r.so.id))).orderBy(asc(salesOrderItems.sku))
    : [];
  const totals = new Map<string, { sku: string; name: string; packSize: string; unit: string; qty: number }>();
  for (const it of items) {
    const t = totals.get(it.sku) ?? { sku: it.sku, name: it.name, packSize: it.packSize, unit: it.unit, qty: 0 };
    t.qty += it.qty;
    totals.set(it.sku, t);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight"><T>{"Pick list"}</T></h1>
          <p className="text-sm text-slate-500">
            {so.length} {" "}<T>{"confirmed order"}</T>{so.length === 1 ? "" : "s"}
            {date && !ids.length && ` for delivery ${prettyDate(date)}`}
          </p>
        </div>
        <PrintButton className={btn("primary", "md", "no-print")} />
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="w-10 px-4 py-2" />
              <th className="px-2 py-2 font-medium"><T>{"SKU"}</T></th>
              <th className="px-2 py-2 font-medium"><T>{"Product"}</T></th>
              <th className="px-4 py-2 text-right font-medium"><T>{"Total to pick"}</T></th>
            </tr>
          </thead>
          <tbody>
            {[...totals.values()].map((t) => (
              <tr key={t.sku} className="border-b border-line last:border-0">
                <td className="px-4 py-2">
                  <span className="inline-block size-4 rounded border border-slate-400" />
                </td>
                <td className="px-2 py-2 font-mono text-xs">{t.sku}</td>
                <td className="px-2 py-2">
                  {t.name} <span className="text-xs text-slate-500">· {t.packSize}</span>
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">
                  {t.qty} {t.unit}
                </td>
              </tr>
            ))}
            {!totals.size && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  <T>{"Nothing to pick."}</T></td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
        {so.map(({ so: o, customer }) => (
          <Card key={o.id} className="break-inside-avoid p-4">
            <p className="font-semibold">
              {o.number} · {customer}
            </p>
            <p className="text-xs text-slate-500">
              {<Tx>{prettyDate(o.deliveryDate)}</Tx>} · {o.address}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {items
                .filter((i) => i.salesOrderId === o.id)
                .map((i) => (
                  <li key={i.id} className="flex justify-between gap-3">
                    <span>
                      <span className="mr-2 inline-block size-3 rounded-sm border border-slate-400 align-middle" />
                      {i.name}
                    </span>
                    <span className="font-medium tabular-nums">
                      {i.qty} {i.unit}
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
