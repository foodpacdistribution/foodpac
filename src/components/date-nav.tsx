"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { shiftDate, prettyDate } from "@/lib/dates";
import { btn, Spinner, TopProgress } from "./ui";
import { Tx, useT } from "@/components/i18n";

export function DateNav({ date, today, basePath, extra = "" }: { date: string; today: string; basePath: string; extra?: string }) {
  const tr = useT();
  const router = useRouter();
  // Same page, new data: no loading.tsx fallback, so show progress here while the day loads.
  const [pending, startTransition] = useTransition();
  const go = (d: string) => startTransition(() => router.push(`${basePath}?date=${d}${extra}`));
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-white p-0.5 shadow-sm">
      <button className={btn("ghost", "sm", "px-2")} onClick={() => go(shiftDate(date, -1))} aria-label={tr("Previous day")}>
        <ChevronLeft className="size-4" />
      </button>
      <label className="relative flex items-center gap-1.5 px-1.5 text-sm font-medium text-slate-800">
        {pending ? <Spinner className="text-blue-500" /> : <CalendarDays className="size-4 text-slate-400" />}
        {<Tx>{prettyDate(date)}</Tx>}
        <input type="date" value={date} onChange={(e) => e.target.value && go(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <button className={btn("ghost", "sm", "px-2")} onClick={() => go(shiftDate(date, 1))} aria-label={tr("Next day")}>
        <ChevronRight className="size-4" />
      </button>
      {pending && <TopProgress />}
      {date !== today && (
        <button className={btn("ghost", "sm")} onClick={() => go(today)}>
          {tr("Today")}</button>
      )}
    </div>
  );
}
