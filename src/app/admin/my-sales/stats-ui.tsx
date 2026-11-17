"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n";
import { cx } from "@/components/ui";
import { prettyDate } from "@/lib/dates";
import { aud } from "@/lib/money";

/** A number that counts up to its value when it first shows (straight to it with reduced motion). */
export function CountUp({ value, money = false, suffix = "" }: { value: number; money?: boolean; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    // With reduced motion the first frame lands on the value.
    const ms = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700;
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = ms ? Math.min(1, (t - start) / ms) : 1;
      const eased = 1 - (1 - k) ** 3;
      setShown(a + (value - a) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  const n = Math.round(shown);
  return (
    <span className="tabular-nums">
      {money ? aud(n) : n.toLocaleString("en-AU")}
      {suffix}
    </span>
  );
}

type Day = { day: string; visits: number; cents: number; orders: number };

/**
 * Visits (or sales) per day as bars that grow in one after another. Tap or point at a day for
 * its numbers.
 */
export function DayBars({ series, kind }: { series: Day[]; kind: "visits" | "sales" }) {
  const tr = useT();
  const [hover, setHover] = useState<number | null>(null);
  const val = (d: Day) => (kind === "visits" ? d.visits : d.cents);
  const max = Math.max(1, ...series.map(val));
  const h = hover !== null ? series[hover] : null;
  const total = series.reduce((t, d) => t + val(d), 0);
  const color = kind === "visits" ? "bg-blue-500" : "bg-emerald-500";
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
              className={cx("block w-full origin-bottom animate-grow-y rounded-t-[3px] transition-opacity", color, hover !== null && hover !== i ? "opacity-35" : "opacity-90 group-hover:opacity-100")}
              style={{ height: `${val(d) ? Math.max(4, (val(d) / max) * 100) : 2}%`, animationDelay: `${Math.min(i * 12, 500)}ms`, ...(val(d) ? {} : { background: "rgb(226 232 240)" }) }}
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

/** Shares of a whole as one bar of coloured segments that fills in from the left. */
export function ShareBar({ parts }: { parts: { key: string; label: string; n: number; color: string }[] }) {
  const tr = useT();
  const total = parts.reduce((t, p) => t + p.n, 0);
  if (!total) return null;
  return (
    <div>
      <div className="flex h-3 origin-left animate-grow-x overflow-hidden rounded-full bg-slate-100">
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
