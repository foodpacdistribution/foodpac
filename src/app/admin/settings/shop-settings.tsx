"use client";

import { saveShopSettings } from "@/app/actions/settings";
import { FormError, SubmitButton, KeptForm, useKeptForm } from "@/components/client-ui";
import { Card, CardHeader, cx, Field, inputCls } from "@/components/ui";
import { minutesToInput } from "@/lib/time";
import { useT } from "@/components/i18n";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ShopSettingsCard(p: {
  deliveryFeeCents: number;
  freeDeliveryOverCents: number;
  minOrderCents: number;
  orderCutoffMin: number;
  deliveryDays: number[];
  bankDetails: string;
  stripe: boolean;
}) {
  const tr = useT();
  const [state, form] = useKeptForm(saveShopSettings);
  const d = (c: number) => (c / 100).toFixed(2);
  return (
    <Card>
      <CardHeader title={tr("Online shop")} subtitle={`Card payments: ${p.stripe ? "on (Stripe)" : "off — set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to accept cards"}`} />
      <KeptForm form={form} className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label={tr("Delivery fee ex GST ($)")}>
          <input name="deliveryFee" inputMode="decimal" defaultValue={d(p.deliveryFeeCents)} className={inputCls} />
        </Field>
        <Field label={tr("Free delivery over ($, 0 = never)")}>
          <input name="freeDeliveryOver" inputMode="decimal" defaultValue={d(p.freeDeliveryOverCents)} className={inputCls} />
        </Field>
        <Field label={tr("Minimum order ex GST ($)")}>
          <input name="minOrder" inputMode="decimal" defaultValue={d(p.minOrderCents)} className={inputCls} />
        </Field>
        <Field label={tr("Order cut-off")} hint={tr("Orders before this time can be delivered the next delivery day.")}>
          <input name="orderCutoff" type="time" defaultValue={minutesToInput(p.orderCutoffMin)} className={inputCls} />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-xs font-medium text-slate-600">{tr("Delivery days")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((day, i) => (
              <label key={day} className="cursor-pointer">
                <input type="checkbox" name="deliveryDays" value={i + 1} defaultChecked={p.deliveryDays.includes(i + 1)} className="peer sr-only" />
                <span className={cx("block rounded-md border border-line px-3 py-1.5 text-sm peer-checked:border-blue-500 peer-checked:bg-blue-50 peer-checked:text-blue-700")}>{tr(day)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={tr("Bank details for transfers")} hint={tr("Shown at checkout and on invoices.")} className="sm:col-span-2">
          <textarea name="bankDetails" rows={3} defaultValue={p.bankDetails} placeholder={"Account name\nBSB 000-000  Account 00000000"} className={cx(inputCls, "h-auto py-2")} />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={state && !state.ok ? state.error : null} />
          {state?.ok && <p className="text-sm text-emerald-700">{state.message}</p>}
        </div>
        <SubmitButton className="sm:col-span-2 sm:w-fit">{tr("Save shop settings")}</SubmitButton>
      </KeptForm>
    </Card>
  );
}
