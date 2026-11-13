"use client";

import { Building2, FileText, KeyRound, Mail, MapPin, Package, Pencil, Phone, Plus, Search, Tags, Upload } from "lucide-react";
import Link from "@/components/link";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { deleteCustomer, removeCustomerLogin, saveCustomer } from "@/app/actions/customers";
import { setSalesStage } from "@/app/actions/pipeline";
import { FormError, Modal, SubmitButton, KeptForm, Toast, type ToastMessage, useKeptForm } from "@/components/client-ui";
import { Badge, btn, Card, cx, EmptyState, Field, inputCls, PageHeader, Spinner } from "@/components/ui";
import type { PaymentTerms, SalesStage } from "@/lib/db/schema";
import { SALES_STAGES, STAGE_INFO } from "@/lib/sales-stage";
import { aud, PAYMENT_TERMS_LABEL } from "@/lib/money";
import { useT } from "@/components/i18n";
import { AddressInput } from "@/components/address-input";

type Customer = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  abn: string | null;
  active: boolean;
  approved: boolean;
  paymentTerms: PaymentTerms;
  creditLimitCents: number | null;
  salesStage: SalesStage;
  login: { email: string; name: string } | null;
  orderCount: number;
  spend90Cents: number;
  unpaidCents: number;
  lastOrderAt: string | null;
};

/** Customers drawn at a time. */
const PAGE = 60;

const FILTERS = [
  ["all", "All"],
  ["approval", "Needs approval"],
  ["portal", "Portal on"],
  ["unpaid", "Unpaid"],
  ["inactive", "Inactive"],
] as const;

export function CustomersClient({
  customers,
  isAdmin,
  sales,
}: {
  customers: Customer[];
  isAdmin: boolean;
  /** Sales staff: edit details, stage and portal logins, but not terms, credit or approval; they add customers from the pipeline. */
  sales?: boolean;
}) {
  const tr = useT();
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  // Sales staff: the customer whose stage they're changing.
  const [staging, setStaging] = useState<Customer | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const deferredQ = useDeferredValue(q);
  // Hundreds of customers: draw them a page at a time, starting again when the search changes.
  const [limit, setLimit] = useState(PAGE);
  const listKey = `${deferredQ}|${filter}`;
  const [prevKey, setPrevKey] = useState(listKey);
  if (prevKey !== listKey) {
    setPrevKey(listKey);
    setLimit(PAGE);
  }
  const shown = useMemo(() => {
    const s = deferredQ.trim().toLowerCase();
    return customers.filter(
      (c) =>
        (filter === "all" ||
          (filter === "approval" && !c.approved) ||
          (filter === "portal" && !!c.login) ||
          (filter === "unpaid" && c.unpaidCents > 0) ||
          (filter === "inactive" && !c.active)) &&
        (!s || [c.code, c.name, c.phone, c.email, c.address, c.abn, c.login?.email].some((v) => v?.toLowerCase().includes(s))),
    );
  }, [customers, deferredQ, filter]);
  const counts = {
    all: customers.length,
    approval: customers.filter((c) => !c.approved).length,
    portal: customers.filter((c) => c.login).length,
    unpaid: customers.filter((c) => c.unpaidCents > 0).length,
    inactive: customers.filter((c) => !c.active).length,
  };

  return (
    <>
      <PageHeader
        title={tr("Customers")}
        subtitle={tr("Give a customer a portal login and they can follow their own orders, see the delivery photo and signature.")}
        actions={
          sales ? undefined : <>
            <Link href="/admin/customers/import" className={btn("secondary")}>
              <Upload className="size-4" /> {tr("Import")}
            </Link>
            <button className={btn("primary")} onClick={() => setEditing("new")}>
              <Plus className="size-4" /> {tr("Add customer")}
            </button>
          </>
        }
      />
      {customers.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search code, name, phone, email, address")} className={cx(inputCls, "pl-9")} />
          </div>
          <div className="-mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0">
            {FILTERS.map(([f, label]) =>
              f === "all" || counts[f] > 0 ? (
                <button key={f} onClick={() => setFilter(f)} className={btn(filter === f ? "primary" : "ghost", "sm", "shrink-0")}>
                  {tr(label)} <span className="opacity-60">{counts[f]}</span>
                </button>
              ) : null,
            )}
          </div>
        </div>
      )}
      {customers.length === 0 ? (
        <Card>
          <EmptyState icon={Building2} title={tr("No customers yet")}>
            {tr("Add the businesses you deliver to. Orders whose customer name or phone matches are linked automatically.")}</EmptyState>
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState icon={Search} title={tr("No customers match")}>{tr("Try another search or filter.")}</EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
            {shown.slice(0, limit).map((c, i) => (
              <div key={c.id} className="stagger flex min-w-0" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
              <Card className={cx("relative flex w-full min-w-0 flex-col p-3.5 sm:p-4", !c.active && "opacity-60", sales && "transition-shadow hover:shadow-pop")}>
                {sales && (
                  // The whole card opens the stage picker; the phone / email / map links sit above it.
                  <button type="button" className="absolute inset-0 z-0 rounded-xl" onClick={() => setStaging(c)} aria-label={`${tr("Change status")}: ${c.name}`} />
                )}
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-semibold leading-snug break-words text-slate-900">{c.name}</p>
                    <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="truncate font-mono">{c.code}</span>
                      <span className="shrink-0 text-slate-300">·</span>
                      <span className="flex shrink-0 items-center gap-1">
                        <Package className="size-3" /> {tr(c.orderCount === 1 ? "{n} linked order" : "{n} linked orders", { n: c.orderCount })}
                      </span>
                    </p>
                  </div>
                  {/* Above the card-wide stage button sales staff have. */}
                  <button className={btn("ghost", "icon", "relative z-10 -mt-1 -mr-1 size-9 shrink-0")} onClick={() => setEditing(c)} aria-label={`${tr("Edit")} ${c.name}`}>
                    <Pencil className="size-4" />
                  </button>
                </div>
                {(sales || c.salesStage !== "won" || !c.approved || !c.active || c.login) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(sales || c.salesStage !== "won") && <Badge tone={STAGE_INFO[c.salesStage].tone}>{tr(STAGE_INFO[c.salesStage].label)}</Badge>}
                    {!c.approved && <Badge tone="amber">{tr("Needs approval")}</Badge>}
                    {!c.active && <Badge>{tr("Inactive")}</Badge>}
                    {c.login && <Badge tone="green">{tr("Portal on")}</Badge>}
                  </div>
                )}
                <ul className="relative z-10 mt-2.5 space-y-0.5 text-[13px] text-slate-600">
                  {c.phone && (
                    <li>
                      <a href={`tel:${c.phone.replace(/\s+/g, "")}`} className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50 active:bg-slate-100">
                        <Phone className="size-3.5 shrink-0 text-slate-400" /> <span className="truncate">{c.phone}</span>
                      </a>
                    </li>
                  )}
                  {c.email && (
                    <li>
                      <a href={`mailto:${c.email}`} className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50 active:bg-slate-100">
                        <Mail className="size-3.5 shrink-0 text-slate-400" /> <span className="truncate">{c.email}</span>
                      </a>
                    </li>
                  )}
                  {c.address && (
                    <li>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50 active:bg-slate-100"
                      >
                        <MapPin className="size-3.5 shrink-0 text-slate-400" /> <span className="truncate">{c.address}</span>
                      </a>
                    </li>
                  )}
                  {c.login && (
                    <li className="flex min-w-0 items-center gap-2 py-1">
                      <KeyRound className="size-3.5 shrink-0 text-slate-400" /> <span className="truncate">{tr("Login:")}{" "}{c.login.email}</span>
                    </li>
                  )}
                </ul>
                <dl className="mt-2.5 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] sm:text-xs">
                  <div className="min-w-0">
                    <dt className="truncate text-slate-500">{tr("90-day sales")}</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">{aud(c.spend90Cents)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="truncate text-slate-500">{tr("Unpaid")}</dt>
                    <dd className={cx("font-semibold tabular-nums", c.unpaidCents > 0 ? "text-amber-700" : "text-slate-900")}>{aud(c.unpaidCents)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="truncate text-slate-500">{tr("Last order")}</dt>
                    <dd className="font-semibold text-slate-900">{c.lastOrderAt ? tr(new Date(c.lastOrderAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })) : "—"}</dd>
                  </div>
                </dl>
                <p className="mt-2 truncate text-[11px] text-slate-500">
                  {tr(PAYMENT_TERMS_LABEL[c.paymentTerms])}
                  {c.creditLimitCents !== null && <> · {tr("limit {amount}", { amount: aud(c.creditLimitCents) })}</>}
                </p>
                {sales && (
                  <button type="button" onClick={() => setStaging(c)} className={btn("secondary", "sm", "relative z-10 mt-3 h-9 w-full")}>
                    <span className={cx("size-2 rounded-full", STAGE_INFO[c.salesStage].dot)} /> {tr("Change status")}
                  </button>
                )}
                {!sales && (
                  <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
                    <Link href={`/admin/customers/${c.id}`} className={btn("secondary", "sm", "h-9")}>
                      <Tags className="size-3.5" /> {tr("Price list")}
                    </Link>
                    <Link href={`/admin/quotes/new?customer=${c.id}`} className={btn("secondary", "sm", "h-9")}>
                      <FileText className="size-3.5" /> {tr("New quote")}
                    </Link>
                  </div>
                )}
              </Card>
              </div>
            ))}
          </div>
          {shown.length > limit && (
            <div className="mt-4 flex flex-col items-center gap-1.5">
              <button className={btn("secondary", "md", "w-full sm:w-auto")} onClick={() => setLimit((n) => n + PAGE)}>
                {tr("Show more")} <span className="opacity-60">({shown.length - limit})</span>
              </button>
              <p className="text-xs text-slate-400">{tr("Showing {n} of {total}", { n: limit, total: shown.length })}</p>
            </div>
          )}
        </>
      )}
      <Modal open={staging !== null} onClose={() => setStaging(null)} title={staging ? staging.name : tr("Change status")}>
        {staging && (
          <StagePicker
            current={staging.salesStage}
            onPick={async (stage) => {
              const r = await setSalesStage(staging.id, stage);
              setStaging(null);
              setToast({ id: Date.now(), tone: r.ok ? "ok" : "warn", text: r.ok ? `${staging.name}: ${tr(STAGE_INFO[stage].label)}` : r.error });
            }}
          />
        )}
      </Modal>
      <Toast toast={toast} onDone={() => setToast(null)} />
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? tr("Add customer") : tr("Edit customer")}>
        {editing !== null && (
          <CustomerForm
            isAdmin={isAdmin}
            sales={!!sales}
            customer={editing === "new" ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}

function CustomerForm({ customer, onDone, isAdmin, sales }: { customer: Customer | null; onDone: () => void; isAdmin: boolean; sales: boolean }) {
  const tr = useT();
  // Sales staff see the office's fields but can't change them (the server ignores them from sales too).
  const office = sales ? tr("Set by the office.") : undefined;
  const [state, form] = useKeptForm(saveCustomer);
  const [removing, startRemove] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <KeptForm form={form} className="space-y-4">
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field label={tr("Customer code")} hint={office ?? (customer ? undefined : tr("Leave blank to get the next code."))}>
          <input name="code" disabled={sales} defaultValue={customer?.code ?? ""} placeholder={customer ? undefined : tr("Automatic")} autoComplete="off" className={cx(inputCls, "font-mono")} />
        </Field>
        <Field label={tr("Business name")} hint={tr("Orders with this exact customer name are linked to this customer.")}>
          <input name="name" required defaultValue={customer?.name} className={inputCls} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("Phone")} hint={tr("Also used to match orders.")}>
          <input name="phone" type="tel" defaultValue={customer?.phone ?? ""} className={inputCls} />
        </Field>
        <Field label={tr("Contact email")}>
          <input name="email" type="email" defaultValue={customer?.email ?? ""} className={inputCls} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label={tr("Delivery address")}>
          <AddressInput name="address" defaultValue={customer?.address ?? ""} inputClassName={inputCls} />
        </Field>
        <Field label={tr("ABN")}>
          <input name="abn" defaultValue={customer?.abn ?? ""} className={inputCls} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={tr("Payment terms")} hint={office ?? tr("Invoice terms let them choose “Pay by invoice” at checkout.")}>
          <select name="paymentTerms" disabled={sales} defaultValue={customer?.paymentTerms ?? "prepay"} className={inputCls}>
            {Object.entries(PAYMENT_TERMS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("Sales stage")} hint={tr("Also on the Sales Pipeline page.")}>
          <select name="salesStage" defaultValue={customer?.salesStage ?? "won"} className={inputCls}>
            {SALES_STAGES.map((s) => (
              <option key={s} value={s}>
                {tr(STAGE_INFO[s].label)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("Credit limit ($, optional)")} hint={office ?? tr("Max unpaid balance on invoice orders.")}>
          <input name="creditLimit" disabled={sales} inputMode="decimal" defaultValue={customer?.creditLimitCents != null ? (customer.creditLimitCents / 100).toFixed(0) : ""} className={inputCls} />
        </Field>
      </div>
      <div className={cx("flex flex-wrap items-center gap-x-5 gap-y-1 text-sm", sales && "text-slate-400")}>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="approved" disabled={sales} defaultChecked={customer?.approved ?? true} /> {" "}{tr("Approved to order")}</label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" disabled={sales} defaultChecked={customer?.active ?? true} /> {" "}{tr("Active")}</label>
        {office && <span className="text-xs">{office}</span>}
      </div>

      <fieldset className="space-y-3 rounded-xl border border-line p-3">
        <legend className="px-1 text-xs font-semibold text-slate-700">{tr("Customer portal login")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("Login email")}>
            <input name="loginEmail" type="email" autoComplete="off" defaultValue={customer?.login?.email ?? ""} className={inputCls} />
          </Field>
          <Field label={tr("Contact name")}>
            <input name="loginName" autoComplete="off" defaultValue={customer?.login?.name ?? ""} className={inputCls} />
          </Field>
        </div>
        <Field label={customer?.login ? tr("New password (leave blank to keep)") : tr("Password")} hint={tr("At least 8 characters.")}>
          <input name="password" type="password" autoComplete="new-password" className={inputCls} />
        </Field>
        {customer?.login && (
          <button
            type="button"
            disabled={removing}
            onClick={() =>
              startRemove(async () => {
                await removeCustomerLogin(customer.id);
                onDone();
              })
            }
            className={btn("danger", "sm")}
          >
            {tr("Remove portal login")}</button>
        )}
      </fieldset>

      <FormError message={state && !state.ok ? state.error : null} />
      {deleteError && <FormError message={deleteError} />}
      <SubmitButton className="w-full">{customer ? tr("Save changes") : tr("Add customer")}</SubmitButton>
      {customer && isAdmin && (
        <button
          type="button"
          disabled={removing}
          className={btn("ghost", "md", "w-full text-red-600")}
          onClick={() => {
            if (!confirm(`Delete ${customer.name}?\n\nTheir portal login, saved addresses, cart and price list are removed. Delivery orders stay but are no longer linked to them.`)) return;
            startRemove(async () => {
              const r = await deleteCustomer(customer.id);
              if (r.ok) onDone();
              else setDeleteError(r.error);
            });
          }}
        >
          {tr("Delete customer")}</button>
      )}
    </KeptForm>
  );
}

/** The pipeline stages as big buttons, the current one marked; tapping one saves it. */
function StagePicker({ current, onPick }: { current: SalesStage; onPick: (stage: SalesStage) => Promise<void> }) {
  const tr = useT();
  const [saving, setSaving] = useState<SalesStage | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">{tr("Where is this customer now?")}</p>
      {SALES_STAGES.map((st) => {
        const on = st === current;
        return (
          <button
            key={st}
            type="button"
            disabled={saving !== null}
            onClick={async () => {
              if (on) return;
              setSaving(st);
              await onPick(st);
            }}
            className={cx(
              "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left ring-1 transition-[background-color,transform] active:scale-[0.99] disabled:opacity-70",
              on ? "bg-blue-50 ring-blue-300" : "ring-line hover:bg-slate-50",
            )}
          >
            <span className={cx("size-3 shrink-0 rounded-full", STAGE_INFO[st].dot)} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-slate-900">{tr(STAGE_INFO[st].label)}</span>
              <span className="block text-xs text-slate-500">{tr(STAGE_INFO[st].hint)}</span>
            </span>
            {saving === st ? <Spinner className="size-4" /> : on && <span className="text-xs font-medium text-blue-700">{tr("Now")}</span>}
          </button>
        );
      })}
    </div>
  );
}
