import { and, asc, desc, eq, gte, lt, lte, ne, sql } from "drizzle-orm";
import { AlertTriangle, BadgeDollarSign, Clock, Receipt, ShoppingBag, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import { LOW_STOCK } from "@/lib/stock";
import Link from "@/components/link";
import { btn, Card, CardHeader, cx, EmptyState, PageHeader, Stat } from "@/components/ui";
import { T, Tx } from "@/components/i18n";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate, shiftDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { customers, products, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { aud } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";
import { DailyChart } from "./daily-chart";

export const metadata: Metadata = { title: "Sales Report" };

const RANGES = [7, 30, 90] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const days = RANGES.find((d) => String(d) === sp.days) ?? 30;
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const from = shiftDate(today, -(days - 1));
  const prevFrom = shiftDate(from, -days);
  const tz = s.timezone;

  // Order day in the company's timezone, and the period boundaries as instants.
  const day = sql<string>`to_char(${salesOrders.createdAt} at time zone ${tz}, 'YYYY-MM-DD')`;
  const at = (d: string) => sql`(${d}::timestamp at time zone ${tz})`;
  const live = ne(salesOrders.status, "cancelled");
  const inPeriod = and(live, gte(salesOrders.createdAt, at(from)), lt(salesOrders.createdAt, at(shiftDate(today, 1))));

  const [daily, [prev], topProducts, topCustomers, [money], lowStock] = await Promise.all([
    db
      .select({ day, cents: sql<number>`sum(${salesOrders.totalCents})::int`, orders: sql<number>`count(*)::int` })
      .from(salesOrders)
      .where(inPeriod)
      // By position: the timezone is a separate parameter in each copy of the expression.
      .groupBy(sql`1`),
    db
      .select({ cents: sql<number>`coalesce(sum(${salesOrders.totalCents}), 0)::int`, orders: sql<number>`count(*)::int` })
      .from(salesOrders)
      .where(and(live, gte(salesOrders.createdAt, at(prevFrom)), lt(salesOrders.createdAt, at(from)))),
    db
      .select({
        sku: salesOrderItems.sku,
        name: salesOrderItems.name,
        qty: sql<number>`sum(${salesOrderItems.qty})::int`,
        cents: sql<number>`sum(${salesOrderItems.lineCents})::int`,
      })
      .from(salesOrderItems)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
      .where(inPeriod)
      .groupBy(salesOrderItems.sku, salesOrderItems.name)
      .orderBy(desc(sql`sum(${salesOrderItems.lineCents})`))
      .limit(8),
    db
      .select({ id: customers.id, name: customers.name, cents: sql<number>`sum(${salesOrders.totalCents})::int`, orders: sql<number>`count(*)::int` })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(inPeriod)
      .groupBy(customers.id, customers.name)
      .orderBy(desc(sql`sum(${salesOrders.totalCents})`))
      .limit(8),
    db
      .select({
        unpaid: sql<number>`coalesce(sum(${salesOrders.totalCents}) filter (where ${salesOrders.paymentStatus} = 'unpaid'), 0)::int`,
        unpaidCount: sql<number>`(count(*) filter (where ${salesOrders.paymentStatus} = 'unpaid'))::int`,
        overdue: sql<number>`coalesce(sum(${salesOrders.totalCents}) filter (where ${salesOrders.paymentStatus} = 'unpaid' and ${salesOrders.dueDate} < ${today}), 0)::int`,
        overdueCount: sql<number>`(count(*) filter (where ${salesOrders.paymentStatus} = 'unpaid' and ${salesOrders.dueDate} < ${today}))::int`,
      })
      .from(salesOrders)
      .where(live),
    db
      .select({ id: products.id, sku: products.sku, name: products.name, stock: products.stock })
      .from(products)
      .where(and(eq(products.active, true), lte(products.stock, LOW_STOCK)))
      .orderBy(asc(products.stock), asc(products.name))
      .limit(10),
  ]);

  // One bar per day, including days with no sales.
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const series = Array.from({ length: days }, (_, i) => {
    const d = shiftDate(from, i);
    return { day: d, cents: byDay.get(d)?.cents ?? 0, orders: byDay.get(d)?.orders ?? 0 };
  });
  const total = series.reduce((t, d) => t + d.cents, 0);
  const orderCount = series.reduce((t, d) => t + d.orders, 0);
  const change = prev.cents > 0 ? Math.round(((total - prev.cents) / prev.cents) * 100) : null;
  const topMax = Math.max(1, ...topProducts.map((p) => p.cents));
  const custMax = Math.max(1, ...topCustomers.map((c) => c.cents));

  return (
    <>
      <PageHeader
        title={<T>{"Sales Report"}</T>}
        subtitle={<T>{"Shop sales, best sellers, top customers and money owed. Cancelled orders are left out."}</T>}
        actions={
          <div className="flex gap-1">
            {RANGES.map((d) => (
              <Link key={d} href={`/admin/reports?days=${d}`} className={btn(d === days ? "primary" : "secondary", "sm")}>
                <T vars={{ n: d }}>{"{n} days"}</T>
              </Link>
            ))}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={<T>{"Sales"}</T>}
          value={aud(total)}
          icon={TrendingUp}
          tone="green"
          hint={change === null ? <T>{"No sales in the period before"}</T> : <T vars={{ pct: `${change > 0 ? "+" : ""}${change}%` }}>{"{pct} vs the period before"}</T>}
        />
        <Stat label={<T>{"Orders"}</T>} value={orderCount} icon={ShoppingBag} hint={<T vars={{ n: prev.orders }}>{"{n} in the period before"}</T>} />
        <Stat label={<T>{"Average order"}</T>} value={aud(orderCount ? Math.round(total / orderCount) : 0)} icon={Receipt} tone="violet" />
        <Stat
          label={<T>{"Unpaid"}</T>}
          value={aud(money.unpaid)}
          icon={money.overdue > 0 ? AlertTriangle : Clock}
          tone={money.overdue > 0 ? "red" : "amber"}
          hint={money.overdueCount > 0 ? <T vars={{ n: money.overdueCount, amount: aud(money.overdue) }}>{"{n} overdue · {amount}"}</T> : <T vars={{ n: money.unpaidCount }}>{"{n} invoices open, none overdue"}</T>}
        />
      </div>

      <Card className="mb-4">
        <CardHeader title={<T>{"Sales per day"}</T>} subtitle={<T>{"Including GST, by the day the order was placed. Hover a bar for the figures."}</T>} />
        {total === 0 ? (
          <EmptyState icon={BadgeDollarSign} title={<T>{"No sales in this period"}</T>}>
            <T>{"Orders placed in the online shop show up here."}</T>
          </EmptyState>
        ) : (
          <DailyChart series={series} today={today} />
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={<T>{"Best sellers"}</T>} subtitle={<T>{"By sales value in this period"}</T>} />
          {topProducts.length === 0 ? (
            <p className="p-4 text-sm text-slate-500"><T>{"Nothing sold yet."}</T></p>
          ) : (
            <RankList
              rows={topProducts.map((p) => ({ key: p.sku, label: p.name, sub: <Tx>{`${p.sku} · ${p.qty} units`}</Tx>, cents: p.cents }))}
              max={topMax}
            />
          )}
        </Card>
        <Card>
          <CardHeader title={<T>{"Top customers"}</T>} subtitle={<T>{"By sales value in this period"}</T>} />
          {topCustomers.length === 0 ? (
            <p className="p-4 text-sm text-slate-500"><T>{"No orders yet."}</T></p>
          ) : (
            <RankList
              rows={topCustomers.map((c) => ({ key: c.id, label: c.name, sub: <T vars={{ n: c.orders }}>{c.orders === 1 ? "{n} order" : "{n} orders"}</T>, cents: c.cents }))}
              max={custMax}
            />
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title={<T>{"Running low"}</T>}
            subtitle={<T vars={{ n: LOW_STOCK }}>{"Products in the shop with {n} or fewer left"}</T>}
            action={
              <Link href="/admin/products" className="text-xs font-medium text-blue-700 hover:underline">
                <T>{"Products & Stock"}</T> →
              </Link>
            }
          />
          {lowStock.length === 0 ? (
            <p className="p-4 text-sm text-slate-500"><T>{"Everything is well stocked."}</T></p>
          ) : (
            <ul className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-2 sm:divide-y-0">
              {lowStock.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm sm:border-b sm:border-line">
                  <span className="min-w-0">
                    <span className="block truncate text-slate-900">{p.name}</span>
                    <span className="text-xs text-slate-500">{p.sku}</span>
                  </span>
                  <span className={cx("shrink-0 font-semibold tabular-nums", p.stock <= 0 ? "text-red-600" : "text-amber-700")}>
                    {p.stock <= 0 ? <T>{"Sold out"}</T> : <T vars={{ n: p.stock }}>{"{n} left"}</T>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="mt-4 text-xs text-slate-400">
        <Tx>{`${prettyDate(from)} – ${prettyDate(today)}`}</Tx>
      </p>
    </>
  );
}

/** Ranked bars: the label and value are text; the bar only shows the size. */
function RankList({ rows, max }: { rows: { key: string; label: string; sub: React.ReactNode; cents: number }[]; max: number }) {
  return (
    <ol className="space-y-3 px-4 pb-4">
      {rows.map((r, i) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              <span className="mr-1.5 text-xs tabular-nums text-slate-400">{i + 1}</span>
              <span className="text-slate-900">{r.label}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-900">{aud(r.cents)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(2, (r.cents / max) * 100)}%` }} />
            </div>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">{r.sub}</p>
        </li>
      ))}
    </ol>
  );
}
