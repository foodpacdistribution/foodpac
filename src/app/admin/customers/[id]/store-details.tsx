"use client";

import { Clock, Pencil, Store, Truck, UserRound } from "lucide-react";
import { useState, useTransition } from "react";
import { saveStoreDetails } from "@/app/actions/pipeline";
import { FormError, Modal, Toast, type ToastMessage } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { btn, Card, CardHeader, cx, Field, inputCls } from "@/components/ui";
import type { StoreType } from "@/lib/db/schema";
import { STORE_TYPE_KEYS, STORE_TYPES } from "@/lib/store-types";

export type StoreDetailsValue = { storeType: StoreType | null; contactName: string | null; bestTime: string | null; currentSupplier: string | null };

/** What the salesperson knows about the store, on the customer page; editable by whoever may serve it. */
export function StoreDetails({ customerId, value, canEdit }: { customerId: string; value: StoreDetailsValue; canEdit: boolean }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  // Shown straight away; the page's fresh data replaces it.
  const [shown, setShown] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setShown(value);
  }
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const empty = !shown.storeType && !shown.contactName && !shown.bestTime && !shown.currentSupplier;
  const rows = [
    { icon: Store, label: "Type of store", value: shown.storeType ? tr(STORE_TYPES[shown.storeType]) : null },
    { icon: UserRound, label: "Talk to", value: shown.contactName },
    { icon: Clock, label: "Best time to come by", value: shown.bestTime },
    { icon: Truck, label: "Supplied by now", value: shown.currentSupplier },
  ];
  return (
    <Card>
      <CardHeader
        title={tr("Store details")}
        action={
          canEdit ? (
            <button type="button" className={btn("ghost", "icon")} onClick={() => setOpen(true)} aria-label={tr("Edit store details")}>
              <Pencil className="size-3.5" />
            </button>
          ) : undefined
        }
      />
      {empty ? (
        <p className="px-4 pb-4 text-sm text-slate-500">
          {canEdit ? (
            <button type="button" onClick={() => setOpen(true)} className="text-left text-blue-700 hover:underline">
              {tr("Add what you know: who to talk to, when to come by, who supplies them now.")}
            </button>
          ) : (
            "—"
          )}
        </p>
      ) : (
        <dl className="divide-y divide-line text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-3 px-4 py-2.5">
              <r.icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">{tr(r.label)}</dt>
                <dd className={cx("break-words", !r.value && "text-slate-400")}>{r.value || "—"}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={tr("Store details")}>
        {open && (
          <StoreDetailsForm
            customerId={customerId}
            value={shown}
            onSaved={(v) => {
              setShown(v);
              setOpen(false);
              setToast((t) => ({ id: (t?.id ?? 0) + 1, text: "Saved", tone: "ok" }));
            }}
          />
        )}
      </Modal>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </Card>
  );
}

/** The store's kind as one tap each, then who, when and the current supplier. */
export function StoreDetailsForm({ customerId, value, onSaved }: { customerId: string; value: StoreDetailsValue; onSaved: (v: StoreDetailsValue) => void }) {
  const tr = useT();
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await saveStoreDetails(customerId, { storeType: v.storeType ?? "", contactName: v.contactName ?? "", bestTime: v.bestTime ?? "", currentSupplier: v.currentSupplier ?? "" });
      if (r.ok) onSaved(v);
      else setError(r.error);
    });
  return (
    <div className="space-y-4">
      <StoreTypePicker value={v.storeType} onChange={(storeType) => setV({ ...v, storeType })} />
      <Field label={tr("Talk to")}>
        <input value={v.contactName ?? ""} onChange={(e) => setV({ ...v, contactName: e.target.value })} maxLength={200} placeholder={tr("e.g. Linda (owner)")} className={inputCls} />
      </Field>
      <Field label={tr("Best time to come by")}>
        <input value={v.bestTime ?? ""} onChange={(e) => setV({ ...v, bestTime: e.target.value })} maxLength={200} placeholder={tr("e.g. Weekdays 2–4pm, not at lunch")} className={inputCls} />
      </Field>
      <Field label={tr("Supplied by now")}>
        <input value={v.currentSupplier ?? ""} onChange={(e) => setV({ ...v, currentSupplier: e.target.value })} maxLength={200} placeholder={tr("e.g. Another wholesaler, picks up from a cash & carry")} className={inputCls} />
      </Field>
      <FormError message={error} />
      <button type="button" className={btn("primary", "lg", "w-full")} disabled={pending} onClick={save}>
        {tr("Save")}
      </button>
    </div>
  );
}

/** The kinds of store as chips; tapping the chosen one again clears it. */
export function StoreTypePicker({ value, onChange }: { value: StoreType | null; onChange: (v: StoreType | null) => void }) {
  const tr = useT();
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium text-slate-600">{tr("Type of store")}</legend>
      <div className="flex flex-wrap gap-2">
        {STORE_TYPE_KEYS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={value === t}
            onClick={() => onChange(value === t ? null : t)}
            className={cx("h-9 rounded-full border px-3 text-sm transition-colors", value === t ? "border-blue-500 bg-blue-50 font-medium text-blue-800" : "border-line hover:border-slate-300")}
          >
            {tr(STORE_TYPES[t])}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
