import { and, desc, eq, ne } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { salesOrders } from "@/lib/db/schema";
import { aud, PAYMENT_METHOD_LABEL, PAYMENT_TERMS_LABEL } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";
import { PaymentPill, Pill } from "../badges";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const viewer = await getCurrentCustomer();
  if (!viewer) return null;
  const { customer: c } = viewer;
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const rows = await db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.customerId, c.id), ne(salesOrders.status, "cancelled")))
    .orderBy(desc(salesOrders.createdAt))
    .limit(200);
  const unpaid = rows.filter((r) => r.paymentStatus === "unpaid");
  const owing = unpaid.reduce((t, r) => t + r.totalCents, 0);
  const overdue = unpaid.filter((r) => r.dueDate && r.dueDate < today);

  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Invoices &amp; payments</h1>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Owing" value={aud(owing)} hint={`${unpaid.length} unpaid invoice${unpaid.length === 1 ? "" : "s"}`} />
        <Stat label="Overdue" value={aud(overdue.reduce((t, r) => t + r.totalCents, 0))} hint={overdue.length ? `${overdue.length} past due` : "Nothing overdue"} warn={overdue.length > 0} />
        <Stat
          label="Account terms"
          value={PAYMENT_TERMS_LABEL[c.paymentTerms]}
          hint={c.creditLimitCents !== null ? `Credit available ${aud(Math.max(0, c.creditLimitCents - owing))}` : "No credit limit set"}
        />
      </div>
      <div className="mt-5 overflow-x-auto rounded-2xl border border-leaf-950/10 bg-white">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-leaf-50/60 text-left text-xs text-leaf-900/60">
            <tr>
              <th className="px-4 py-2.5 font-medium">Invoice</th>
              <th className="px-2 py-2.5 font-medium">Method</th>
              <th className="px-2 py-2.5 font-medium">Due</th>
              <th className="px-2 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-leaf-950/5">
                <td className="px-4 py-3">
                  <Link href={`/portal/orders/${r.id}/invoice`} className="font-semibold text-leaf-700 hover:underline">
                    {r.number}
                  </Link>
                  <span className="block text-xs text-leaf-900/50">{prettyDate(r.createdAt.toISOString().slice(0, 10))}</span>
                </td>
                <td className="px-2 py-3 text-leaf-900/70">{PAYMENT_METHOD_LABEL[r.paymentMethod]}</td>
                <td className="px-2 py-3 text-leaf-900/70">{r.dueDate ? prettyDate(r.dueDate) : "—"}</td>
                <td className="px-2 py-3">
                  {r.paymentStatus === "unpaid" && r.dueDate && r.dueDate < today ? <Pill tone="red">Overdue</Pill> : <PaymentPill s={r.paymentStatus} />}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{aud(r.totalCents)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-leaf-900/50">
                  No invoices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl border border-leaf-950/10 bg-white p-4">
      <p className="text-xs font-medium text-leaf-900/55">{label}</p>
      <p className={`mt-1 font-display text-xl font-semibold tabular-nums ${warn ? "text-red-700" : ""}`}>{value}</p>
      <p className="mt-0.5 text-xs text-leaf-900/55">{hint}</p>
    </div>
  );
}
