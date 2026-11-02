"use client";

import { Building2, KeyRound, Mail, MapPin, Package, Pencil, Phone, Plus, Tags } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { deleteCustomer, removeCustomerLogin, saveCustomer } from "@/app/actions/customers";
import { FormError, Modal, SubmitButton } from "@/components/client-ui";
import { Badge, btn, Card, cx, EmptyState, Field, inputCls, PageHeader } from "@/components/ui";
import type { PaymentTerms } from "@/lib/db/schema";
import { aud, PAYMENT_TERMS_LABEL } from "@/lib/money";

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
};

export function CustomersClient({ customers, isAdmin }: { customers: Customer[]; isAdmin: boolean }) {
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const router = useRouter();

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Give a customer a portal login and they can follow their own orders, see the delivery photo and signature."
        actions={
          <button className={btn("primary")} onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Add customer
          </button>
        }
      />
      {customers.length === 0 ? (
        <Card>
          <EmptyState icon={Building2} title="No customers yet">
            Add the businesses you deliver to. Orders whose customer name or phone matches are linked automatically.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {customers.map((c) => (
            <Card key={c.id} className={cx("p-4", !c.active && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{c.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    <Package className="size-3.5" /> {c.orderCount} linked order{c.orderCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {!c.approved && <Badge tone="amber">Needs approval</Badge>}
                  {!c.active && <Badge>Inactive</Badge>}
                  {c.login ? <Badge tone="green">Portal on</Badge> : <Badge>No login</Badge>}
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
                    <KeyRound className="size-3.5 text-slate-400" /> Login: {c.login.email}
                  </li>
                )}
                <li className="text-slate-500">
                  {PAYMENT_TERMS_LABEL[c.paymentTerms]}
                  {c.creditLimitCents !== null && ` · limit ${aud(c.creditLimitCents)}`}
                </li>
              </ul>
              <Link href={`/admin/customers/${c.id}`} className={cx(btn("secondary", "sm"), "mt-3")}>
                <Tags className="size-3.5" /> Price list
              </Link>
            </Card>
          ))}
        </div>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add customer" : "Edit customer"}>
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
  const [state, action] = useActionState(saveCustomer, undefined);
  const [removing, startRemove] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="space-y-4">
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <Field label="Business name" hint="Orders with this exact customer name are linked to this customer.">
        <input name="name" required defaultValue={customer?.name} className={inputCls} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone" hint="Also used to match orders.">
          <input name="phone" type="tel" defaultValue={customer?.phone ?? ""} className={inputCls} />
        </Field>
        <Field label="Contact email">
          <input name="email" type="email" defaultValue={customer?.email ?? ""} className={inputCls} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Delivery address">
          <input name="address" defaultValue={customer?.address ?? ""} className={inputCls} />
        </Field>
        <Field label="ABN">
          <input name="abn" defaultValue={customer?.abn ?? ""} className={inputCls} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Payment terms" hint="Invoice terms let them choose “Pay by invoice” at checkout.">
          <select name="paymentTerms" defaultValue={customer?.paymentTerms ?? "prepay"} className={inputCls}>
            {Object.entries(PAYMENT_TERMS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Credit limit ($, optional)" hint="Max unpaid balance on invoice orders.">
          <input name="creditLimit" inputMode="decimal" defaultValue={customer?.creditLimitCents != null ? (customer.creditLimitCents / 100).toFixed(0) : ""} className={inputCls} />
        </Field>
      </div>
      <div className="flex gap-5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="approved" defaultChecked={customer?.approved ?? true} /> Approved to order
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={customer?.active ?? true} /> Active
        </label>
      </div>

      <fieldset className="space-y-3 rounded-xl border border-line p-3">
        <legend className="px-1 text-xs font-semibold text-slate-700">Customer portal login</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Login email">
            <input name="loginEmail" type="email" autoComplete="off" defaultValue={customer?.login?.email ?? ""} className={inputCls} />
          </Field>
          <Field label="Contact name">
            <input name="loginName" autoComplete="off" defaultValue={customer?.login?.name ?? ""} className={inputCls} />
          </Field>
        </div>
        <Field label={customer?.login ? "New password (leave blank to keep)" : "Password"} hint="At least 8 characters.">
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
            Remove portal login
          </button>
        )}
      </fieldset>

      <FormError message={state && !state.ok ? state.error : null} />
      {deleteError && <FormError message={deleteError} />}
      <SubmitButton className="w-full">{customer ? "Save changes" : "Add customer"}</SubmitButton>
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
          Delete customer
        </button>
      )}
    </form>
  );
}
