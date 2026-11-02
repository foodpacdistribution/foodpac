"use client";

import { Building2, KeyRound, Mail, MapPin, Package, Pencil, Phone, Plus, Search, Tags } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { deleteCustomer, removeCustomerLogin, saveCustomer } from "@/app/actions/customers";
import { FormError, Modal, SubmitButton } from "@/components/client-ui";
import { Badge, btn, Card, cx, EmptyState, Field, inputCls, PageHeader } from "@/components/ui";
import type { PaymentTerms } from "@/lib/db/schema";
import { aud, PAYMENT_TERMS_LABEL } from "@/lib/money";
import { useT } from "@/components/i18n";
import { AddressInput } from "@/components/address-input";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  abn: string | null;
  active: boolean;
  approved: boolean;
  paymentTerms: PaymentTerms;
  creditLimitCents: number | null;
  login: { email: string; name: string } | null;
  orderCount: number;
  spend90Cents: number;
  unpaidCents: number;
  lastOrderAt: string | null;
};

const FILTERS = [
  ["all", "All"],
  ["approval", "Needs approval"],
  ["portal", "Portal on"],
  ["unpaid", "Unpaid"],
  ["inactive", "Inactive"],
] as const;

export function CustomersClient({ customers, isAdmin }: { customers: Customer[]; isAdmin: boolean }) {
  const tr = useT();
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const router = useRouter();
  const deferredQ = useDeferredValue(q);
  const shown = useMemo(() => {
    const s = deferredQ.trim().toLowerCase();
    return customers.filter(
      (c) =>
        (filter === "all" ||
          (filter === "approval" && !c.approved) ||
          (filter === "portal" && !!c.login) ||
          (filter === "unpaid" && c.unpaidCents > 0) ||
          (filter === "inactive" && !c.active)) &&
        (!s || [c.name, c.phone, c.email, c.address, c.abn, c.login?.email].some((v) => v?.toLowerCase().includes(s))),
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
          <button className={btn("primary")} onClick={() => setEditing("new")}>
            <Plus className="size-4" /> {" "}{tr("Add customer")}</button>
        }
      />
      {customers.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search name, phone, email, address")} className={cx(inputCls, "pl-9")} />
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map(([f, label]) =>
              f === "all" || counts[f] > 0 ? (
                <button key={f} onClick={() => setFilter(f)} className={btn(filter === f ? "primary" : "ghost", "sm")}>
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => (
            <Card key={c.id} className={cx("p-4", !c.active && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{c.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    <Package className="size-3.5" /> {tr(c.orderCount === 1 ? "{n} linked order" : "{n} linked orders", { n: c.orderCount })}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {!c.approved && <Badge tone="amber">{tr("Needs approval")}</Badge>}
                  {!c.active && <Badge>{tr("Inactive")}</Badge>}
                  {c.login ? <Badge tone="green">{tr("Portal on")}</Badge> : <Badge>{tr("No login")}</Badge>}
                  <button className={btn("ghost", "icon")} onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}>
                    <Pencil className="size-3.5" />
                  </button>
                </div>
              </div>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
                {c.phone && (
                  <li className="flex items-center gap-1.5">
                    <Phone className="size-3.5 text-slate-400" /> {c.phone}
                  </li>
                )}
                {c.email && (
                  <li className="flex items-center gap-1.5">
                    <Mail className="size-3.5 text-slate-400" /> {c.email}
                  </li>
                )}
                {c.address && (
                  <li className="flex items-center gap-1.5">
                    <MapPin className="size-3.5 text-slate-400" /> <span className="truncate">{c.address}</span>
                  </li>
                )}
                {c.login && (
                  <li className="flex items-center gap-1.5">
                    <KeyRound className="size-3.5 text-slate-400" /> {" "}{tr("Login:")}{" "}{c.login.email}
                  </li>
                )}
                <li className="text-slate-500">
                  {tr(PAYMENT_TERMS_LABEL[c.paymentTerms])}
                  {c.creditLimitCents !== null && <> · {tr("limit {amount}", { amount: aud(c.creditLimitCents) })}</>}
                </li>
              </ul>
              <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <div>
                  <dt className="text-slate-500">{tr("90-day sales")}</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{aud(c.spend90Cents)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{tr("Unpaid")}</dt>
                  <dd className={cx("font-semibold tabular-nums", c.unpaidCents > 0 ? "text-amber-700" : "text-slate-900")}>{aud(c.unpaidCents)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{tr("Last order")}</dt>
                  <dd className="font-semibold text-slate-900">{c.lastOrderAt ? tr(new Date(c.lastOrderAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })) : "—"}</dd>
                </div>
              </dl>
              <Link href={`/admin/customers/${c.id}`} className={cx(btn("secondary", "sm"), "mt-3")}>
                <Tags className="size-3.5" /> {" "}{tr("Price list")}</Link>
            </Card>
          ))}
        </div>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? tr("Add customer") : tr("Edit customer")}>
        {editing !== null && (
          <CustomerForm
            isAdmin={isAdmin}
            customer={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function CustomerForm({ customer, onDone, isAdmin }: { customer: Customer | null; onDone: () => void; isAdmin: boolean }) {
  const tr = useT();
  const [state, action] = useActionState(saveCustomer, undefined);
  const [removing, startRemove] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="space-y-4">
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <Field label={tr("Business name")} hint={tr("Orders with this exact customer name are linked to this customer.")}>
        <input name="name" required defaultValue={customer?.name} className={inputCls} />
      </Field>
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("Payment terms")} hint={tr("Invoice terms let them choose “Pay by invoice” at checkout.")}>
          <select name="paymentTerms" defaultValue={customer?.paymentTerms ?? "prepay"} className={inputCls}>
            {Object.entries(PAYMENT_TERMS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("Credit limit ($, optional)")} hint={tr("Max unpaid balance on invoice orders.")}>
          <input name="creditLimit" inputMode="decimal" defaultValue={customer?.creditLimitCents != null ? (customer.creditLimitCents / 100).toFixed(0) : ""} className={inputCls} />
        </Field>
      </div>
      <div className="flex gap-5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="approved" defaultChecked={customer?.approved ?? true} /> {" "}{tr("Approved to order")}</label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={customer?.active ?? true} /> {" "}{tr("Active")}</label>
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
        <Field label={customer?.login ? "New password (leave blank to keep)" : "Password"} hint={tr("At least 8 characters.")}>
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
    </form>
  );
}
