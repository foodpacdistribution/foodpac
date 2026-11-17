"use client";

import { useState } from "react";
import { useT } from "@/components/i18n";
import { cx } from "@/components/ui";
import { prettyDate } from "@/lib/dates";
import { aud } from "@/lib/money";

type Day = { day: string; visits: number; cents: number; orders: number };

/** Visits (or sales) per day as bars. Tap or point at a day for its numbers. */
export function DayBars({ series, kind }: { series: Day[]; kind: "visits" | "sales" }) {
  const tr = useT();
  const [hover, setHover] = useState<number | null>(null);
  const val = (d: Day) => (kind === "visits" ? d.visits : d.cents);
  const max = Math.max(1, ...series.map(val));
  const h = hover !== null ? series[hover] : null;
  const total = series.reduce((t, d) => t + val(d), 0);
  const color = kind === "visits" ? "bg-blue-600" : "bg-slate-700";
  const step = Math.max(1, Math.round(series.length / 6));
  return (
    <div>
      <p className="h-5 text-xs text-slate-500">
        {h ? (
          <>
            <span className="font-medium text-slate-800">{tr(prettyDate(h.day, { weekday: "short", day: "numeric", month: "short" }))}</span>
            {" · "}
            {kind === "visits" ? tr(h.visits === 1 ? "1 visit" : "{n} visits", { n: h.visits }) : `${aud(h.cents)} · ${tr(h.orders === 1 ? "1 order" : "{n} orders", { n: h.orders })}`}
          </>
        ) : total === 0 ? (
          tr(kind === "visits" ? "No visits in these days" : "No sales in these days")
        ) : null}
      </p>
      <div className="mt-2 flex h-28 items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
        {series.map((d, i) => (
          <button
            key={d.day}
            type="button"
            aria-label={d.day}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(hover === i ? null : i)}
            className="group flex h-full min-w-0 flex-1 items-end"
          >
            <span
              className={cx("block w-full rounded-t-[2px] transition-opacity duration-150", color, hover !== null && hover !== i ? "opacity-40" : "opacity-100")}
              style={{ height: `${val(d) ? Math.max(4, (val(d) / max) * 100) : 2}%`, ...(val(d) ? {} : { background: "rgb(226 232 240)" }) }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-slate-400 tabular-nums">
        {series
          .filter((_, i) => i % step === 0 || i === series.length - 1)
          .map((d) => (
            <span key={d.day}>{d.day.slice(8)}/{d.day.slice(5, 7)}</span>
          ))}
      </div>
    </div>
  );
}

/** Shares of a whole as one bar of coloured segments, with a legend. */
export function ShareBar({ parts }: { parts: { key: string; label: string; n: number; color: string }[] }) {
  const tr = useT();
  const total = parts.reduce((t, p) => t + p.n, 0);
  if (!total) return null;
  return (
    <div>
      <div className="flex h-2 gap-px overflow-hidden rounded-sm bg-slate-100">
        {parts.map((p) => (p.n ? <span key={p.key} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} title={`${tr(p.label)}: ${p.n}`} /> : null))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        {parts.map((p) => (
          <li key={p.key} className={cx("flex items-center gap-1.5", !p.n && "opacity-40")}>
            <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="truncate text-slate-600">{tr(p.label)}</span>
            <span className="ml-auto font-semibold text-slate-900 tabular-nums">{p.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
