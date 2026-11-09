"use client";

import { Copy, Mail, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { copyQuote, deleteQuote, emailQuote, setQuoteStatus } from "@/app/actions/quotes";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { btn } from "@/components/ui";
import type { QuoteStatus } from "@/lib/db/schema";

/** Edit, email, record the answer, copy or delete one quote. */
export function QuoteActions(p: { id: string; number: string; status: QuoteStatus; open: boolean; isAdmin: boolean; emailTo: string | null; emailEnabled: boolean; sentAt: string | null }) {
  const tr = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [more, setMore] = useState(false);
  const run = (fn: () => Promise<{ ok: true; message?: string; data?: unknown } | { ok: false; error: string }>, then?: (id?: string) => void) =>
    start(async () => {
      setMore(false);
      const r = await fn();
      setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Done") : r.error, tone: r.ok ? "ok" : "warn" });
      if (r.ok) then?.((r.data as { id?: string } | undefined)?.id);
    });

  const canEmail = p.open && p.emailEnabled && !!p.emailTo;
  return (
    <>
      {p.open && (
        <Link href={`/admin/quotes/${p.id}/edit`} className={btn("secondary")}>
          <Pencil className="size-4" /> {tr("Edit")}
        </Link>
      )}
      {canEmail && (
        <button
          disabled={pending}
          className={btn("secondary")}
          title={p.emailTo!}
          onClick={() => {
            if (p.sentAt && !confirm(tr("This quote was already emailed ({when}). Send it again to {to}?", { when: p.sentAt, to: p.emailTo! }))) return;
            run(() => emailQuote(p.id));
          }}
        >
          <Mail className="size-4" /> {p.sentAt ? tr("Email again") : tr("Email to customer")}
        </button>
      )}
      {p.open && !canEmail && (
        <button disabled className={btn("secondary")} title={!p.emailEnabled ? tr("Email isn't set up yet (Settings).") : tr("This customer has no email address.")}>
          <Mail className="size-4" /> {tr("Email to customer")}
        </button>
      )}
      <div className="relative">
        <button className={btn("secondary", "md")} aria-label={tr("More")} aria-expanded={more} onClick={() => setMore((m) => !m)} onBlur={() => setTimeout(() => setMore(false), 150)}>
          <MoreHorizontal className="size-4" />
        </button>
        {more && (
          <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-white py-1 text-sm shadow-lg">
            {p.open && p.status === "draft" && (
              <MenuItem onClick={() => run(() => setQuoteStatus(p.id, "sent"))}>{tr("Mark as sent (given another way)")}</MenuItem>
            )}
            {p.open && p.status !== "declined" && <MenuItem onClick={() => run(() => setQuoteStatus(p.id, "declined"))}>{tr("Customer declined")}</MenuItem>}
            {p.open && p.status === "declined" && <MenuItem onClick={() => run(() => setQuoteStatus(p.id, "draft"))}>{tr("Reopen as draft")}</MenuItem>}
            <MenuItem onClick={() => run(() => copyQuote(p.id), (id) => id && router.push(`/admin/quotes/${id}`))}>
              <Copy className="size-3.5" /> {tr("Copy to a new quote")}
            </MenuItem>
            {(p.open || p.isAdmin) && (
              <MenuItem
                danger
                onClick={() => {
                  if (!confirm(tr("Delete quote {number}? This can't be undone.", { number: p.number }))) return;
                  run(() => deleteQuote(p.id), () => router.push("/admin/quotes"));
                }}
              >
                <Trash2 className="size-3.5" /> {tr("Delete quote")}
              </MenuItem>
            )}
          </div>
        )}
      </div>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 ${danger ? "text-red-600" : "text-slate-700"}`}>
      {children}
    </button>
  );
}
