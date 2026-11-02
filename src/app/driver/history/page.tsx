import { AlertTriangle, Camera, CheckCircle2, MapPin, PenLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cx } from "@/components/ui";
import { requireUser } from "@/lib/auth/dal";
import { prettyDate, shiftDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { driverHistory } from "@/lib/driver-history";
import { DELIVERY_PLACE_WARN_M } from "@/lib/orders";
import { getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Delivery history" };

const RANGES = [14, 30, 90] as const;

export default async function DriverHistoryPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireUser(["driver"]);
  const sp = await searchParams;
  const days = RANGES.find((d) => String(d) === sp.days) ?? 14;
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const history = user.driverId ? await driverHistory(db, user.driverId, shiftDate(today, -(days - 1))) : [];
  const delivered = history.reduce((t, d) => t + d.delivered, 0);
  const failed = history.reduce((t, d) => t + d.failed, 0);
  const time = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, hour: "numeric", minute: "2-digit" });

  return (
    <div className="min-h-dvh">
      <header className="bg-navy-900 px-4 pt-5 pb-16 text-white">
        <div className="mx-auto max-w-lg">
          <p className="text-xs text-slate-400">Last {days} days</p>
          <h1 className="mt-0.5 text-xl font-semibold">Delivery history</h1>
        </div>
      </header>
      <main className="mx-auto -mt-12 max-w-lg space-y-4 px-4">
        <section className="grid grid-cols-3 gap-2 rounded-2xl bg-white p-4 text-center shadow-card">
          <Stat value={delivered} label="Delivered" tone="text-emerald-600" />
          <Stat value={failed} label="Problems" tone={failed ? "text-red-600" : "text-slate-900"} />
          <Stat value={history.length} label="Days worked" tone="text-slate-900" />
        </section>

        <div className="flex gap-2">
          {RANGES.map((d) => (
            <Link
              key={d}
              href={`/driver/history?days=${d}`}
              className={cx("rounded-full px-3.5 py-1.5 text-xs font-medium", d === days ? "bg-navy-900 text-white" : "bg-white text-slate-600 shadow-card")}
            >
              {d} days
            </Link>
          ))}
        </div>

        {history.length === 0 ? (
          <section className="rounded-2xl bg-white p-8 text-center shadow-card">
            <CheckCircle2 className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-semibold text-slate-900">No deliveries in this period</p>
            <p className="mt-1 text-sm text-slate-500">Every delivery you confirm is saved here with its photo and signature.</p>
          </section>
        ) : (
          history.map((day) => (
            <section key={day.date} className="overflow-hidden rounded-2xl bg-white shadow-card">
              <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
                <h2 className="text-sm font-semibold text-slate-900">
                  {day.date === today ? "Today" : prettyDate(day.date, { weekday: "short", day: "numeric", month: "short" })}
                  <span className="ml-2 font-mono text-[11px] font-normal text-slate-400">{day.shipment}</span>
                </h2>
                <p className="text-xs text-slate-500">
                  {day.delivered} delivered{day.failed ? ` · ${day.failed} problem${day.failed === 1 ? "" : "s"}` : ""}
                </p>
              </div>
              <ol className="divide-y divide-line">
                {day.items.map((it) => (
                  <li key={it.stopId} id={it.stopId} className="flex gap-3 px-4 py-3">
                    <span className={cx("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-white", it.status === "delivered" ? "bg-emerald-500" : "bg-red-500")}>
                      {it.status === "delivered" ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium text-slate-900">{it.customerName || it.orderNumber}</span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-500">{time.format(new Date(it.completedAt))}</span>
                      </p>
                      <p className="truncate text-xs text-slate-500">{it.address}</p>
                      <p className={cx("mt-1 text-xs", it.status === "delivered" ? "text-slate-600" : "text-red-700")}>
                        {it.status === "delivered" ? (it.recipient ? `Received by ${it.recipient}` : "Delivered") : (it.reason ?? "Couldn't deliver")}
                        {it.note && <span className="text-slate-500"> · “{it.note}”</span>}
                      </p>
                      {it.placeM !== null && (
                        <p className={cx("mt-0.5 flex items-center gap-1 text-[11px]", it.placeM > DELIVERY_PLACE_WARN_M ? "text-amber-700" : "text-slate-400")}>
                          <MapPin className="size-3" /> Confirmed {it.placeM < 1000 ? `${it.placeM} m` : `${(it.placeM / 1000).toFixed(1)} km`} from the address
                        </p>
                      )}
                      {(it.photoId || it.signatureId) && (
                        <div className="mt-2 flex gap-2">
                          {it.photoId && <Proof id={it.photoId} label="Photo" icon={Camera} />}
                          {it.signatureId && <Proof id={it.signatureId} label="Signature" icon={PenLine} contain />}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
      </main>
    </div>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div>
      <p className={cx("text-2xl font-semibold tabular-nums", tone)}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function Proof({ id, label, icon: Icon, contain }: { id: string; label: string; icon: typeof Camera; contain?: boolean }) {
  return (
    <a href={`/api/proofs/${id}`} target="_blank" rel="noreferrer" className="block w-24 overflow-hidden rounded-lg border border-line bg-slate-50">
      {/* eslint-disable-next-line @next/next/no-img-element -- private, signed-in image */}
      <img src={`/api/proofs/${id}`} alt={label} loading="lazy" className={cx("h-16 w-full", contain ? "bg-white object-contain p-1" : "object-cover")} />
      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-slate-500">
        <Icon className="size-3" /> {label}
      </span>
    </a>
  );
}
