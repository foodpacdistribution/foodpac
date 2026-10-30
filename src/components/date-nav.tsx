"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { shiftDate, prettyDate } from "@/lib/dates";
import { btn } from "./ui";

export function DateNav({ date, today, basePath, extra = "" }: { date: string; today: string; basePath: string; extra?: string }) {
  const router = useRouter();
  const go = (d: string) => router.push(`${basePath}?date=${d}${extra}`);
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-white p-0.5 shadow-sm">
      <button className={btn("ghost", "sm", "px-2")} onClick={() => go(shiftDate(date, -1))} aria-label="Previous day">
        <ChevronLeft className="size-4" />
      </button>
      <label className="relative flex items-center gap-1.5 px-1.5 text-sm font-medium text-slate-800">
        <CalendarDays className="size-4 text-slate-400" />
        {prettyDate(date)}
        <input type="date" value={date} onChange={(e) => e.target.value && go(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <button className={btn("ghost", "sm", "px-2")} onClick={() => go(shiftDate(date, 1))} aria-label="Next day">
        <ChevronRight className="size-4" />
      </button>
      {date !== today && (
        <button className={btn("ghost", "sm")} onClick={() => go(today)}>
          Today
        </button>
      )}
    </div>
  );
}
