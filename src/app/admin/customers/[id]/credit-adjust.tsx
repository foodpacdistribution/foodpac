"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adjustCustomerCredit } from "@/app/actions/customer-returns";
import { FormError, KeptForm, Modal, SubmitButton, useKeptForm } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { btn, Field, inputCls } from "@/components/ui";
import type { ActionResult } from "@/lib/action";

/** Admin: give store credit by hand (goodwill, promotion) or take back credit given in error. Always with a reason. */
export function CreditAdjust({ customerId }: { customerId: string }) {
  const tr = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, form] = useKeptForm(async (prev: ActionResult<unknown> | undefined, fd: FormData) => {
    const r = await adjustCustomerCredit(prev, fd);
    if (r.ok) {
      setOpen(false);
      router.refresh();
    }
    return r;
  });
  return (
    <>
      <button type="button" className={btn("secondary", "sm")} onClick={() => setOpen(true)}>
        {tr("Adjust credit")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={tr("Adjust store credit")}>
        <KeptForm form={form} className="space-y-3">
          <input type="hidden" name="customerId" value={customerId} />
          <Field label="Change">
            <select name="kind" defaultValue="manual_credit" className={inputCls}>
              <option value="manual_credit">{tr("Give credit (goodwill, correction)")}</option>
              <option value="promotion_credit">{tr("Give promotion credit")}</option>
              <option value="credit_reversal">{tr("Take back credit given in error")}</option>
            </select>
          </Field>
          <Field label="Amount ($)">
            <input name="amount" inputMode="decimal" required className={inputCls} />
          </Field>
          <Field label="Reason" hint="Kept with the transaction. History can't be edited: a mistake is fixed with another adjustment.">
            <input name="reason" required className={inputCls} />
          </Field>
          <FormError message={state && !state.ok ? state.error : null} />
          <SubmitButton>{tr("Save")}</SubmitButton>
        </KeptForm>
      </Modal>
    </>
  );
}
