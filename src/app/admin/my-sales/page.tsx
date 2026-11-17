import { ArrowLeft, ClipboardPen, Coins, Sparkles, Store, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import type { Metadata } from "next";
import { T } from "@/components/i18n";
import Link from "@/components/link";
import { Card, CardHeader, cx } from "@/components/ui";
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
import { CountUp, DayBars, ShareBar } from "./stats-ui";

export const metadata: Metadata = { title: "My Sales" };

const RANGES = [7, 30, 90] as const;
const OUTCOME_COLOR: Record<VisitOutcome, string> = { ordered: "#10b981", interested: "#3b82f6", thinking: "#f59e0b", samples: "#6366f1", not_in: "#94a3b8", not_now: "#fb7185" };

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
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {office && rep && (
            <Link href={`/admin/my-sales?days=${days}`} className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
              <ArrowLeft className="size-4" /> <T>{"Sales team"}</T>
            </Link>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {!office ? <T>{"My Sales"}</T> : rep ? rep.name : <T>{"Sales team"}</T>}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            <T vars={{ n: days }}>{"Last {n} days"}</T>
          </p>
        </div>
        <nav className="inline-flex rounded-full bg-slate-100 p-1 text-sm font-medium" aria-label="Period">
          {RANGES.map((d) => (
            <Link
              key={d}
              href={q({ days: String(d) })}
              aria-current={d === days ? "page" : undefined}
              className={cx("rounded-full px-3.5 py-1.5 transition-all duration-200", d === days ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
            >
              <T vars={{ n: d }}>{"{n} days"}</T>
            </Link>
          ))}
        </nav>
      </header>

      {team && <Team team={team} days={days} />}
      {stats && <RepView stats={stats} />}
    </div>
  );
}

function Team({ team, days }: { team: Awaited<ReturnType<typeof teamStats>>; days: number }) {
  if (!team.length)
    return (
      <Card className="px-5 py-10 text-center text-sm text-slate-500">
        <T>{"Nobody sells yet. Give a staff member the sales job and their numbers show here."}</T>
      </Card>
    );
  const best = Math.max(1, ...team.map((r) => r.salesCents));
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {team.map((r, i) => (
        <li key={r.id} className="animate-rise" style={{ animationDelay: `${i * 50}ms` }}>
          <Link
            href={`/admin/my-sales?days=${days}&rep=${r.id}`}
            className="block rounded-2xl border border-line bg-white p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-pop"
          >
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-navy-800 text-sm font-semibold text-white">{r.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{r.name}</p>
                <p className="text-xs text-slate-500">
                  <T vars={{ n: r.visits }}>{r.visits === 1 ? "1 visit" : "{n} visits"}</T> · <T vars={{ n: r.won }}>{"{n} won"}</T>
                  {r.orderRate !== null && (
                    <>
                      {" · "}
                      <T vars={{ pct: r.orderRate }}>{"{pct}% ordered"}</T>
                    </>
                  )}
                </p>
              </div>
              {i === 0 && r.salesCents > 0 && <Trophy className="size-4 text-amber-500" />}
            </div>
            <p className="mt-3 text-xl font-semibold text-slate-900 tabular-nums">{aud(r.salesCents)}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full origin-left animate-grow-x rounded-full bg-emerald-500" style={{ width: `${(r.salesCents / best) * 100}%`, animationDelay: `${150 + i * 50}ms` }} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RepView({ stats: st }: { stats: RepStats }) {
  const trend = st.sales.prevCents >= 20_000 ? Math.round(((st.sales.cents - st.sales.prevCents) / st.sales.prevCents) * 100) : null;
  const figures = [
    {
      icon: ClipboardPen,
      tint: "bg-blue-50 text-blue-600",
      label: "Visits & calls",
      value: <CountUp value={st.visits.total} />,
      hint: <T vars={{ stores: st.visits.stores, calls: st.visits.calls }}>{"{stores} stores · {calls} by phone"}</T>,
    },
    {
      icon: Store,
      tint: "bg-emerald-50 text-emerald-600",
      label: "Stores won",
      value: <CountUp value={st.won.length} />,
      hint: st.visits.orderRate !== null ? <T vars={{ pct: st.visits.orderRate }}>{"{pct}% of visits ended in an order"}</T> : <T>{"Log visits to see how they go"}</T>,
    },
    {
      icon: Sparkles,
      tint: "bg-violet-50 text-violet-600",
      label: "First orders",
      value: <CountUp value={st.firstOrders.length} />,
      hint: <T>{"New stores that placed their first order"}</T>,
    },
    {
      icon: Coins,
      tint: "bg-amber-50 text-amber-600",
      label: "Sales from my customers",
      value: <CountUp value={st.sales.cents} money />,
      hint:
        trend === null ? (
          <T vars={{ n: st.sales.orders }}>{st.sales.orders === 1 ? "1 order" : "{n} orders"}</T>
        ) : (
          <span className={cx("inline-flex items-center gap-1 font-medium", trend >= 0 ? "text-emerald-700" : "text-red-600")}>
            {trend >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            <T vars={{ pct: `${trend >= 0 ? "+" : ""}${trend}` }}>{"{pct}% on the days before"}</T>
          </span>
        ),
    },
  ];
  const stageMax = Math.max(1, ...SALES_STAGES.map((s) => st.pipeline[s]));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {figures.map((f, i) => (
          <div key={f.label} className="animate-rise rounded-2xl border border-line bg-white p-4 shadow-card" style={{ animationDelay: `${i * 60}ms` }}>
            <span className={cx("grid size-9 place-items-center rounded-xl", f.tint)}>
              <f.icon className="size-[18px]" />
            </span>
            <p className="mt-3 text-xs font-medium text-slate-500">
              <T>{f.label}</T>
            </p>
            <p className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">{f.value}</p>
            <p className="mt-1 text-xs text-slate-500">{f.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="animate-rise p-4 [animation-delay:200ms]">
          <p className="text-sm font-semibold text-slate-900">
            <T>{"Visits per day"}</T>
          </p>
          <DayBars series={st.series} kind="visits" />
        </Card>
        <Card className="animate-rise p-4 [animation-delay:260ms]">
          <p className="text-sm font-semibold text-slate-900">
            <T>{"Sales per day"}</T>
          </p>
          <DayBars series={st.series} kind="sales" />
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="animate-rise p-4 [animation-delay:320ms]">
          <p className="mb-3 text-sm font-semibold text-slate-900">
            <T>{"How visits went"}</T>
          </p>
          {st.visits.total ? (
            <ShareBar parts={VISIT_OUTCOMES.map((o) => ({ key: o, label: OUTCOMES[o].label, n: st.visits.byOutcome[o] ?? 0, color: OUTCOME_COLOR[o] }))} />
          ) : (
            <p className="text-sm text-slate-500">
              <T>{"No visits logged in these days."}</T>
            </p>
          )}
        </Card>
        <Card className="animate-rise p-4 [animation-delay:380ms]">
          <p className="mb-3 text-sm font-semibold text-slate-900">
            <T>{"My customers now"}</T>
          </p>
          <ul className="space-y-2">
            {SALES_STAGES.map((s, i) => (
              <li key={s} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-3 text-sm">
                <span className="truncate text-slate-600">
                  <T>{STAGE_INFO[s].label}</T>
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full origin-left animate-grow-x rounded-full"
                    style={{ width: `${(st.pipeline[s] / stageMax) * 100}%`, background: STAGE_COLOR[s], animationDelay: `${400 + i * 60}ms` }}
                  />
                </span>
                <span className="text-right font-semibold text-slate-900 tabular-nums">{st.pipeline[s]}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <NameList title="Stores won" empty="None in these days yet." items={st.won} />
        <NameList title="First orders" empty="None in these days yet." items={st.firstOrders} />
        <NameList title="Top customers" empty="No sales in these days" items={st.top.map((t) => ({ id: t.id, name: t.name, right: aud(t.cents) }))} />
      </div>
    </div>
  );
}

function NameList({ title, empty, items }: { title: string; empty: string; items: { id: string; name: string; right?: string }[] }) {
  return (
    <Card className="animate-rise overflow-hidden [animation-delay:440ms]">
      <CardHeader title={<T>{title}</T>} />
      {items.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-slate-500">
          <T>{empty}</T>
        </p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {items.slice(0, 8).map((x) => (
            <li key={x.id}>
              <Link href={`/admin/customers/${x.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50">
                <span className="truncate font-medium text-slate-800">{x.name}</span>
                {x.right && <span className="shrink-0 text-slate-600 tabular-nums">{x.right}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
