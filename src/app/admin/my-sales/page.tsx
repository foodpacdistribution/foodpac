import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { ViewTransition } from "react";
import { T } from "@/components/i18n";
import Link from "@/components/link";
import { Card, cx } from "@/components/ui";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { STAGE_COLOR } from "@/lib/customer-map";
import { shiftDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import type { VisitOutcome } from "@/lib/db/schema";
import { aud } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { type RepStats, repStats, salesPeople, teamStats } from "@/lib/rep-stats";
import { SALES_STAGES, STAGE_INFO } from "@/lib/sales-stage";
import { todayIn } from "@/lib/time";
import { OUTCOMES, VISIT_OUTCOMES } from "@/lib/visits";
import { DayBars, ShareBar } from "./stats-ui";

export const metadata: Metadata = { title: "My Sales" };

const RANGES = [7, 30, 90] as const;
/** Visit results in a quiet palette: green for orders, blues for interest, greys and rose for the rest. */
const OUTCOME_COLOR: Record<VisitOutcome, string> = { ordered: "#059669", interested: "#2563eb", samples: "#60a5fa", thinking: "#94a3b8", not_in: "#cbd5e1", not_now: "#fda4af" };

/**
 * What a salesperson did and what came of it, over the last 7, 30 or 90 days. Sales staff see
 * their own; the office sees the team, and each salesperson's page from there.
 */
export default async function MySalesPage({ searchParams }: { searchParams: Promise<{ days?: string; rep?: string }> }) {
  const me = await requireUser(PIPELINE);
  const sp = await searchParams;
  const days = RANGES.find((d) => String(d) === sp.days) ?? 30;
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const period = { from: shiftDate(today, -(days - 1)), to: today, timeZone: s.timezone };
  const office = me.role !== "sales";
  const people = office ? await salesPeople(db) : [];
  const rep = !office ? { id: me.id, name: me.name } : (people.find((p) => p.id === sp.rep) ?? null);
  const [stats, team] = await Promise.all([rep ? repStats(db, rep.id, period) : null, office && !rep ? teamStats(db, period) : null]);
  const q = (extra: Record<string, string>) => `/admin/my-sales?${new URLSearchParams({ days: String(days), ...(rep && office ? { rep: rep.id } : {}), ...extra })}`;

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          {office && rep && (
            <Link href={`/admin/my-sales?days=${days}`} className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
              <ArrowLeft className="size-4" /> <T>{"Sales team"}</T>
            </Link>
          )}
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{!office ? <T>{"My Sales"}</T> : rep ? rep.name : <T>{"Sales team"}</T>}</h1>
        </div>
        <nav className="inline-flex rounded-lg border border-line bg-white p-0.5 text-sm" aria-label="Period">
          {RANGES.map((d) => (
            <Link
              key={d}
              href={q({ days: String(d) })}
              aria-current={d === days ? "page" : undefined}
              className={cx("rounded-md px-3 py-1 transition-colors duration-150", d === days ? "bg-slate-900 font-medium text-white" : "text-slate-600 hover:text-slate-900")}
            >
              <T vars={{ n: d }}>{"{n} days"}</T>
            </Link>
          ))}
        </nav>
      </header>

      {/* A new period swaps in with a short crossfade. */}
      <ViewTransition key={days} enter="stats-swap" exit="stats-swap" default="none">
        <div>
          {team && <Team team={team} days={days} />}
          {stats && <RepView stats={stats} />}
        </div>
      </ViewTransition>
    </div>
  );
}

const th = "px-4 py-2.5 text-xs font-medium text-slate-500";

function Team({ team, days }: { team: Awaited<ReturnType<typeof teamStats>>; days: number }) {
  if (!team.length)
    return (
      <Card className="px-5 py-10 text-center text-sm text-slate-500">
        <T>{"Nobody sells yet. Give a staff member the sales job and their numbers show here."}</T>
      </Card>
    );
  const total = team.reduce((t, r) => t + r.salesCents, 0);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="border-b border-line bg-slate-50/70 text-left">
          <tr>
            <th className={th}>
              <T>{"Salesperson"}</T>
            </th>
            <th className={cx(th, "text-right")}>
              <T>{"Visits & calls"}</T>
            </th>
            <th className={cx(th, "text-right")}>
              <T>{"Ordered on the visit"}</T>
            </th>
            <th className={cx(th, "text-right")}>
              <T>{"Stores won"}</T>
            </th>
            <th className={cx(th, "text-right")}>
              <T>{"Sales from their customers"}</T>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {team.map((r) => (
            <tr key={r.id} className="transition-colors hover:bg-slate-50">
              <td className="px-4 py-3">
                <Link href={`/admin/my-sales?days=${days}&rep=${r.id}`} className="font-medium text-slate-900 hover:text-blue-700">
                  {r.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{r.visits}</td>
              <td className="px-4 py-3 text-right text-slate-600 tabular-nums">{r.orderRate === null ? "—" : `${r.orderRate}%`}</td>
              <td className="px-4 py-3 text-right tabular-nums">{r.won}</td>
              <td className="px-4 py-3 text-right font-medium text-slate-900 tabular-nums">{aud(r.salesCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-line text-slate-600">
          <tr>
            <td className="px-4 py-2.5 text-xs font-medium">
              <T>{"Total"}</T>
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums">{team.reduce((t, r) => t + r.visits, 0)}</td>
            <td />
            <td className="px-4 py-2.5 text-right tabular-nums">{team.reduce((t, r) => t + r.won, 0)}</td>
            <td className="px-4 py-2.5 text-right font-medium text-slate-900 tabular-nums">{aud(total)}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

function RepView({ stats: st }: { stats: RepStats }) {
  const trend = st.sales.prevCents >= 20_000 ? Math.round(((st.sales.cents - st.sales.prevCents) / st.sales.prevCents) * 100) : null;
  const figures = [
    { label: "Visits & calls", value: String(st.visits.total), hint: <T vars={{ stores: st.visits.stores, calls: st.visits.calls }}>{"{stores} stores · {calls} by phone"}</T> },
    {
      label: "Stores won",
      value: String(st.won.length),
      hint: st.visits.orderRate !== null ? <T vars={{ pct: st.visits.orderRate }}>{"{pct}% of visits ended in an order"}</T> : <T>{"Log visits to see how they go"}</T>,
    },
    { label: "First orders", value: String(st.firstOrders.length), hint: <T>{"New stores that placed their first order"}</T> },
    {
      label: "Sales from my customers",
      value: aud(st.sales.cents),
      hint:
        trend === null ? (
          <T vars={{ n: st.sales.orders }}>{st.sales.orders === 1 ? "1 order" : "{n} orders"}</T>
        ) : (
          <span className={cx("font-medium", trend >= 0 ? "text-emerald-700" : "text-red-600")}>
            <T vars={{ pct: `${trend >= 0 ? "+" : ""}${trend}` }}>{"{pct}% on the days before"}</T>
          </span>
        ),
    },
  ];
  const stageMax = Math.max(1, ...SALES_STAGES.map((s) => st.pipeline[s]));

  return (
    <div className="space-y-4">
      {/* The four headline numbers in one strip. */}
      <Card className="grid grid-cols-2 divide-line max-lg:[&>*:nth-child(-n+2)]:border-b lg:grid-cols-4 lg:divide-x [&>*:nth-child(odd)]:max-lg:border-r">
        {figures.map((f) => (
          <div key={f.label} className="border-line px-4 py-4">
            <p className="text-xs font-medium text-slate-500">
              <T>{f.label}</T>
            </p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{f.value}</p>
            <p className="mt-1 text-xs text-slate-500">{f.hint}</p>
          </div>
        ))}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Visits per day">
          <DayBars series={st.series} kind="visits" />
        </Panel>
        <Panel title="Sales per day">
          <DayBars series={st.series} kind="sales" />
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="How visits went">
          {st.visits.total ? (
            <ShareBar parts={VISIT_OUTCOMES.map((o) => ({ key: o, label: OUTCOMES[o].label, n: st.visits.byOutcome[o] ?? 0, color: OUTCOME_COLOR[o] }))} />
          ) : (
            <p className="text-sm text-slate-500">
              <T>{"No visits logged in these days."}</T>
            </p>
          )}
        </Panel>
        <Panel title="My customers now">
          <ul className="space-y-2.5">
            {SALES_STAGES.map((s) => (
              <li key={s} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-3 text-sm">
                <span className="truncate text-slate-600">
                  <T>{STAGE_INFO[s].label}</T>
                </span>
                <span className="h-1.5 overflow-hidden rounded-sm bg-slate-100">
                  <span className="block h-full rounded-sm" style={{ width: `${(st.pipeline[s] / stageMax) * 100}%`, background: STAGE_COLOR[s] }} />
                </span>
                <span className="text-right font-medium text-slate-900 tabular-nums">{st.pipeline[s]}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <NameList title="Stores won" empty="None in these days yet." items={st.won} />
        <NameList title="First orders" empty="None in these days yet." items={st.firstOrders} />
        <NameList title="Top customers" empty="No sales in these days" items={st.top.map((t) => ({ id: t.id, name: t.name, right: aud(t.cents) }))} />
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">
        <T>{title}</T>
      </h2>
      {children}
    </Card>
  );
}

function NameList({ title, empty, items }: { title: string; empty: string; items: { id: string; name: string; right?: string }[] }) {
  return (
    <Card className="overflow-hidden">
      <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-slate-900">
        <T>{title}</T>
      </h2>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">
          <T>{empty}</T>
        </p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {items.slice(0, 8).map((x) => (
            <li key={x.id}>
              <Link href={`/admin/customers/${x.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50">
                <span className="truncate text-slate-800">{x.name}</span>
                {x.right && <span className="shrink-0 text-slate-600 tabular-nums">{x.right}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
