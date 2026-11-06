"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError, KeptForm, Modal, SubmitButton, Toast, type ToastMessage, useKeptForm } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { btn, Field, inputCls } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import { money, PAY_METHOD_LABEL, PAY_METHODS } from "@/lib/purchasing/labels";

type Result = ActionResult<unknown>;

/**
 * A button that runs a server action, after an optional confirm, shows the result as a toast and
 * refreshes the page (or goes to `goTo(id)` when the action returns a new document's id).
 */
export function ActionButton({
  run,
  confirmText,
  children,
  variant = "secondary",
  size = "md",
  goTo,
  disabled,
}: {
  run: () => Promise<Result>;
  confirmText?: string;
  children: React.ReactNode;
  variant?: Parameters<typeof btn>[0];
  size?: Parameters<typeof btn>[1];
  goTo?: (id: string) => string;
  disabled?: boolean;
}) {
  const tr = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending || disabled}
        className={btn(variant, size)}
        onClick={() => {
          if (confirmText && !confirm(tr(confirmText))) return;
          start(async () => {
            const r = await run();
            setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Done") : r.error, tone: r.ok ? "ok" : "warn" });
            const newId = r.ok && r.data && typeof r.data === "object" && "id" in r.data ? (r.data as { id: string }).id : null;
            if (r.ok && newId && goTo) router.push(goTo(newId));
            else if (r.ok) router.refresh();
          });
        }}
      >
        {children}
      </button>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

/** "Record payment" / "Record refund": pick the document, then amount, date, method, reference. */
export function MoneyForm({
  action,
  title,
  buttonLabel,
  idField,
  options,
  today,
  defaultId,
  variant = "primary",
}: {
  action: (prev: unknown, form: FormData) => Promise<ActionResult<unknown>>;
  title: string;
  buttonLabel: React.ReactNode;
  idField: "purchaseOrderId" | "purchaseReturnId";
  /** Documents with money still outstanding. */
  options: { id: string; label: string; outstanding: number }[];
  today: string;
  defaultId?: string;
  variant?: Parameters<typeof btn>[0];
}) {
  const tr = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(defaultId ?? options[0]?.id ?? "");
  const [state, form] = useKeptForm(async (prev: ActionResult<unknown> | undefined, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) {
      setOpen(false);
      router.refresh();
    }
    return r;
  });
  const sel = options.find((o) => o.id === chosen);
  return (
    <>
      <button type="button" className={btn(variant)} disabled={!options.length} onClick={() => setOpen(true)}>
        {buttonLabel}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={tr(title)}>
        <KeptForm form={form} className="grid gap-3 sm:grid-cols-2">
          <Field label={idField === "purchaseOrderId" ? "Purchase order" : "Purchase return"} className="sm:col-span-2">
            <select name={idField} value={chosen} onChange={(e) => setChosen(e.target.value)} className={inputCls}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} · {tr("{amount} outstanding", { amount: money(o.outstanding) })}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount (incl. GST)">
            <input key={chosen} name="amount" inputMode="decimal" required defaultValue={sel ? sel.outstanding.toFixed(2) : ""} className={inputCls} />
          </Field>
          <Field label="Date">
            <input type="date" name="date" required defaultValue={today} className={inputCls} />
          </Field>
          <Field label="Method">
            <select name="method" defaultValue="bank_transfer" className={inputCls}>
              {PAY_METHODS.map((m) => (
                <option key={m} value={m}>
                  {tr(PAY_METHOD_LABEL[m])}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reference" hint="Bank reference, receipt or remittance number.">
            <input name="reference" className={inputCls} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <textarea name="notes" rows={2} className={`${inputCls} h-auto py-2`} />
          </Field>
          <div className="sm:col-span-2">
            <FormError message={state && !state.ok ? state.error : null} />
            <SubmitButton>{tr("Save")}</SubmitButton>
          </div>
        </KeptForm>
      </Modal>
    </>
  );
}
