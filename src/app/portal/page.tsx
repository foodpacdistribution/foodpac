import { ArrowRight, CalendarClock, Heart, MapPin, Pencil, Phone, Receipt, ShoppingBag, Truck, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { siteInfo } from "@/app/(site)/site-info";
import { ProductCard } from "@/app/(site)/shop-ui";
import { cx } from "@/components/ui";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { linkOrdersToCustomer } from "@/lib/customers";
import { prettyDate } from "@/lib/dates";
import { creditBalance } from "@/lib/credit";
import { getDb } from "@/lib/db";
import { aud, PAYMENT_TERMS_LABEL } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { canSeePrices, listSize, recentlyBought } from "@/lib/shop";
import { formatMinutesClock, todayIn } from "@/lib/time";
import { StageSteps } from "./stage";
import { Pill } from "./badges";
import { listSalesOrders } from "./orders/data";
import { RepeatOrder } from "./repeat-order";
import { SalesOrderList } from "./orders/list";
import { T, Tx } from "@/components/i18n";

export const metadata: Metadata = { title: "My account" };

function greeting(timeZone: string) {
  const h = Number(new Intl.DateTimeFormat("en-AU", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function PortalOverview() {
  const viewer = await getCurrentCustomer();
  if (!viewer) return null;
  const { customer: c, user } = viewer;
  const db = await getDb();
  await linkOrdersToCustomer(db, c);
  const s = await getSettings(db);
  const site = siteInfo(s);
  const today = todayIn(s.timezone);
  const [orders, again, storeCredit, list] = await Promise.all([listSalesOrders(db, c.id, 60), recentlyBought(db, c, 4), creditBalance(db, c.id), listSize(db, c.id)]);

  const month = today.slice(0, 7);
  const monthOf = (d: Date) => todayIn(s.timezone, d).slice(0, 7);
  const live = orders.filter((o) => o.status !== "cancelled");
  const thisMonth = live.filter((o) => monthOf(o.createdAt) === month);
  const open = live.filter((o) => o.delivery?.stage !== "delivered");
  const unpaid = live.filter((o) => o.paymentStatus === "unpaid");
  const owing = unpaid.reduce((t, o) => t + o.totalCents - o.creditAppliedCents, 0);
  const overdue = unpaid.filter((o) => o.dueDate && o.dueDate < today);
  const onTheWay = live.filter((o) => o.delivery?.stage === "out_for_delivery");
  const next = live
    .filter((o) => o.deliveryDate >= today && o.delivery?.stage !== "delivered" && o.delivery?.stage !== "failed")
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))[0];
  const creditLeft = c.creditLimitCents !== null ? Math.max(0, c.creditLimitCents - owing) : null;

  return (
    <>

      {/* Who's signed in and their account, as a plain heading; the shop is one tap away. */}
      <section className="stagger pt-2" style={{ "--i": 0 } as React.CSSProperties}>
        <p className="text-sm text-leaf-900/55">
          <T>{greeting(s.timezone)}</T>, {user.name.split(" ")[0]}
        </p>
        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight break-words sm:text-4xl">{c.name}</h1>
            <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-leaf-900/65">
              <Pill tone={c.approved ? "green" : "amber"}>{c.approved ? "Approved trade account" : "Awaiting approval"}</Pill>
              <span>
                <T>{PAYMENT_TERMS_LABEL[c.paymentTerms]}</T>
              </span>
              {storeCredit > 0 && (
                <Link href="/portal/invoices" className="underline decoration-leaf-950/20 underline-offset-[3px] hover:decoration-leaf-950">
                  <T vars={{ amount: aud(Math.round(storeCredit * 100)) }}>{"Store credit {amount}"}</T>
                </Link>
              )}
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Link href="/products" className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-leaf-800 px-5 text-sm font-semibold text-white transition-colors hover:bg-leaf-900 sm:flex-none">
              <ShoppingBag className="size-4" /> <T>{"Shop now"}</T>
            </Link>
            <Link href="/portal/quick-order" className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold ring-1 ring-leaf-950/20 transition-colors ring-inset hover:bg-white sm:flex-none">
              <Zap className="size-4" /> <T>{"Quick order"}</T>
            </Link>
          </div>
        </div>
        {creditLeft !== null && c.creditLimitCents! > 0 && (
          <div className="mt-6 max-w-sm">
            <div className="flex justify-between text-xs text-leaf-900/60">
              <span>
                <T>{"Credit available"}</T>
              </span>
              <span className="tabular-nums">
                {aud(creditLeft)} <T>{"of"}</T> {aud(c.creditLimitCents)}
              </span>
            </div>
            <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-leaf-950/8">
              <div className="h-full origin-left animate-[grow-x_900ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-md bg-leaf-800" style={{ width: `${Math.round((creditLeft / c.creditLimitCents!) * 100)}%` }} />
            </div>
          </div>
        )}
      </section>

      {onTheWay.map((o) => (
        <Link
          key={o.id}
          href={`/portal/track/${o.deliveryOrderId}`}
          className="mt-4 flex items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
        >
          <span className="relative grid size-9 place-items-center rounded-full bg-amber-400 text-white">
            <Truck className="size-4" />
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/40" />
          </span>
          <span className="flex-1 text-sm">
            <span className="font-semibold">{o.number} {" "}<T>{"is on the way."}</T></span> {" "}<T>{"Track the van live."}</T></span>
          <ArrowRight className="size-4" />
        </Link>
      ))}

      {/* No orders yet and their salesperson set up their list: that's the quickest first order. */}
      {live.length === 0 && list.fromRep > 0 && canSeePrices(c) && (
        <Link href="/portal/list" className="mt-4 flex items-center gap-3 rounded-2xl bg-leaf-50 px-4 py-3 text-leaf-900 ring-1 ring-leaf-700/20 hover:bg-leaf-100">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-leaf-800 text-white">
            <Heart className="size-4" />
          </span>
          <span className="flex-1 text-sm">
            <span className="font-semibold">
              <T vars={{ n: list.n }}>{list.n === 1 ? "Your list is ready: 1 product at your price." : "Your list is ready: {n} products at your prices."}</T>
            </span>{" "}
            <T>{"Check the quantities and order them in one go."}</T>
          </span>
          <ArrowRight className="size-4" />
        </Link>
      )}

      <div className="stagger mt-8 grid grid-cols-2 border-y border-leaf-950/10 lg:grid-cols-4" style={{ "--i": 1 } as React.CSSProperties}>
        <Stat label={<T>{"Orders this month"}</T>} value={String(thisMonth.length)} />
        <Stat label={<T>{"Spent this month"}</T>} value={aud(thisMonth.reduce((t, o) => t + o.totalCents, 0))} hint={<T>{"incl. GST"}</T>} />
        <Stat label={<T>{"Open orders"}</T>} value={String(open.length)} hint={<T>{"Not delivered yet"}</T>} />
        <Stat
          label={<T>{"To pay"}</T>}
          value={aud(owing)}
          hint={overdue.length ? `${overdue.length} overdue` : unpaid.length ? `${unpaid.length} invoice${unpaid.length === 1 ? "" : "s"}` : "All paid up"}
          warn={overdue.length > 0}
          href="/portal/invoices"
        />
      </div>

      <div className="stagger mt-10 grid gap-10 lg:grid-cols-[1fr_300px]" style={{ "--i": 2 } as React.CSSProperties}>
        <div className="min-w-0 space-y-10">
          {next && (
            <section>
              <SectionTitle title={<T>{"Next delivery"}</T>} />
              <Link href={`/portal/orders/${next.id}`} className="press mt-3 block rounded-2xl bg-white/70 p-6 ring-1 ring-leaf-950/8 transition-[box-shadow,background-color] hover:bg-white hover:ring-leaf-950/20">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-display text-xl font-semibold">
                      <CalendarClock className="size-5 text-leaf-700" />
                      {next.deliveryDate === today ? <T>{"Today"}</T> : <Tx>{prettyDate(next.deliveryDate, { weekday: "long", day: "numeric", month: "long" })}</Tx>}
                    </p>
                    <p className="mt-0.5 text-sm text-leaf-900/60">
                      {next.number} · <T vars={{ n: next.items }}>{next.items === 1 ? "{n} item" : "{n} items"}</T>
                      {(next.windowStartMin !== null || next.windowEndMin !== null) &&
                        ` · ${next.windowStartMin !== null ? formatMinutesClock(next.windowStartMin) : "any time"}–${next.windowEndMin !== null ? formatMinutesClock(next.windowEndMin) : "close"}`}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-leaf-800"><T>{"Details →"}</T></span>
                </div>
                {next.delivery && (
                  <div className="mt-5">
                    <StageSteps stage={next.delivery.stage} />
                  </div>
                )}
              </Link>
            </section>
          )}

          {live[0] && canSeePrices(c) && (
            <RepeatOrder
              order={{
                id: live[0].id,
                number: live[0].number,
                date: prettyDate(todayIn(s.timezone, live[0].createdAt), { weekday: "short", day: "numeric", month: "short" }),
                products: live[0].lines,
                totalCents: live[0].totalCents,
              }}
            />
          )}

          {again.length > 0 && (
            <section>
              <SectionTitle title={<T>{"Buy again"}</T>} link={{ href: "/portal/quick-order", label: "Quick order" }} />
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 xl:grid-cols-3">
                {again.map((p) => (
                  <ProductCard key={p.id} p={p} signedIn />
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionTitle title={<T>{"Recent orders"}</T>} link={{ href: "/portal/orders", label: "All orders" }} />
            {orders.length ? (
              <SalesOrderList rows={orders.slice(0, 5)} />
            ) : (
              <div className="mt-3 border-y border-leaf-950/10 px-6 py-12 text-center">
                <p className="font-semibold"><T>{"No orders yet"}</T></p>
                <p className="mt-1 text-sm text-leaf-900/60"><T>{"Your first order is a few clicks away."}</T></p>
                <Link href="/products" className="mt-4 inline-flex h-10 items-center rounded-md bg-leaf-800 px-5 text-sm font-semibold text-white">
                  <T>{"Browse products"}</T></Link>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl bg-white/70 p-6 text-sm ring-1 ring-leaf-950/8">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold"><T>{"Account details"}</T></h2>
              <Link href="/portal/profile" className="inline-flex items-center gap-1 text-xs font-medium text-leaf-800 hover:underline">
                <Pencil className="size-3" /> {" "}<T>{"Edit"}</T></Link>
            </div>
            <dl className="mt-3 space-y-2.5 text-leaf-900/75">
              <Detail label={<T>{"Contact"}</T>} value={`${user.name} · ${user.email}`} />
              {c.phone && <Detail label={<T>{"Phone"}</T>} value={c.phone} />}
              {c.address && <Detail label={<T>{"Delivery address"}</T>} value={c.address} />}
              {c.abn && <Detail label={<T>{"ABN"}</T>} value={c.abn} />}
            </dl>
            <div className="mt-5 flex gap-5 border-t border-leaf-950/8 pt-4 text-xs font-medium">
              <Link href="/portal/addresses" className="flex items-center gap-1.5 text-leaf-800 hover:underline">
                <MapPin className="size-3.5" /> <T>{"Addresses"}</T>
              </Link>
              <Link href="/portal/invoices" className="flex items-center gap-1.5 text-leaf-800 hover:underline">
                <Receipt className="size-3.5" /> <T>{"Invoices"}</T>
              </Link>
            </div>
          </div>
          <div className="rounded-2xl bg-[#f1ebdd] p-6 text-sm">
            <h2 className="font-semibold"><T>{"Need a hand?"}</T></h2>
            <p className="mt-1 text-leaf-900/70"><T>{"Changes to an order, a product you can't find, or a delivery question — we're here"}</T>{" "}<T>{site.hours}</T>.</p>
            {site.phone && (
              <a href={`tel:${site.phone.replace(/\s/g, "")}`} className="mt-3 flex items-center gap-2 font-semibold text-leaf-800">
                <Phone className="size-4" /> {site.phone}
              </a>
            )}
            <Link href="/#contact" className="mt-4 inline-flex h-9 items-center rounded-md bg-white px-4 text-xs font-semibold ring-1 ring-leaf-950/10 transition-shadow hover:ring-leaf-950/25">
              <T>{"Send us a message"}</T></Link>
          </div>
        </aside>
      </div>
    </>
  );
}

function SectionTitle({ title, link }: { title: React.ReactNode; link?: { href: string; label: string } }) {
  return (
    <div className="flex items-end justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-leaf-900/50">{<Tx>{title}</Tx>}</h2>
      {link && (
        <Link href={link.href} className="text-sm font-semibold text-leaf-700 hover:underline">
          <T>{link.label}</T>
        </Link>
      )}
    </div>
  );
}

function Stat({ label, value, hint, warn, href }: { label: React.ReactNode; value: string; hint?: React.ReactNode; warn?: boolean; href?: string }) {
  const body = (
    <>
      <p className="text-xs text-leaf-900/55">{<Tx>{label}</Tx>}</p>
      <p className={cx("mt-1.5 font-display text-[26px] leading-none font-semibold tracking-tight tabular-nums", warn && "text-red-700")}>{value}</p>
      {hint && <p className={cx("mt-1.5 text-xs", warn ? "font-semibold text-red-700" : "text-leaf-900/50")}>{<Tx>{hint}</Tx>}</p>}
    </>
  );
  // Four figures in a row (two by two on a phone), divided by hairlines rather than boxed.
  const cls =
    "block border-leaf-950/10 py-5 max-lg:even:border-l max-lg:even:pl-5 max-lg:[&:nth-child(n+3)]:border-t lg:border-l lg:px-6 lg:first:border-l-0 lg:first:pl-0";
  return href ? (
    <Link href={href} className={cx(cls, "transition-colors hover:bg-white/50")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Detail({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-leaf-900/45">{<Tx>{label}</Tx>}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
