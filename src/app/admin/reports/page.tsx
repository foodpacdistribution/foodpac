import { and, asc, desc, eq, gte, lt, lte, ne, sql } from "drizzle-orm";
import { AlertTriangle, BadgeDollarSign, Clock, Hourglass, Receipt, ShoppingBag, TrendingUp, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import { LOW_STOCK } from "@/lib/stock";
import Link from "@/components/link";
import { btn, Card, CardHeader, cx, EmptyState, PageHeader, Stat } from "@/components/ui";
import { T, Tx } from "@/components/i18n";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { productCosts, profitOf } from "@/lib/costs";
import { prettyDate, shiftDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { customers, products, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { aud } from "@/lib/money";
import { newCustomerFunnel } from "@/lib/new-customers";
import { getSettings } from "@/lib/planning";
import { startOfDayIn, todayIn } from "@/lib/time";
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

  const [daily, [prev], topProducts, topCustomers, [money], lowStock, sold] = await Promise.all([
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
        productId: sql<string | null>`(array_agg(${salesOrderItems.productId}))[1]`,
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
        unpaid: sql<number>`coalesce(sum(${salesOrders.totalCents} - ${salesOrders.creditAppliedCents}) filter (where ${salesOrders.paymentStatus} = 'unpaid'), 0)::int`,
        unpaidCount: sql<number>`(count(*) filter (where ${salesOrders.paymentStatus} = 'unpaid'))::int`,
        overdue: sql<number>`coalesce(sum(${salesOrders.totalCents} - ${salesOrders.creditAppliedCents}) filter (where ${salesOrders.paymentStatus} = 'unpaid' and ${salesOrders.dueDate} < ${today}), 0)::int`,
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
    // Every line sold in the period, by customer, product and price: for profit and below-cost sales.
    db
      .select({
        customerId: salesOrders.customerId,
        customer: customers.name,
        productId: salesOrderItems.productId,
        name: salesOrderItems.name,
        unitPriceCents: salesOrderItems.unitPriceCents,
        qty: sql<number>`sum(${salesOrderItems.qty})::int`,
        cents: sql<number>`sum(${salesOrderItems.lineCents})::int`,
      })
      .from(salesOrderItems)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(inPeriod)
      .groupBy(salesOrders.customerId, customers.name, salesOrderItems.productId, salesOrderItems.name, salesOrderItems.unitPriceCents),
  ]);
  const [costs, funnel] = await Promise.all([
    productCosts(db, today, [...new Set(sold.map((l) => l.productId).filter((id): id is string => !!id))]),
    newCustomerFunnel(db, startOfDayIn(tz, from), startOfDayIn(tz, shiftDate(today, 1))),
  ]);
  const profit = profitOf(sold, costs);
  const profitBy = (key: (l: (typeof sold)[number]) => string) => {
    const groups = new Map<string, typeof sold>();
    for (const l of sold) groups.set(key(l), [...(groups.get(key(l)) ?? []), l]);
    return new Map([...groups].map(([k, ls]) => [k, profitOf(ls, costs)]));
  };
  const byProduct = profitBy((l) => l.productId ?? "");
  const byCustomer = profitBy((l) => l.customerId);
  // Sold for less than it costs us: by customer and product, worst loss first.
  const belowCost = sold
    .flatMap((l) => {
      const c = l.productId ? costs.get(l.productId) : undefined;
      return c && l.unitPriceCents < c.cents ? [{ ...l, costCents: c.cents, lossCents: Math.round((c.cents - l.unitPriceCents) * l.qty) }] : [];
    })
    .sort((a, b) => b.lossCents - a.lossCents);
  const uncostedPct = profit.soldCents + profit.uncostedCents > 0 ? Math.round((profit.uncostedCents / (profit.soldCents + profit.uncostedCents)) * 100) : 0;
  const pctNote = (pct: number | null) => (pct === null ? "" : pct < 0 ? " · below cost" : ` · ${pct}% margin`);

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

      <Card className="mb-4">
        <CardHeader
          title={<T>{"Gross profit"}</T>}
          subtitle={<T>{"Goods sold ex GST, less what they cost us (average cost of goods received, else the cost on the product). Delivery fees and credit left out."}</T>}
        />
        <dl className="grid grid-cols-2 gap-2 px-4 pb-4 lg:grid-cols-4">
          {[
            ["Goods sold (ex GST)", aud(profit.soldCents), "text-slate-900"],
            ["Cost of goods", aud(profit.costCents), "text-slate-900"],
            ["Gross profit", aud(profit.profitCents), profit.profitCents < 0 ? "text-red-600" : "text-emerald-700"],
            ["Margin", profit.marginPct === null ? "—" : `${profit.marginPct}%`, "text-slate-900"],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-xs text-slate-500"><Tx>{label}</Tx></dt>
              <dd className={cx("mt-0.5 text-lg font-semibold tabular-nums", tone)}>{value}</dd>
            </div>
          ))}
        </dl>
        {profit.uncostedCents > 0 && (
          <p className="mx-4 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="size-3.5 shrink-0" />
            <T vars={{ amount: aud(profit.uncostedCents), pct: uncostedPct }}>{"{amount} of sales ({pct}%) is on products with no cost yet, so it's left out of the margin."}</T>
            <Link href="/admin/products" className="font-medium text-amber-950 underline">
              <T>{"Add costs to products"}</T>
            </Link>
          </p>
        )}
      </Card>

      {belowCost.length > 0 && (
        <Card className="mb-4 border-red-200">
          <CardHeader
            title={<span className="text-red-800"><T>{"Sold below cost"}</T></span>}
            subtitle={<T>{"Prices lower than what the product costs us. Check the customer's price list."}</T>}
          />
          <ul className="divide-y divide-line border-t border-line">
            {belowCost.slice(0, 12).map((l) => (
              <li key={`${l.customerId}:${l.productId}:${l.unitPriceCents}`}>
                <Link href={`/admin/customers/${l.customerId}/prices`} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-red-50/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-900">{l.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {l.customer} · <T vars={{ n: l.qty, price: aud(l.unitPriceCents), cost: aud(Math.round(l.costCents)) }}>{"{n} at {price}, cost {cost}"}</T>
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-red-600">−{aud(l.lossCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={<T>{"Best sellers"}</T>} subtitle={<T>{"By sales value in this period"}</T>} />
          {topProducts.length === 0 ? (
            <p className="p-4 text-sm text-slate-500"><T>{"Nothing sold yet."}</T></p>
          ) : (
            <RankList
              rows={topProducts.map((p) => ({
                key: p.sku,
                label: p.name,
                sub: <Tx>{`${p.sku} · ${p.qty} units${pctNote(p.productId && costs.has(p.productId) ? (byProduct.get(p.productId)?.marginPct ?? null) : null)}`}</Tx>,
                cents: p.cents,
              }))}
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
              rows={topCustomers.map((c) => ({
                key: c.id,
                label: c.name,
                sub: (
                  <>
                    <T vars={{ n: c.orders }}>{c.orders === 1 ? "{n} order" : "{n} orders"}</T>
                    {(() => {
                      const p = byCustomer.get(c.id);
                      return p && p.soldCents > 0 ? <Tx>{` · ${aud(p.profitCents)} gross profit${pctNote(p.marginPct)}`}</Tx> : null;
                    })()}
                  </>
                ),
                cents: c.cents,
              }))}
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
        <Card className="lg:col-span-2">
          <CardHeader
            title={<T>{"New customers"}</T>}
            subtitle={<T>{"Accounts opened in this period: how many can order and how many have. Website sign-ups are counted from 17 Nov 2026."}</T>}
          />
          <dl className="grid grid-cols-2 gap-2 px-4 lg:grid-cols-4">
            {(
              [
                ["Accounts opened", funnel.opened, funnel.online ? `${funnel.online} signed up on the website` : null],
                ["Can order", funnel.approved, funnel.daysToApproval !== null ? `approved in ${dayCount(funnel.daysToApproval)} (median)` : null],
                ["Have ordered", funnel.ordered, funnel.opened ? `${Math.round((funnel.ordered / funnel.opened) * 100)}% of new accounts` : null],
                ["Days to first order", funnel.daysToFirstOrder === null ? "—" : dayCount(funnel.daysToFirstOrder), funnel.ordered ? "median" : null],
              ] as const
            ).map(([label, value, hint]) => (
              <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
                <dt className="text-xs text-slate-500"><Tx>{label}</Tx></dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900"><Tx>{String(value)}</Tx></dd>
                {hint && <dd className="text-[11px] text-slate-500"><Tx>{hint}</Tx></dd>}
              </div>
            ))}
          </dl>
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Hourglass className="size-4 text-amber-600" /> <T vars={{ n: funnel.waiting.length }}>{"Waiting for approval ({n})"}</T>
              </p>
              {funnel.waiting.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500"><T>{"Nobody is waiting. Sign-ups get an email as soon as they're approved."}</T></p>
              ) : (
                <ul className="mt-1.5 divide-y divide-line text-sm">
                  {funnel.waiting.slice(0, 6).map((c) => (
                    <li key={c.id}>
                      <Link href={`/admin/customers/${c.id}`} className="flex justify-between gap-3 py-1.5 hover:text-blue-700">
                        <span className="truncate">{c.name}</span>
                        <span className={cx("shrink-0 text-xs tabular-nums", c.days >= 1 ? "font-semibold text-red-600" : "text-slate-500")}>
                          <Tx>{c.days === 0 ? "today" : `${c.days} days`}</Tx>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <UserPlus className="size-4 text-blue-600" /> <T>{"Can order, haven't yet"}</T>
              </p>
              {funnel.noOrder.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500"><T>{"Every new account from the last two months has ordered."}</T></p>
              ) : (
                <ul className="mt-1.5 divide-y divide-line text-sm">
                  {funnel.noOrder.map((c) => (
                    <li key={c.id}>
                      <Link href={`/admin/customers/${c.id}`} className="flex justify-between gap-3 py-1.5 hover:text-blue-700">
                        <span className="truncate">{c.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-500"><Tx>{c.days === 0 ? "today" : `${c.days} days`}</Tx></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {funnel.reminders.sent > 0 && (
            <p className="mx-4 mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <T vars={{ sent: funnel.reminders.sent, ordered: funnel.reminders.ordered }}>{"Reorder reminders: {sent} sent, {ordered} ordered within a week."}</T>
            </p>
          )}
        </Card>
      </div>
      <p className="mt-4 text-xs text-slate-400">
        <Tx>{`${prettyDate(from)} – ${prettyDate(today)}`}</Tx>
      </p>
    </>
  );
}

/** "under a day", "1 day", "3 days" from a number of days. */
const dayCount = (d: number) => (d < 1 ? "under a day" : Math.round(d) === 1 ? "1 day" : `${Math.round(d)} days`);

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
