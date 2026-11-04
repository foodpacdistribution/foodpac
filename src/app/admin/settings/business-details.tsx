"use client";

import { Store } from "lucide-react";
import { saveBusinessDetails } from "@/app/actions/settings";
import { FormError, KeptForm, SubmitButton, useKeptForm } from "@/components/client-ui";
import { Card, CardHeader, Field, inputCls } from "@/components/ui";
import { useT } from "@/components/i18n";
import { SITE } from "@/app/(site)/site-info";

export function BusinessDetailsCard(p: { contactPhone: string; contactEmail: string; contactAddress: string; abn: string; openingHours: string }) {
  const tr = useT();
  const [state, form] = useKeptForm(saveBusinessDetails);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Store className="size-4 text-slate-400" /> {tr("Business details")}
          </span>
        }
        subtitle={tr("Shown in the website footer and contact section, on tax invoices and in emails. Leave a box empty to hide it.")}
      />
      <KeptForm form={form} className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label={tr("Phone")}>
          <input name="contactPhone" type="tel" defaultValue={p.contactPhone} placeholder="07 3000 0000" className={inputCls} />
        </Field>
        <Field label={tr("Email")}>
          <input name="contactEmail" type="email" defaultValue={p.contactEmail} placeholder="orders@example.com.au" className={inputCls} />
        </Field>
        <Field label={tr("Address")} className="sm:col-span-2">
          <input name="contactAddress" defaultValue={p.contactAddress} placeholder="12 Example St, Eagle Farm QLD 4009" className={inputCls} />
        </Field>
        <Field label={tr("ABN")} hint={tr("Printed on tax invoices. Required once you're registered for GST.")}>
          <input name="abn" inputMode="numeric" defaultValue={p.abn} placeholder="12 345 678 901" className={inputCls} />
        </Field>
        <Field label={tr("Opening hours")}>
          <input name="openingHours" defaultValue={p.openingHours} placeholder={SITE.hours} className={inputCls} />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={state && !state.ok ? state.error : null} />
          {state?.ok && <p className="text-sm text-emerald-700">{tr(state.message ?? "Saved")}</p>}
        </div>
        <SubmitButton className="sm:col-span-2 sm:w-fit">{tr("Save business details")}</SubmitButton>
      </KeptForm>
    </Card>
  );
}
