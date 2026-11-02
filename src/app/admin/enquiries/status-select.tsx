"use client";

import { useTransition } from "react";
import { setEnquiryStatus } from "@/app/actions/enquiries";
import { cx, inputCls, Spinner } from "@/components/ui";
import type { EnquiryStatus } from "@/lib/db/schema";

export function StatusSelect({ id, status }: { id: string; status: EnquiryStatus }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      {pending && <Spinner className="text-slate-400" />}
      <select
        aria-label="Status"
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
        <option value="new">New</option>
        <option value="contacted">Contacted</option>
        <option value="closed">Closed</option>
      </select>
    </div>
  );
}
