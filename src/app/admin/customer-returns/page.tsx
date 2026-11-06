import { desc, eq, inArray } from "drizzle-orm";
import { Plus, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { CUSTOMER_RESOLUTION, CUSTOMER_RETURN_REASON, CUSTOMER_RETURN_STATUS } from "@/lib/customer-return-labels";
import { getDb } from "@/lib/db";
import { customerReturns, type CustomerReturnStatus, customers, salesOrders } from "@/lib/db/schema";
import { money } from "@/lib/purchasing/labels";
import { getSettings } from "@/lib/planning";

export const metadata: Metadata = { title: "Customer Returns" };

const VIEWS: Record<string, { label: string; statuses?: CustomerReturnStatus[] }> = {
  open: { label: "Open", statuses: ["requested", "received"] },
  completed: { label: "Completed", statuses: ["completed"] },
  all: { label: "All" },
};

export default async function CustomerReturnsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const view = VIEWS[sp.view ?? ""] ? sp.view! : "open";
  const db = await getDb();
  const [rows, s] = await Promise.all([
    db
      .select({ r: customerReturns, customer: customers.name, order: salesOrders.number })
      .from(customerReturns)
      .innerJoin(customers, eq(customers.id, customerReturns.customerId))
      .innerJoin(salesOrders, eq(salesOrders.id, customerReturns.salesOrderId))
      .where(VIEWS[view].statuses ? inArray(customerReturns.status, VIEWS[view].statuses!) : undefined)
      .orderBy(desc(customerReturns.createdAt))
      .limit(300),
    getSettings(db),
  ]);
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "medium" });

  return (
    <>
      <PageHeader
        title={<T>{"Customer Returns"}</T>}
        subtitle={<T>{"Goods customers send back. They're checked in before anything goes back on the shelf, then refunded, turned into store credit, or exchanged."}</T>}
        actions={
          <Link href="/admin/customer-returns/new" className={btn("primary")}>
            <Plus className="size-4" /> <T>{"New customer return"}</T>
          </Link>
        }
      />
      <div className="mb-3 flex gap-2">
        {Object.entries(VIEWS).map(([k, { label }]) => (
          <Link key={k} href={`/admin/customer-returns?view=${k}`} className={btn(view === k ? "primary" : "ghost", "sm")}>
            <Tx>{label}</Tx>
          </Link>
        ))}
      </div>
      <Card className="overflow-x-auto">
        {!rows.length ? (
          <EmptyState icon={RotateCcw} title="No customer returns here">
            {"Start one from a delivered order, or with New customer return."}
          </EmptyState>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium"><T>{"Return"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Reason"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Customer gets"}</T></th>
                <th className="px-2 py-2.5 font-medium"><T>{"Status"}</T></th>
                <th className="px-4 py-2.5 text-right font-medium"><T>{"Value"}</T></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, customer, order }) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/customer-returns/${r.id}`} className="font-semibold text-blue-700 hover:underline">{r.returnNumber}</Link>
                    <p className="text-xs text-slate-500">{customer} · {order} · {fmt.format(r.createdAt)}</p>
                  </td>
                  <td className="px-2 py-2.5 text-slate-600"><Tx>{CUSTOMER_RETURN_REASON[r.reason]}</Tx></td>
                  <td className="px-2 py-2.5 text-slate-600"><Tx>{CUSTOMER_RESOLUTION[r.resolution].label}</Tx></td>
                  <td className="px-2 py-2.5"><Badge tone={CUSTOMER_RETURN_STATUS[r.status].tone}><Tx>{CUSTOMER_RETURN_STATUS[r.status].label}</Tx></Badge></td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
