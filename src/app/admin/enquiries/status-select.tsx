"use client";

import { useTransition } from "react";
import { setEnquiryStatus } from "@/app/actions/enquiries";
import { cx, inputCls, Spinner } from "@/components/ui";
import type { EnquiryStatus } from "@/lib/db/schema";
import { useT } from "@/components/i18n";

export function StatusSelect({ id, status }: { id: string; status: EnquiryStatus }) {
  const tr = useT();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      {pending && <Spinner className="text-slate-400" />}
      <select
        aria-label={tr("Status")}
        defaultValue={status}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as EnquiryStatus;
          startTransition(async () => {
            await setEnquiryStatus(id, next);
          });
        }}
        className={cx(inputCls, "w-36")}
      >
        <option value="new">{tr("New")}</option>
        <option value="contacted">{tr("Contacted")}</option>
        <option value="closed">{tr("Closed")}</option>
      </select>
    </div>
  );
}
