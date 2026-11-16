"use client";

import { useState, useTransition } from "react";
import { setMyRestockEmails } from "@/app/actions/shop";
import { useT } from "@/components/i18n";
import { Spinner } from "@/components/ui";

/** "Email me when it's time to reorder": saves as soon as it's ticked. */
export function RestockToggle({ on }: { on: boolean }) {
  const tr = useT();
  const [checked, setChecked] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={checked}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            setChecked(next);
            setError(null);
            start(async () => {
              const r = await setMyRestockEmails(next);
              if (!r.ok) {
                setChecked(!next);
                setError(r.error);
              }
            });
          }}
        />
        <span>
          <span className="font-medium">{tr("Remind me when it's time to reorder")}</span>
          <span className="block text-leaf-900/60">{tr("One email when you're about due for your usual order, with your order sheet ready to go.")}</span>
        </span>
        {pending && <Spinner className="size-4" />}
      </label>
      {error && <p className="mt-2 text-sm text-red-600">{tr(error)}</p>}
    </div>
  );
}
