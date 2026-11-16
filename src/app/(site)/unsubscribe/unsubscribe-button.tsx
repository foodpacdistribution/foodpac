"use client";

import { useState, useTransition } from "react";
import { unsubscribeRestock } from "@/app/actions/shop";
import { useT } from "@/components/i18n";
import { Spinner } from "@/components/ui";

export function UnsubscribeButton({ token }: { token: string }) {
  const tr = useT();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (result?.ok) return <p className="mt-5 font-medium text-leaf-800">{tr(result.text)}</p>;
  return (
    <div className="mt-5">
      <button
        type="button"
        disabled={pending}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-leaf-800 px-5 font-semibold text-white disabled:opacity-60"
        onClick={() =>
          start(async () => {
            const r = await unsubscribeRestock(token);
            setResult(r.ok ? { ok: true, text: r.message ?? "Reorder reminders turned off" } : { ok: false, text: r.error });
          })
        }
      >
        {pending && <Spinner className="size-4" />} {tr("Turn off reminders")}
      </button>
      {result && !result.ok && <p className="mt-3 text-sm text-red-600">{tr(result.text)}</p>}
    </div>
  );
}
