"use client";

import { FileText, Plus, Search, X } from "lucide-react";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, cx, EmptyState, inputCls, PageHeader, Stat } from "@/components/ui";
import { prettyDate } from "@/lib/dates";
import { aud } from "@/lib/money";
import { QUOTE_STATUS, type QuoteState } from "@/lib/quote-status";

type Row = {
  id: string;
  number: string;
  customer: string;
  code: string;
  createdAt: string;
  validUntil: string;
  totalCents: number;
  lines: number;
  state: QuoteState;
  order: { id: string; number: string } | null;
};

const VIEWS = [
  ["open", "Open"],
  ["accepted", "Accepted"],
  ["closed", "Declined & expired"],
  ["all", "All"],
] as const;

export function QuotesClient({ rows, view, q, stats }: { rows: Row[]; view: string; q: string; stats: { openCount: number; openCents: number; accepted90: number; decided90: number } }) {
  const tr = useT();
  return (
    <>
      <PageHeader
        title={tr("Quotations")}
        subtitle={tr("Price quotes for one customer. Edit them until the customer says yes, then turn the quote into a sales order in one step.")}
        actions={
          <Link href="/admin/quotes/new" className={btn("primary")}>
            <Plus className="size-4" /> {tr("New quote")}
          </Link>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={tr("Open quotes")} value={stats.openCount} icon={FileText} tone="violet" />
        <Stat label={tr("Open value")} value={aud(stats.openCents)} hint={tr("Incl. GST")} />
        <Stat label={tr("Won (90 days)")} value={stats.decided90 ? `${Math.round((stats.accepted90 / stats.decided90) * 100)}%` : "—"} hint={tr("{a} of {n} decided quotes accepted", { a: stats.accepted90, n: stats.decided90 })} tone="green" />
      </div>

      <form action="/admin/quotes" className="mb-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="view" value={view} />
        <label className="relative w-full sm:w-72">
          <span className="sr-only">{tr("Search")}</span>
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
          <input type="search" name="q" defaultValue={q} placeholder={tr("Quote number, customer or code")} className={cx(inputCls, "pl-9")} />
        </label>
        <button className={btn("secondary")}>{tr("Search")}</button>
        {q && (
          <Link href={`/admin/quotes?view=${view}`} className={btn("ghost")}>
            <X className="size-4" /> {tr("Clear")}
          </Link>
        )}
      </form>
      <div className="mb-3 flex flex-wrap gap-1">
        {VIEWS.map(([v, label]) => (
          <Link key={v} href={`/admin/quotes?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={btn(view === v ? "primary" : "ghost", "sm")}>
            {tr(label)}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={FileText} title={q ? tr("No quotes match") : view === "open" ? tr("No open quotes") : tr("No quotes here")}>
            {tr("Make a quote for a customer from here or from their card on the Customers page.")}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Phones: one card per quote. */}
          <ul className="divide-y divide-line sm:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/quotes/${r.id}`} className="block px-4 py-3 active:bg-slate-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{r.number}</span>
                    <Badge tone={QUOTE_STATUS[r.state].tone}>{tr(QUOTE_STATUS[r.state].label)}</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-slate-700">
                    {r.customer} <span className="font-mono text-xs text-slate-400">{r.code}</span>
                  </p>
                  <p className="mt-0.5 flex justify-between text-xs text-slate-500">
                    <span>{tr("Valid until {date}", { date: tr(prettyDate(r.validUntil, { day: "numeric", month: "short" })) })}</span>
                    <span className="font-semibold tabular-nums text-slate-900">{aud(r.totalCents)}</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-sm sm:table">
            <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">{tr("Quote")}</th>
                <th className="px-2 py-2 font-medium">{tr("Customer")}</th>
                <th className="px-2 py-2 font-medium">{tr("Made")}</th>
                <th className="px-2 py-2 font-medium">{tr("Valid until")}</th>
                <th className="px-2 py-2 text-right font-medium">{tr("Products")}</th>
                <th className="px-2 py-2 text-right font-medium">{tr("Total")}</th>
                <th className="px-4 py-2 font-medium">{tr("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/quotes/${r.id}`} className="font-medium text-blue-700 hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td className="max-w-64 px-2 py-2.5">
                    <span className="block truncate">{r.customer}</span>
                    <span className="font-mono text-xs text-slate-400">{r.code}</span>
                  </td>
                  <td className="px-2 py-2.5 text-slate-600">{tr(new Date(r.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" }))}</td>
                  <td className={cx("px-2 py-2.5", r.state === "expired" ? "text-amber-700" : "text-slate-600")}>{tr(prettyDate(r.validUntil, { day: "numeric", month: "short", year: "numeric" }))}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{r.lines}</td>
                  <td className="px-2 py-2.5 text-right font-medium tabular-nums">{aud(r.totalCents)}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={QUOTE_STATUS[r.state].tone}>{tr(QUOTE_STATUS[r.state].label)}</Badge>
                      {r.order && (
                        <Link href={`/admin/sales/${r.order.id}`} className="text-xs text-blue-700 hover:underline">
                          → {r.order.number}
                        </Link>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
