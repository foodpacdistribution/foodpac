"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { deleteDayPlan } from "@/app/actions/planner";
import { btn, Spinner } from "@/components/ui";
import { useT } from "@/components/i18n";

/** Removes a day's plan from History (only offered when nothing on it was delivered). */
export function DeletePlanButton({ date, label }: { date: string; label: string }) {
  const tr = useT();
  const [pending, start] = useTransition();
  const day = tr(label);
  return (
    <button
      className={btn("ghost", "icon-sm", "text-slate-400 hover:bg-red-50 hover:text-red-600")}
      disabled={pending}
      aria-label={tr("Delete plan for {day}", { day })}
      title={tr("Delete plan")}
      onClick={() =>
        confirm(tr("Delete the plan for {day}? Its orders stay and go back to unplanned.", { day })) &&
        start(async () => {
          const r = await deleteDayPlan(date);
          if (!r.ok) alert(tr(r.error));
        })
      }
    >
      {pending ? <Spinner className="size-3" /> : <Trash2 className="size-3.5" />}
    </button>
  );
}
