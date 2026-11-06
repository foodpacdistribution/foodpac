import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { Badge } from "@/components/ui";
import { CREDIT_TYPE } from "@/lib/customer-return-labels";
import type { CreditTransactionType } from "@/lib/db/schema";
import { money } from "@/lib/purchasing/labels";

type Tx_ = { id: string; transactionNumber: string; transactionType: CreditTransactionType; amount: number; balanceAfter: number; sourceType: string; sourceId: string | null; sourceNumber: string | null; description: string | null; by?: string | null; when: string };

/** Every store credit movement: where it came from or went, and the balance after. */
export function CreditHistory({ rows, staff }: { rows: Tx_[]; staff: boolean }) {
  const href = (t: Tx_) =>
    !staff || !t.sourceId ? null : t.sourceType === "customer_return" ? `/admin/customer-returns/${t.sourceId}` : t.sourceType === "sales_order" ? `/admin/sales/${t.sourceId}` : null;
  const portalHref = (t: Tx_) => (staff || !t.sourceId || t.sourceType !== "sales_order" ? null : `/portal/orders/${t.sourceId}`);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium"><T>{"Date"}</T></th>
            <th className="px-2 py-2 font-medium"><T>{"Type"}</T></th>
            <th className="px-2 py-2 font-medium"><T>{"From / for"}</T></th>
            <th className="px-2 py-2 text-right font-medium"><T>{"Amount"}</T></th>
            <th className="px-4 py-2 text-right font-medium"><T>{"Balance"}</T></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const link = href(t) ?? portalHref(t);
            return (
              <tr key={t.id} className="border-t border-line">
                <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                  {t.when}
                  <p className="text-[11px] text-slate-400">{t.transactionNumber}{staff && t.by && ` · ${t.by}`}</p>
                </td>
                <td className="px-2 py-2"><Badge tone={CREDIT_TYPE[t.transactionType].tone}><Tx>{CREDIT_TYPE[t.transactionType].label}</Tx></Badge></td>
                <td className="px-2 py-2 text-slate-600">
                  {t.sourceNumber && (link ? <Link href={link} className="font-medium text-blue-700 hover:underline">{t.sourceNumber}</Link> : t.sourceNumber)}
                  {t.description && <p className="text-xs text-slate-500"><Tx>{t.description}</Tx></p>}
                </td>
                <td className={`px-2 py-2 text-right font-semibold tabular-nums ${t.amount > 0 ? "text-emerald-700" : "text-slate-700"}`}>{t.amount > 0 ? `+${money(t.amount)}` : `−${money(-t.amount)}`}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(t.balanceAfter)}</td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-slate-500"><T>{"No store credit yet."}</T></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
