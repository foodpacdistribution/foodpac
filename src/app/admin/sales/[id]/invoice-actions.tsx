"use client";

import { FileText, Mail, Undo2 } from "lucide-react";
import { useState, useTransition } from "react";
import { emailSaleInvoice, finaliseSaleInvoice, reopenSaleInvoice } from "@/app/actions/sales";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn } from "@/components/ui";
import type { InvoiceStatus } from "@/lib/db/schema";

/** The order's invoice: proforma → final (locks the order) → emailed to the customer with their statement. */
export function InvoiceActions(p: {
  id: string;
  number: string;
  invoiceStatus: InvoiceStatus;
  issued: string | null;
  sentAt: string | null;
  sentTo: string | null;
  /** Why it can't be finalised yet (e.g. pending, cancelled), or null. */
  finaliseBlocked: string | null;
  /** Why it can't go back to proforma, or null. */
  reopenBlocked: string | null;
  /** Where the email would go, or null if the customer has no address. */
  emailTo: string | null;
  emailEnabled: boolean;
  /** Units still waiting for stock. */
  waiting: number;
}) {
  const tr = useT();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Done") : r.error, tone: r.ok ? "ok" : "warn" });
    });
  const final = p.invoiceStatus === "final";
  const canEmail = p.emailEnabled && !!p.emailTo;
  const emailHint = !p.emailEnabled
    ? tr("Email isn't set up yet, so invoices can't be emailed. Print it or save it as a PDF instead.")
    : !p.emailTo
      ? tr("This customer has no email address. Add an accounts email on their customer page.")
      : null;

  const finalise = (email: boolean) => {
    const lines = [
      tr("Make invoice {number} final?", { number: p.number }),
      "",
      tr("It becomes the tax invoice, dated today. Lines, prices and delivery details are locked until you reopen it."),
      ...(p.waiting > 0 ? ["", tr("{n} units are still waiting for stock and will be billed as ordered.", { n: p.waiting })] : []),
      ...(email && p.emailTo ? ["", tr("It will be emailed to {to} with their statement of account.", { to: p.emailTo })] : []),
    ];
    if (confirm(lines.join("\n"))) run(() => finaliseSaleInvoice(p.id, { email }));
  };

  return (
    <div className="space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {final ? <Badge tone="green">{tr("Final tax invoice")}</Badge> : <Badge tone="amber">{tr("Proforma")}</Badge>}
        {final && (p.sentAt ? <Badge tone="blue">{tr("Emailed")}</Badge> : <Badge tone="slate">{tr("Not emailed yet")}</Badge>)}
      </div>
      {final ? (
        <div className="space-y-0.5 text-slate-600">
          {p.issued && <p>{tr("Issued {date}", { date: p.issued })}</p>}
          {p.sentAt && p.sentTo && <p>{tr("Emailed {date} to {to}", { date: p.sentAt, to: p.sentTo })}</p>}
        </div>
      ) : (
        <p className="text-slate-600">{tr("Lines and prices can still change. Finalise the invoice once the order is right, then email it to the customer.")}</p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Link href={`/admin/sales/${p.id}/invoice`} className={btn("secondary", "sm")}>
          <FileText className="size-3.5" /> {final ? tr("Tax invoice") : tr("Proforma invoice")}
        </Link>
        {!final && !p.finaliseBlocked && (
          <>
            {canEmail && (
              <button disabled={pending} onClick={() => finalise(true)} className={btn("primary", "sm")}>
                <Mail className="size-3.5" /> {tr("Finalise & email")}
              </button>
            )}
            <button disabled={pending} onClick={() => finalise(false)} className={btn(canEmail ? "secondary" : "primary", "sm")}>
              {tr("Finalise invoice")}
            </button>
          </>
        )}
        {final && canEmail && (
          <button
            disabled={pending}
            onClick={() => confirm(tr("Email invoice {number} and a statement of account to {to}?", { number: p.number, to: p.emailTo! })) && run(() => emailSaleInvoice(p.id))}
            className={btn(p.sentAt ? "secondary" : "primary", "sm")}
          >
            <Mail className="size-3.5" /> {p.sentAt ? tr("Email again") : tr("Email invoice")}
          </button>
        )}
        {final && !p.reopenBlocked && (
          <button
            disabled={pending}
            onClick={() => {
              const msg = [
                tr("Reopen invoice {number} as a proforma so the order can be changed?", { number: p.number }),
                ...(p.sentAt ? ["", tr("The customer already has this invoice by email. Send them the corrected one once it's final again.")] : []),
              ];
              if (confirm(msg.join("\n"))) run(() => reopenSaleInvoice(p.id));
            }}
            className={btn("ghost", "sm")}
          >
            <Undo2 className="size-3.5" /> {tr("Reopen as proforma")}
          </button>
        )}
      </div>
      {!final && p.finaliseBlocked && <p className="text-xs text-slate-500">{tr(p.finaliseBlocked)}</p>}
      {(final || !p.finaliseBlocked) && emailHint && <p className="text-xs text-slate-500">{emailHint}</p>}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
