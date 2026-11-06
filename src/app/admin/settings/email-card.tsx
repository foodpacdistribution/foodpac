"use client";

import { Mail } from "lucide-react";
import { sendTestEmail } from "@/app/actions/settings";
import { FormError, KeptForm, SubmitButton, useKeptForm } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { Card, CardHeader, Field, inputCls } from "@/components/ui";
import type { DomainStatus } from "@/lib/email";

/** Where email stands (key, sender, domain in Resend) and a test send that shows Resend's answer. */
export function EmailCard({ sender, office, domain, keyHasExtra, myEmail }: { sender: string; office: string | null; domain: DomainStatus; keyHasExtra: boolean; myEmail: string }) {
  const tr = useT();
  const [state, form] = useKeptForm(sendTestEmail);
  const problems: string[] = [];
  if (domain.kind === "off") problems.push("Email is off: RESEND_API_KEY isn't set.");
  if (keyHasExtra) problems.push("The RESEND_API_KEY setting has more than the key in it (e.g. another line pasted along). Only the first part is used; edit it so it holds just the key.");
  if (domain.kind === "test-sender") problems.push("Mail is sent from Resend's test address, which only delivers to the Resend account's own email. Set EMAIL_FROM to an address on your verified domain.");
  if (domain.kind === "missing") problems.push(`${domain.domain} isn't a domain in this Resend account${domain.others.length ? ` (it has: ${domain.others.join(", ")})` : ""}. Add and verify it in Resend → Domains, or use an API key from the account that has it.`);
  if (domain.kind === "found" && domain.status !== "verified") problems.push(`${domain.domain} is "${domain.status}" in Resend, not verified yet. Finish the DNS records shown in Resend → Domains.`);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Mail className="size-4 text-slate-400" /> {tr("Email")}
          </span>
        }
        subtitle={tr("Password resets, order confirmations and invoices are sent through Resend.")}
      />
      <div className="space-y-3 p-4 text-sm">
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate-500">{tr("Sent from")}</dt>
          <dd className="font-medium break-all">{sender}</dd>
          <dt className="text-slate-500">{tr("Office notifications to")}</dt>
          <dd className="font-medium break-all">{office ?? tr("Not set (OFFICE_EMAIL)")}</dd>
          <dt className="text-slate-500">{tr("Domain in Resend")}</dt>
          <dd className="font-medium">
            {domain.kind === "found"
              ? `${domain.domain} · ${domain.status}${domain.region ? ` · ${domain.region}` : ""}`
              : domain.kind === "unknown"
                ? tr(domain.note)
                : domain.kind === "missing"
                  ? tr("Not found")
                  : "—"}
          </dd>
        </dl>
        {problems.map((p) => (
          <p key={p} className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-amber-200">
            {p}
          </p>
        ))}
        <KeptForm form={form} className="flex flex-wrap items-end gap-3 pt-1">
          <Field label={tr("Send a test email to")} className="min-w-60 flex-1">
            <input name="to" type="email" defaultValue={myEmail} className={inputCls} />
          </Field>
          <SubmitButton>{tr("Send test email")}</SubmitButton>
        </KeptForm>
        <FormError message={state && !state.ok ? state.error : null} />
        {state?.ok && <p className="text-emerald-700">{state.message}</p>}
      </div>
    </Card>
  );
}
