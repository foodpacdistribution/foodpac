"use client";

import { Factory, Mail, Pencil, Phone, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveSupplier } from "@/app/actions/purchasing";
import { FormError, KeptForm, Modal, SubmitButton, useKeptForm } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, EmptyState, Field, inputCls, PageHeader } from "@/components/ui";
import type { ActionResult } from "@/lib/action";

type Supplier = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  abn: string | null;
  notes: string | null;
  active: boolean;
  openOrders: number;
};

export function SuppliersClient({ suppliers }: { suppliers: Supplier[] }) {
  const tr = useT();
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  return (
    <>
      <PageHeader
        title={tr("Suppliers")}
        subtitle={tr("Who we buy from. Suppliers are paid per purchase order: no credit accounts or payment terms.")}
        actions={
          <button className={btn("primary")} onClick={() => setEditing("new")}>
            <Plus className="size-4" /> {tr("Add supplier")}
          </button>
        }
      />
      <Card className="overflow-hidden">
        {!suppliers.length ? (
          <EmptyState icon={Factory} title="No suppliers yet">
            {"Add the companies you buy stock from, then raise purchase orders to them."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {suppliers.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {s.name} {!s.active && <Badge tone="slate">{tr("Inactive")}</Badge>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    {s.contactName && <span>{s.contactName}</span>}
                    {s.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="size-3" /> {s.email}
                      </span>
                    )}
                    {s.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="size-3" /> {s.phone}
                      </span>
                    )}
                    {s.abn && <span>ABN {s.abn}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {s.openOrders > 0 && (
                    <Link href={`/admin/purchase-orders?supplier=${s.id}`} className="text-xs font-medium text-blue-700 hover:underline">
                      {tr(s.openOrders === 1 ? "{n} open order" : "{n} open orders", { n: s.openOrders })}
                    </Link>
                  )}
                  <button className={btn("ghost", "sm")} onClick={() => setEditing(s)}>
                    <Pencil className="size-3.5" /> {tr("Edit")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={tr(editing === "new" ? "Add supplier" : "Edit supplier")}>
        {editing && <SupplierForm key={editing === "new" ? "new" : editing.id} supplier={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

function SupplierForm({ supplier: s, onDone }: { supplier: Supplier | null; onDone: () => void }) {
  const tr = useT();
  const router = useRouter();
  const [state, form] = useKeptForm(async (prev: ActionResult<unknown> | undefined, fd: FormData) => {
    const r = await saveSupplier(prev, fd);
    if (r.ok) {
      onDone();
      router.refresh();
    }
    return r;
  });
  return (
    <KeptForm form={form} className="grid gap-3 sm:grid-cols-2">
      {s && <input type="hidden" name="id" value={s.id} />}
      <Field label="Business name" className="sm:col-span-2">
        <input name="name" required defaultValue={s?.name} className={inputCls} />
      </Field>
      <Field label="Contact person">
        <input name="contactName" defaultValue={s?.contactName ?? ""} className={inputCls} />
      </Field>
      <Field label="Phone">
        <input name="phone" defaultValue={s?.phone ?? ""} className={inputCls} />
      </Field>
      <Field label="Email" hint="Where purchase orders and return requests go.">
        <input name="email" type="email" defaultValue={s?.email ?? ""} className={inputCls} />
      </Field>
      <Field label="ABN">
        <input name="abn" defaultValue={s?.abn ?? ""} className={inputCls} />
      </Field>
      <Field label="Address" className="sm:col-span-2">
        <input name="address" defaultValue={s?.address ?? ""} className={inputCls} />
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        <textarea name="notes" rows={2} defaultValue={s?.notes ?? ""} className={`${inputCls} h-auto py-2`} />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={s?.active ?? true} /> {tr("Active (can be ordered from)")}
      </label>
      <div className="sm:col-span-2">
        <FormError message={state && !state.ok ? state.error : null} />
        <SubmitButton>{tr("Save supplier")}</SubmitButton>
      </div>
    </KeptForm>
  );
}
