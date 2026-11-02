"use client";

import { useState } from "react";
import { useT } from "@/components/i18n";
import { prettyDate } from "@/lib/dates";
import { aud } from "@/lib/money";

type Day = { day: string; cents: number; orders: number };

const H = 180;

/** One bar per day. Hover (or tap) a day for its sales and order count. */
export function DailyChart({ series, today }: { series: Day[]; today: string }) {
  const tr = useT();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...series.map((d) => d.cents)));
  const ticks = [0, max / 2, max];
  const labelEvery = series.length > 31 ? 14 : series.length > 7 ? 7 : 1;
  const h = hover !== null ? series[hover] : null;

  return (
    <div className="px-4 pb-4">
      <div className="relative flex gap-2">
        {/* y axis */}
        <div className="relative w-14 shrink-0 text-right text-[10px] tabular-nums text-slate-400" style={{ height: H }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / max) * H }}>
              {compact(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-slate-100" style={{ top: H - (t / max) * H }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {series.map((d, i) => (
              <button
                key={d.day}
                type="button"
                aria-label={`${d.day}: ${aud(d.cents)}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onClick={() => setHover(i)}
                className="group flex h-full min-w-0 flex-1 items-end"
              >
                <span
                  className={`block w-full rounded-t-[4px] transition-colors ${hover === i ? "bg-blue-700" : d.day === today ? "bg-blue-500" : "bg-blue-600/85"}`}
                  style={{ height: d.cents ? Math.max(3, (d.cents / max) * H) : 0 }}
                />
              </button>
            ))}
          </div>
          {h && hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg"
              style={{ left: `clamp(60px, ${((hover + 0.5) / series.length) * 100}%, calc(100% - 60px))` }}
            >
              <p className="text-slate-300">{tr(prettyDate(h.day))}</p>
              <p className="font-semibold tabular-nums">{aud(h.cents)}</p>
              <p className="text-slate-300">{tr(h.orders === 1 ? "{n} order" : "{n} orders", { n: h.orders })}</p>
            </div>
          )}
        </div>
      </div>
      {/* x axis */}
      <div className="mt-1.5 flex gap-[2px] pl-16 text-[10px] text-slate-400">
        {series.map((d, i) => (
          <span key={d.day} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
            {i % labelEvery === 0 ? tr(prettyDate(d.day, { day: "numeric", month: "short" })) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Round the top of the scale up to 1, 2 or 5 × a power of ten. */
function niceMax(v: number) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

const compact = (cents: number) => {
  const d = cents / 100;
  return d >= 1000 ? `$${(d / 1000).toFixed(d >= 10000 ? 0 : 1)}k` : `$${Math.round(d)}`;
};
