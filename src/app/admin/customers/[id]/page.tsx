import {
  ArrowLeft,
  Ban,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  KeyRound,
  Mail,
  MapPin,
  Package,
  Phone,
  RotateCcw,
  ShoppingCart,
  Sparkles,
  Tags,
  Truck,
  UserRound,
  Wallet,
  XCircle,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreditHistory } from "@/components/credit-history";
import { T } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, CardHeader, cx, EmptyState, ORDER_STATUS } from "@/components/ui";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { CUSTOMER_RETURN_STATUS } from "@/lib/customer-return-labels";
import { type CustomerProfile, customerProfile, type TimelineEvent } from "@/lib/customer-profile";
import { getDb } from "@/lib/db";
import { aud, FULFILMENT, PAYMENT_STATUS, PAYMENT_TERMS_LABEL, SALES_STATUS } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { money } from "@/lib/purchasing/labels";
import { quoteState, QUOTE_STATUS } from "@/lib/quote-status";
import { STAGE_INFO } from "@/lib/sales-stage";
import { todayIn } from "@/lib/time";
import { CreditAdjust } from "./credit-adjust";
import { EditCustomer, ProfileTabs } from "./profile-client";

export const metadata: Metadata = { title: "Customer" };

/**
 * One customer, everything about them: details and account, the numbers that matter, and their
 * history (orders, deliveries, quotes, returns, store credit, what they buy). Sales staff see it
 * too, without the office-only parts (prices, invoices, delivery photos, credit adjustments).
 */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser(PIPELINE);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const p = await customerProfile(db, id, today);
  if (!p) notFound();
  const office = me.role !== "sales";
  const c = p.customer;

  const date = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, day: "numeric", month: "short", year: "numeric" });
  const dateTime = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const day = (d: string | null | undefined) => (d ? date.format(new Date(`${d}T12:00:00Z`)) : "—");
  const at = (d: Date | string | null | undefined) => (d ? dateTime.format(new Date(d)) : "—");
  const initials = c.name.replace(/[^A-Za-z0-9一-鿿 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const stage = STAGE_INFO[c.salesStage];
  const st = p.stats;
  const creditLeft = c.creditLimitCents !== null ? c.creditLimitCents - st.unpaidCents : null;

  const tabs = [
    { key: "activity", label: "Activity", panel: <Timeline events={p.timeline} at={at} office={office} /> },
    { key: "orders", label: "Orders", count: p.sales.length, panel: <OrdersTable p={p} day={day} at={at} office={office} /> },
    { key: "deliveries", label: "Deliveries", count: p.deliveries.length, panel: <DeliveriesTable p={p} day={day} at={at} office={office} /> },
    { key: "quotes", label: "Quotes", count: p.quotes.length, panel: <QuotesTable p={p} day={day} today={today} office={office} customerId={c.id} /> },
    { key: "returns", label: "Returns", count: p.returns.length, panel: <ReturnsTable p={p} day={day} at={at} office={office} /> },
    {
      key: "credit",
      label: "Store credit",
      panel: (
        <Card>
          <CardHeader
            title={<T>{"Store credit"}</T>}
            subtitle={<T vars={{ balance: money(p.account.balance), issued: money(p.account.totalIssued), used: money(p.account.totalUsed) }}>{"{balance} available · {issued} given in total · {used} used"}</T>}
            action={me.role === "admin" ? <CreditAdjust customerId={c.id} /> : undefined}
          />
          <CreditHistory staff={office} rows={p.credit.map((t) => ({ ...t, when: at(t.createdAt) }))} />
        </Card>
      ),
    },
    { key: "products", label: "Most bought", count: p.topProducts.length, panel: <TopProducts p={p} day={day} /> },
  ];

  return (
    <>
      <Link href="/admin/customers" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> <T>{"Customers"}</T>
      </Link>

      {/* ---------------------------------------------------------------- header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-lg font-semibold text-white shadow-sm">{initials}</span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight break-words text-slate-900 sm:text-2xl">{c.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-600">{c.code}</span>
              <Badge tone={stage.tone}>{stage.label}</Badge>
              {c.approved ? <Badge tone="green">{"Approved to order"}</Badge> : <Badge tone="amber">{"Needs approval"}</Badge>}
              {!c.active && <Badge>{"Inactive"}</Badge>}
              {p.login && <Badge tone="blue">{"Portal on"}</Badge>}
              <span className="ml-1">
                <T vars={{ date: day(c.createdAt.toISOString().slice(0, 10)) }}>{"Customer since {date}"}</T>
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.phone && (
            <a href={`tel:${c.phone.replace(/\s+/g, "")}`} className={btn("secondary")}>
              <Phone className="size-4" /> <T>{"Call"}</T>
            </a>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} className={btn("secondary")}>
              <Mail className="size-4" /> <T>{"Email"}</T>
            </a>
          )}
          <EditCustomer
            isAdmin={me.role === "admin"}
            sales={!office}
            customer={{
              id: c.id,
              code: c.code,
              name: c.name,
              phone: c.phone,
              email: c.email,
              address: c.address,
              abn: c.abn,
              active: c.active,
              approved: c.approved,
              paymentTerms: c.paymentTerms,
              creditLimitCents: c.creditLimitCents,
              salesStage: c.salesStage,
              login: p.login ? { email: p.login.email, name: p.login.name } : null,
              orderCount: st.deliveries,
              spend90Cents: st.last90Cents,
              unpaidCents: st.unpaidCents,
              lastOrderAt: st.lastOrder,
            }}
          />
          {office && (
            <>
              <Link href={`/admin/customers/${c.id}/prices`} className={btn("secondary")}>
                <Tags className="size-4" /> <T>{"Price list"}</T>
              </Link>
              <Link href={`/admin/quotes/new?customer=${c.id}`} className={btn("primary")}>
                <FileText className="size-4" /> <T>{"New quote"}</T>
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- numbers */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Figure icon={CircleDollarSign} label="Total sales" value={aud(st.lifetimeCents)} hint={<T vars={{ n: st.orders }}>{st.orders === 1 ? "{n} order" : "{n} orders"}</T>} />
        <Figure icon={ShoppingCart} label="Last 90 days" value={aud(st.last90Cents)} hint={st.orders ? <T vars={{ amount: aud(st.avgOrderCents) }}>{"Average order {amount}"}</T> : undefined} />
        <Figure
          icon={Wallet}
          label="Unpaid"
          value={aud(st.unpaidCents)}
          tone={st.overdueCents > 0 ? "red" : st.unpaidCents > 0 ? "amber" : undefined}
          hint={st.overdueCents > 0 ? <T vars={{ amount: aud(st.overdueCents) }}>{"{amount} overdue"}</T> : <T>{"Nothing overdue"}</T>}
        />
        <Figure
          icon={Truck}
          label="Deliveries"
          value={String(st.deliveries)}
          hint={
            st.failed ? (
              <T vars={{ n: st.delivered, failed: st.failed }}>{"{n} delivered · {failed} failed"}</T>
            ) : (
              <T vars={{ n: st.delivered }}>{"{n} delivered"}</T>
            )
          }
        />
        <Figure icon={CalendarClock} label="Next delivery" value={st.nextDelivery ? day(st.nextDelivery) : "—"} hint={<T vars={{ date: day(st.lastDelivery) }}>{"Last delivered {date}"}</T>} />
        <Figure icon={Sparkles} label="Store credit" value={money(p.account.balance)} hint={<T vars={{ amount: money(p.account.totalIssued) }}>{"{amount} given in total"}</T>} />
      </div>

      {/* ---------------------------------------------------------------- body */}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <ProfileTabs tabs={tabs} />
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title={<T>{"Contact"}</T>} />
            <dl className="divide-y divide-line text-sm">
              <Row icon={Phone} label="Phone">
                {c.phone ? <a href={`tel:${c.phone.replace(/\s+/g, "")}`} className="text-blue-700 hover:underline">{c.phone}</a> : "—"}
              </Row>
              <Row icon={Mail} label="Email">
                {c.email ? <a href={`mailto:${c.email}`} className="break-all text-blue-700 hover:underline">{c.email}</a> : "—"}
              </Row>
              <Row icon={MapPin} label="Delivery address">
                {c.address ? (
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                    {c.address}
                  </a>
                ) : (
                  "—"
                )}
              </Row>
              <Row icon={Building2} label="ABN">{c.abn || "—"}</Row>
            </dl>
          </Card>

          <Card>
            <CardHeader title={<T>{"Account"}</T>} />
            <dl className="divide-y divide-line text-sm">
              <Row icon={Wallet} label="Payment terms">
                <T>{PAYMENT_TERMS_LABEL[c.paymentTerms]}</T>
              </Row>
              <Row icon={CircleDollarSign} label="Credit limit">
                {c.creditLimitCents === null ? (
                  <T>{"No limit"}</T>
                ) : (
                  <>
                    {aud(c.creditLimitCents)}
                    <span className={cx("block text-xs", creditLeft !== null && creditLeft < 0 ? "text-red-600" : "text-slate-500")}>
                      <T vars={{ amount: aud(Math.max(0, creditLeft ?? 0)) }}>{"{amount} still available"}</T>
                    </span>
                  </>
                )}
              </Row>
              <Row icon={KeyRound} label="Portal login">
                {p.login ? (
                  <>
                    <span className="break-all">{p.login.email}</span>
                    <span className="block text-xs text-slate-500">{p.login.name}</span>
                  </>
                ) : (
                  <span className="text-slate-500"><T>{"None yet"}</T></span>
                )}
              </Row>
            </dl>
          </Card>

          <Card>
            <CardHeader title={<T>{"Sales"}</T>} />
            <dl className="divide-y divide-line text-sm">
              <Row icon={Sparkles} label="Stage">
                <Badge tone={stage.tone}>{stage.label}</Badge>
                <span className="mt-0.5 block text-xs text-slate-500">
                  <T vars={{ date: at(c.salesStageAt) }}>{"Since {date}"}</T>
                </span>
              </Row>
              <Row icon={UserRound} label="Looked after by">{p.rep ?? <span className="text-slate-500"><T>{"Nobody yet"}</T></span>}</Row>
              <Row icon={CalendarClock} label="Follow up">
                {c.followUpOn ? (
                  <>
                    <span className={cx(c.followUpOn < today && "font-medium text-red-600")}>{day(c.followUpOn)}</span>
                    {c.followUpNote && <span className="block text-xs text-slate-500">{c.followUpNote}</span>}
                  </>
                ) : (
                  "—"
                )}
              </Row>
              <Row icon={Phone} label="Last contacted">{c.contactedAt ? at(c.contactedAt) : "—"}</Row>
            </dl>
          </Card>

          {p.addresses.length > 0 && (
            <Card>
              <CardHeader title={<T>{"Saved delivery addresses"}</T>} />
              <ul className="divide-y divide-line text-sm">
                {p.addresses.map((a) => (
                  <li key={a.id} className="px-4 py-2.5">
                    <p className="font-medium text-slate-800">{a.label || a.recipient || <T>{"Address"}</T>}</p>
                    <p className="text-slate-600">{a.address}</p>
                    {(a.recipient || a.phone) && <p className="text-xs text-slate-500">{[a.recipient, a.phone].filter(Boolean).join(" · ")}</p>}
                    {a.instructions && <p className="text-xs text-slate-500 italic">{a.instructions}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function Figure({ icon: Icon, label, value, hint, tone }: { icon: typeof Wallet; label: string; value: string; hint?: React.ReactNode; tone?: "amber" | "red" }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Icon className="size-3.5" /> <T>{label}</T>
      </p>
      <p className={cx("mt-1 text-xl font-semibold tracking-tight tabular-nums", tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-700" : "text-slate-900")}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Wallet; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-slate-500">
          <T>{label}</T>
        </dt>
        <dd className="mt-0.5 text-slate-800">{children}</dd>
      </div>
    </div>
  );
}

function Empty({ icon, children }: { icon: typeof Wallet; children: string }) {
  return (
    <Card>
      <EmptyState icon={icon} title={children} />
    </Card>
  );
}

/** A table that scrolls sideways on a phone instead of squashing its columns. */
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              {head.map((h, i) => (
                <th key={h} className={cx("px-4 py-2.5 whitespace-nowrap", i === head.length - 1 && "text-right")}>
                  <T>{h}</T>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">{children}</tbody>
        </table>
      </div>
    </Card>
  );
}

const TIMELINE_ICON: Record<TimelineEvent["kind"], { icon: typeof Wallet; tone: string }> = {
  joined: { icon: Sparkles, tone: "bg-violet-50 text-violet-600" },
  portal: { icon: KeyRound, tone: "bg-blue-50 text-blue-600" },
  order: { icon: ShoppingCart, tone: "bg-blue-50 text-blue-600" },
  paid: { icon: CircleDollarSign, tone: "bg-emerald-50 text-emerald-600" },
  cancelled: { icon: Ban, tone: "bg-slate-100 text-slate-500" },
  delivered: { icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600" },
  failed: { icon: XCircle, tone: "bg-red-50 text-red-600" },
  quote: { icon: FileText, tone: "bg-slate-100 text-slate-600" },
  quote_accepted: { icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600" },
  return: { icon: RotateCcw, tone: "bg-amber-50 text-amber-600" },
  credit: { icon: Wallet, tone: "bg-violet-50 text-violet-600" },
};

function Timeline({ events, at, office }: { events: TimelineEvent[]; at: (d: string) => string; office: boolean }) {
  if (events.length <= 1) return <Empty icon={Sparkles}>{"No activity yet"}</Empty>;
  return (
    <Card className="px-4 py-2">
      <ol className="relative">
        {events.map((e, i) => {
          const { icon: Icon, tone } = TIMELINE_ICON[e.kind];
          const title = (
            <span className="font-medium text-slate-800">
              <T vars={e.vars}>{e.title}</T>
            </span>
          );
          return (
            <li key={i} className="relative flex gap-3 py-2.5">
              {i < events.length - 1 && <span className="absolute top-10 bottom-0 left-[15px] w-px bg-line" aria-hidden />}
              <span className={cx("relative grid size-8 shrink-0 place-items-center rounded-full", tone)}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1 pt-1 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  {e.href && office ? (
                    <Link href={e.href} className="hover:underline">
                      {title}
                    </Link>
                  ) : (
                    title
                  )}
                  <span className="text-xs text-slate-400 tabular-nums">{at(e.at)}</span>
                </div>
                {e.detail && <p className="text-xs text-slate-500">{e.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

type Fmt = { p: CustomerProfile; day: (d: string | null) => string; office: boolean };

function OrdersTable({ p, day, at, office }: Fmt & { at: (d: Date | null) => string }) {
  if (!p.sales.length) return <Empty icon={ShoppingCart}>{"No orders yet"}</Empty>;
  return (
    <Table head={["Order", "Placed", "Delivery", "Status", "Payment", "Warehouse", "Total"]}>
      {p.sales.map((o) => (
        <tr key={o.id} className="hover:bg-slate-50/70">
          <td className="px-4 py-2.5 font-medium whitespace-nowrap">
            {office ? (
              <Link href={`/admin/sales/${o.id}`} className="text-blue-700 hover:underline">
                {o.number}
              </Link>
            ) : (
              o.number
            )}
            {office && o.invoiceStatus === "final" && (
              <Link href={`/admin/sales/${o.id}/invoice`} className="ml-2 text-xs font-normal text-slate-500 hover:text-blue-700 hover:underline">
                <T>{"Invoice"}</T>
              </Link>
            )}
          </td>
          <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{at(o.createdAt)}</td>
          <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{day(o.deliveryDate)}</td>
          <td className="px-4 py-2.5">
            <Badge tone={SALES_STATUS[o.status].tone}>{SALES_STATUS[o.status].label}</Badge>
          </td>
          <td className="px-4 py-2.5">
            {o.overdue ? <Badge tone="red">{"Overdue"}</Badge> : <Badge tone={PAYMENT_STATUS[o.paymentStatus].tone}>{PAYMENT_STATUS[o.paymentStatus].label}</Badge>}
            {o.dueDate && o.paymentStatus === "unpaid" && o.status !== "cancelled" && (
              <span className="mt-0.5 block text-[11px] text-slate-500">
                <T vars={{ date: day(o.dueDate) }}>{"Due {date}"}</T>
              </span>
            )}
          </td>
          <td className="px-4 py-2.5">
            {o.status !== "cancelled" && <Badge tone={FULFILMENT[o.fulfilment].tone}>{FULFILMENT[o.fulfilment].label}</Badge>}
          </td>
          <td className="px-4 py-2.5 text-right font-medium tabular-nums whitespace-nowrap">
            {aud(o.totalCents)}
            {o.paymentStatus === "unpaid" && o.status !== "cancelled" && o.dueCents !== o.totalCents && (
              <span className="block text-[11px] font-normal text-slate-500">
                <T vars={{ amount: aud(o.dueCents) }}>{"{amount} to pay"}</T>
              </span>
            )}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function DeliveriesTable({ p, day, at, office }: Fmt & { at: (d: Date | null) => string }) {
  if (!p.deliveries.length) return <Empty icon={Truck}>{"No deliveries yet"}</Empty>;
  return (
    <Table head={["Delivery", "Date", "Driver", "Status", "Delivered", "Goods"]}>
      {p.deliveries.map((d) => (
        <tr key={d.id} className="hover:bg-slate-50/70">
          <td className="px-4 py-2.5 whitespace-nowrap">
            <span className="font-mono text-xs text-slate-700">{d.orderNumber}</span>
            {d.shopOrder &&
              (office ? (
                <Link href={`/admin/sales/${d.shopOrder.id}`} className="ml-2 text-xs text-blue-700 hover:underline">
                  {d.shopOrder.number}
                </Link>
              ) : (
                <span className="ml-2 text-xs text-slate-500">{d.shopOrder.number}</span>
              ))}
            <span className="block max-w-[260px] truncate text-xs text-slate-500">{d.address}</span>
          </td>
          <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
            {office ? (
              <Link href={`/admin/orders?date=${d.deliveryDate}`} className="hover:text-blue-700 hover:underline">
                {day(d.deliveryDate)}
              </Link>
            ) : (
              day(d.deliveryDate)
            )}
          </td>
          <td className="px-4 py-2.5 text-slate-600">{d.driver ?? "—"}</td>
          <td className="px-4 py-2.5">
            <Badge tone={ORDER_STATUS[d.status].tone}>{ORDER_STATUS[d.status].label}</Badge>
            {d.outcome?.type === "failed" && d.outcome.reason && <span className="mt-0.5 block text-[11px] text-red-600">{d.outcome.reason}</span>}
          </td>
          <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
            {d.outcome?.type === "delivered" ? (
              <>
                {at(d.outcome.at)}
                {d.outcome.recipient && <span className="block text-[11px] text-slate-500">{d.outcome.recipient}</span>}
              </>
            ) : (
              "—"
            )}
          </td>
          <td className="px-4 py-2.5 text-right whitespace-nowrap text-slate-600">
            {d.lines ? <T vars={{ n: d.lines }}>{d.lines === 1 ? "{n} line" : "{n} lines"}</T> : <T vars={{ n: d.demand }}>{d.demand === 1 ? "{n} unit" : "{n} units"}</T>}
            {office && d.photoId && (
              <a href={`/api/proofs/${d.photoId}`} target="_blank" rel="noreferrer" className="ml-2 text-xs text-blue-700 hover:underline">
                <T>{"Photo"}</T>
              </a>
            )}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function QuotesTable({ p, day, today, office, customerId }: Fmt & { today: string; customerId: string }) {
  if (!p.quotes.length)
    return (
      <Card>
        <EmptyState icon={FileText} title="No quotes yet">
          {office && (
            <Link href={`/admin/quotes/new?customer=${customerId}`} className={btn("primary", "sm", "mt-3")}>
              <FileText className="size-3.5" /> <T>{"New quote"}</T>
            </Link>
          )}
        </EmptyState>
      </Card>
    );
  return (
    <Table head={["Quote", "Created", "Valid until", "Status", "Total"]}>
      {p.quotes.map((q) => {
        const state = QUOTE_STATUS[quoteState(q, today)];
        return (
          <tr key={q.id} className="hover:bg-slate-50/70">
            <td className="px-4 py-2.5 font-medium">
              {office ? (
                <Link href={`/admin/quotes/${q.id}`} className="text-blue-700 hover:underline">
                  {q.number}
                </Link>
              ) : (
                q.number
              )}
            </td>
            <td className="px-4 py-2.5 text-slate-600">{day(q.createdAt.toISOString().slice(0, 10))}</td>
            <td className="px-4 py-2.5 text-slate-600">{day(q.validUntil)}</td>
            <td className="px-4 py-2.5">
              <Badge tone={state.tone}>{state.label}</Badge>
            </td>
            <td className="px-4 py-2.5 text-right font-medium tabular-nums">{aud(q.totalCents)}</td>
          </tr>
        );
      })}
    </Table>
  );
}

function ReturnsTable({ p, at, office }: Fmt & { at: (d: Date | null) => string }) {
  if (!p.returns.length) return <Empty icon={RotateCcw}>{"No returns"}</Empty>;
  return (
    <Table head={["Return", "Requested", "Status", "Given back", "Value"]}>
      {p.returns.map((r) => (
        <tr key={r.id} className="hover:bg-slate-50/70">
          <td className="px-4 py-2.5 font-medium">
            {office ? (
              <Link href={`/admin/customer-returns/${r.id}`} className="text-blue-700 hover:underline">
                {r.returnNumber}
              </Link>
            ) : (
              r.returnNumber
            )}
          </td>
          <td className="px-4 py-2.5 text-slate-600">{at(r.createdAt)}</td>
          <td className="px-4 py-2.5">
            <Badge tone={CUSTOMER_RETURN_STATUS[r.status].tone}>{CUSTOMER_RETURN_STATUS[r.status].label}</Badge>
          </td>
          <td className="px-4 py-2.5 text-slate-600">
            {Number(r.refundAmount) > 0 && <T vars={{ amount: money(Number(r.refundAmount)) }}>{"{amount} refunded"}</T>}
            {Number(r.refundAmount) > 0 && Number(r.creditAmount) > 0 && " · "}
            {Number(r.creditAmount) > 0 && <T vars={{ amount: money(Number(r.creditAmount)) }}>{"{amount} store credit"}</T>}
            {!Number(r.refundAmount) && !Number(r.creditAmount) && "—"}
          </td>
          <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(Number(r.total))}</td>
        </tr>
      ))}
    </Table>
  );
}

function TopProducts({ p, day }: { p: CustomerProfile; day: (d: string | null) => string }) {
  if (!p.topProducts.length) return <Empty icon={Package}>{"Nothing bought yet"}</Empty>;
  const most = Math.max(...p.topProducts.map((t) => t.orders));
  return (
    <Card>
      <CardHeader title={<T>{"What they buy most"}</T>} subtitle={<T>{"From their orders and delivered invoices."}</T>} />
      <ul className="divide-y divide-line">
        {p.topProducts.map((t) => (
          <li key={t.name} className="px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-800">{t.name}</span>
              <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                <T vars={{ n: t.orders, qty: t.qty }}>{t.orders === 1 ? "{n} order · {qty} in total" : "{n} orders · {qty} in total"}</T>
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-full rounded-full bg-blue-500/80" style={{ width: `${Math.max(6, (t.orders / most) * 100)}%` }} />
              </span>
              <span className="shrink-0 text-[11px] text-slate-400">
                <T vars={{ date: day(t.last || null) }}>{"Last {date}"}</T>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
