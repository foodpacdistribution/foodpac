"use client";

import { CheckCircle2, ChevronDown, Clock, History, LocateFixed, LocateOff, LogOut, MapPin, Navigation, Phone, PlayCircle, RefreshCcw, Route, StickyNote, TriangleAlert, Truck, Warehouse, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { logout } from "@/app/actions/auth";
import { markDelivered, markFailed, startRoute } from "@/app/actions/driver";
import { Modal, Toast, type ToastMessage } from "@/components/client-ui";
import { LanguageSwitch } from "@/components/language-switch";
import { DeliveryMap, type MapStop } from "@/components/map";
import { Badge, btn, cx, Spinner } from "@/components/ui";
import { prettyDate } from "@/lib/dates";
import { multiStopNavigation, navigationUrls } from "@/lib/orders";
import type { RouteView, StopView } from "@/lib/planning";
import { formatClock, formatMinutesClock } from "@/lib/time";
import { OutcomeForm } from "./outcome-form";
import { readSharePref, useLocationSharing, writeSharePref } from "./use-location-sharing";
import { Tx, useT } from "@/components/i18n";

type Props = {
  name: string;
  linked: boolean;
  date: string;
  today: string;
  /** Days from today on with a route sent to this driver, and how many stops each has. */
  days: { date: string; stops: number }[];
  nowS: number;
  depot: { id: string; lat: number; lng: number; name: string } | null;
  route: RouteView | null;
  requirePhoto: boolean;
  requireSignature: boolean;
};

function greeting(nowS: number) {
  const h = nowS / 3600;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function DriverClient({ name, linked, date, today, days, nowS, depot, route, requirePhoto, requireSignature }: Props) {
  const tr = useT();
  const [sharePref, setSharePref] = useState(readSharePref);
  const sharing = useLocationSharing(route?.status === "in_progress" && sharePref);
  const [pending, startTransition] = useTransition();
  // The stop the sheet was opened for. Saving refreshes the route, so `current` can already be the next stop by the time it's done.
  const [sheet, setSheet] = useState<null | { kind: "delivered" | "failed"; stopId: string; name: string; reference: string }>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const stops = route?.stops ?? [];
  const pendingStops = stops.filter((s) => s.status === "pending");
  const completedStops = stops.filter((s) => s.status !== "pending");
  const [cleared, setCleared] = useClearedStops(date);
  const [showDone, setShowDone] = useState(false);
  const visibleDone = completedStops.filter((s) => !cleared.has(s.id));
  const lastDoneAt = completedStops.map((s) => s.completedAt).filter(Boolean).sort().at(-1);
  const doneCount = stops.length - pendingStops.length;
  const current: StopView | undefined = pendingStops.find((s) => s.id === selectedId) ?? pendingStops[0];
  const openSheet = (kind: "delivered" | "failed") =>
    current && setSheet({ kind, stopId: current.id, name: current.order.customerName || current.order.orderNumber, reference: current.order.orderNumber });
  const finishSheet = (t: Omit<ToastMessage, "id">) => {
    setSheet(null);
    setSelectedId(null);
    setToast({ id: Date.now(), ...t });
  };
  // A later day's stops can't be running late yet.
  const delay = current && date === today ? Math.max(0, nowS - current.etaS) : 0;
  // A planned depot reload sits between the previous stop and this one.
  const reloadBefore = current && route ? route.reloads.find((r) => r.afterSeq === current.seq - 1) : undefined;
  // Remaining stops from the current one in planned order, with the depot inserted where a reload is planned.
  const multiNav = (() => {
    if (!current || !route) return null;
    const pts: { lat: number; lng: number }[] = [];
    if (reloadBefore && depot) pts.push(depot);
    for (const s of pendingStops.filter((x) => x.seq >= current.seq)) {
      pts.push({ lat: s.order.lat, lng: s.order.lng });
      if (depot && route.reloads.some((r) => r.afterSeq === s.seq) && s.seq < stops.length) pts.push(depot);
    }
    return pts.length > 1 ? multiStopNavigation(pts) : null;
  })();
  const projectedFinish = route ? route.endS + (route.status === "in_progress" ? delay : 0) : null;

  const header = (
    <header className="bg-navy-900 px-4 pb-16 pt-5 text-white">
      <div className="mx-auto flex max-w-lg items-start justify-between">
        <div>
          <p className="text-xs text-slate-400">{<Tx>{prettyDate(date, { weekday: "long", day: "numeric", month: "long" })}</Tx>}</p>
          <h1 className="mt-0.5 text-xl font-semibold">
            {tr(greeting(nowS))}, {name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitch tone="dark" />
          <form action={logout}>
            <button className="grid size-9 place-items-center rounded-full bg-white/10 text-slate-300" aria-label={tr("Sign out")}>
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );

  // Shipments sent for later days show up as soon as they're sent, not only on the day.
  const dayTabs = (days.some((d) => d.date !== today) || date !== today) && (
    <nav className="flex gap-2 overflow-x-auto pb-1" aria-label={tr("Delivery days")}>
      {[{ date: today, stops: days.find((d) => d.date === today)?.stops ?? 0 }, ...days.filter((d) => d.date !== today)].map((d) => (
        <Link
          key={d.date}
          href={d.date === today ? "/driver" : `/driver?date=${d.date}`}
          className={cx(
            "shrink-0 rounded-xl px-3 py-2 text-xs font-medium shadow-card",
            d.date === date ? "bg-blue-600 text-white" : "bg-white text-slate-700",
          )}
        >
          <span className="block">{d.date === today ? tr("Today") : <Tx>{prettyDate(d.date, { weekday: "short", day: "numeric", month: "short" })}</Tx>}</span>
          <span className={cx("block text-[11px]", d.date === date ? "text-blue-100" : "text-slate-400")}>{tr("{n} stops", { n: d.stops })}</span>
        </Link>
      ))}
    </nav>
  );

  if (!linked || !route) {
    return (
      <div className="min-h-dvh">
        {header}
        <main className="mx-auto -mt-10 max-w-lg space-y-4 px-4">
          {dayTabs}
          <div className="rounded-2xl bg-white p-8 text-center shadow-card">
            <Truck className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-semibold text-slate-900">{linked ? tr("No deliveries dispatched yet") : tr("Account not linked")}</p>
            <p className="mt-1 text-sm text-slate-500">
              {linked
                ? tr("Your shipment appears here as soon as the office sends it. This page refreshes automatically.")
                : tr("Ask your dispatcher to link your login to your driver profile.")}
            </p>
            {linked && (
              <Link href="/driver/history" className={btn("secondary", "md", "mt-5 rounded-xl")}>
                <History className="size-4" /> {" "}{tr("Past deliveries")}</Link>
            )}
          </div>
        </main>
      </div>
    );
  }

  const mapStops: MapStop[] = stops.map((s) => ({
    id: s.id,
    routeId: route.id,
    lat: s.order.lat,
    lng: s.order.lng,
    label: String(s.seq),
    color: route.color,
    status: s.status,
    title: `${s.seq}. ${s.order.customerName || s.order.orderNumber}`,
    lines: [s.order.address, `ETA ${formatClock(s.etaS)}`],
    navigateUrl: navigationUrls(s.order.lat, s.order.lng).google,
  }));

  return (
    <div className="min-h-dvh pb-10">
      {header}
      <main className="mx-auto -mt-12 max-w-lg space-y-4 px-4">
        {dayTabs}
        {date !== today && (
          <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-900 ring-1 ring-blue-200">
            {tr("This shipment is for {day}. You can look it over now; deliver it on the day.", { day: tr(prettyDate(date, { weekday: "long", day: "numeric", month: "long" })) })}
          </p>
        )}
        {/* Progress */}
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <div className="grid grid-cols-3 text-center">
            {[
              ["Stops", stops.length],
              ["Completed", doneCount],
              ["Remaining", pendingStops.length],
            ].map(([l, n]) => (
              <div key={l}>
                <p className="text-2xl font-semibold tabular-nums text-slate-900">{n}</p>
                <p className="text-xs text-slate-500">{tr(l as string)}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / Math.max(1, stops.length)) * 100}%` }} />
          </div>
          <p className="mt-3 flex items-center justify-between text-sm">
            <span className="text-slate-500">{tr("Estimated finish")}</span>
            <span className="font-semibold text-slate-900">
              {formatClock(projectedFinish)}
              {delay > 600 && route.status === "in_progress" && <span className="ml-1.5 text-xs font-normal text-amber-600">{tr("running late")}</span>}
            </span>
          </p>
        </section>

        {route.status === "in_progress" && (
          <LocationBar
            status={sharing.status}
            lastSentAt={sharing.lastSentAt}
            enabled={sharePref}
            onToggle={(on) => {
              writeSharePref(on);
              setSharePref(on);
            }}
          />
        )}

        {route.status === "planned" && current && (
          <p className="flex items-center gap-2 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <PlayCircle className="size-5 shrink-0 text-blue-600" />
            <span>
              {tr("Tap")}{" "}<strong>{tr("Start route & navigate")}</strong> {" "}{tr("when you set off. Dispatch will see you're on the road.")}</span>
          </p>
        )}

        {/* Next delivery */}
        {current ? (
          // Keyed by stop so the next delivery visibly slides in after one is finished.
          <section key={current.id} className="animate-rise overflow-hidden rounded-2xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                {current.id === pendingStops[0]?.id ? tr("Next delivery") : tr("Selected stop")} {" "}{tr("· Stop")}{" "}{current.seq}
              </p>
              <span className="text-xs text-slate-500">{current.order.orderNumber}</span>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{current.order.customerName || tr("Customer")}</h2>
                <p className="mt-0.5 flex items-start gap-1.5 text-sm text-slate-600">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />
                  {current.order.address}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700">
                  <Clock className="size-3.5" /> {" "}{tr("ETA")}{" "}{formatClock(current.etaS)}
                </span>
                {(current.order.windowStartMin !== null || current.order.windowEndMin !== null) && (
                  <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-amber-800">
                    {tr("Window")}{" "}{formatMinutesClock(current.order.windowStartMin)}–{formatMinutesClock(current.order.windowEndMin)}
                  </span>
                )}
                {current.order.demand > 1 && <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700">{current.order.demand} {" "}{tr("units")}</span>}
              </div>
              {current.order.notes && (
                <p className="flex gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  <StickyNote className="mt-0.5 size-4 shrink-0" />
                  {current.order.notes}
                </p>
              )}
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <a
                  href={navigationUrls(current.order.lat, current.order.lng).google}
                  target="_blank"
                  rel="noreferrer"
                  className={btn("primary", "lg", "rounded-xl")}
                  // Setting off is when the route starts: one tap instead of a separate "Start" step.
                  onClick={() => route.status === "planned" && startTransition(async () => {
                    await startRoute(route.id);
                  })}
                >
                  {pending ? <Spinner className="size-5" /> : <Navigation className="size-5" />} {route.status === "planned" ? (pending ? tr("Starting…") : tr("Start route & navigate")) : tr("Navigate")}
                </a>
                {current.order.phone && (
                  <a href={`tel:${current.order.phone.replace(/\s+/g, "")}`} className={btn("secondary", "lg", "rounded-xl px-4")} aria-label={tr("Call customer")}>
                    <Phone className="size-5" />
                  </a>
                )}
              </div>
              <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <a href={navigationUrls(current.order.lat, current.order.lng).apple} target="_blank" rel="noreferrer" className="underline">
                  {tr("Use Apple Maps")}</a>
                {multiNav && (
                  <a href={multiNav.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline">
                    <Route className="size-3.5" /> {" "}{tr("Next")}{" "}{multiNav.count} {" "}{tr("stops in Google Maps")}</a>
                )}
              </p>
              <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
                <button className={btn("success", "lg", "rounded-xl")} onClick={() => openSheet("delivered")}>
                  <CheckCircle2 className="size-5" /> {" "}{tr("Delivered")}</button>
                <button className={btn("danger", "lg", "rounded-xl")} onClick={() => openSheet("failed")}>
                  <TriangleAlert className="size-5" /> {" "}{tr("Problem")}</button>
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-2xl bg-white p-6 text-center shadow-card">
            <CheckCircle2 className="mx-auto size-12 animate-check text-emerald-500" />
            <p className="mt-3 text-lg font-semibold">{tr("All stops completed")}</p>
            <p className="mt-1 text-sm text-slate-500">{tr("Great work today. Drive safely back to")}{" "}{depot?.name ?? tr("the depot")}.</p>
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 py-3">
              <div>
                <p className="text-xl font-semibold tabular-nums text-emerald-600">{completedStops.filter((s) => s.status === "delivered").length}</p>
                <p className="text-[11px] text-slate-500">{tr("Delivered")}</p>
              </div>
              <div>
                <p className={cx("text-xl font-semibold tabular-nums", completedStops.some((s) => s.status === "failed") ? "text-red-600" : "text-slate-900")}>
                  {completedStops.filter((s) => s.status === "failed").length}
                </p>
                <p className="text-[11px] text-slate-500">{tr("Problems")}</p>
              </div>
              <div>
                <p className="text-xl font-semibold tabular-nums text-slate-900">
                  {lastDoneAt ? new Date(lastDoneAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : "—"}
                </p>
                <p className="text-[11px] text-slate-500">{tr("Finished")}</p>
              </div>
            </div>
            <Link href="/driver/history" className={btn("secondary", "md", "mt-4 w-full rounded-xl")}>
              <History className="size-4" /> {" "}{tr("View delivery history")}</Link>
          </section>
        )}

        {current && reloadBefore && depot && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <Warehouse className="size-4" /> {" "}{tr("Reload at")}{" "}{depot.name} {" "}{tr("before this stop")}</p>
            <p className="mt-1 text-xs text-amber-800">
              {tr("Trip")}{" "}{current.trip}{tr(": be at the depot around")}{" "}{formatClock(reloadBefore.arrivalS)}{tr(", leave by")}{" "}{formatClock(reloadBefore.departureS)}.
            </p>
            <a href={navigationUrls(depot.lat, depot.lng).google} target="_blank" rel="noreferrer" className={btn("secondary", "sm", "mt-2.5")}>
              <Navigation className="size-3.5" /> {" "}{tr("Navigate to depot")}</a>
          </section>
        )}

        <button className={btn("secondary", "md", "w-full rounded-xl")} onClick={() => setShowMap(!showMap)}>
          {showMap ? tr("Hide route map") : tr("Show route map")}
        </button>
        {showMap && (
          <div className="h-72 overflow-hidden rounded-2xl shadow-card">
            <DeliveryMap
              depots={depot ? [depot] : []}
              stops={mapStops}
              routes={route.geometry ? [{ id: route.id, color: route.color, path: route.geometry }] : []}
              highlightStopId={current?.id}
            />
          </div>
        )}

        {/* All stops */}
        <section className="overflow-hidden rounded-2xl bg-white shadow-card">
          <h3 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-slate-900">
            {pendingStops.length ? tr(`To deliver · ${pendingStops.length}`) : tr("Today's stops")}
          </h3>
          {pendingStops.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">{tr("Nothing left to deliver.")}</p>}
          <ol className="divide-y divide-line">
            {pendingStops.map((s) => {
              const isCurrent = s.id === current?.id;
              const reload = route.reloads.find((r) => r.afterSeq === s.seq);
              return (
                <li key={s.id}>
                  <div className={cx("flex items-center", isCurrent && "bg-blue-50")}>
                  <button
                    disabled={s.status !== "pending"}
                    onClick={() => {
                      setSelectedId(s.id);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left"
                  >
                    <span
                      className={cx(
                        "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white",
                        s.status === "delivered" ? "bg-emerald-500" : s.status === "failed" ? "bg-red-500" : "",
                      )}
                      style={s.status === "pending" ? { background: route.color } : undefined}
                    >
                      {s.status === "delivered" ? "✓" : s.status === "failed" ? "!" : s.seq}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx("block truncate text-sm font-medium", s.status !== "pending" ? "text-slate-400" : "text-slate-900")}>
                        {s.order.customerName || s.order.orderNumber}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{s.order.address}</span>
                    </span>
                    {s.status === "pending" ? (
                      <span className="text-sm font-semibold tabular-nums text-slate-700">{formatClock(s.etaS)}</span>
                    ) : (
                      <Badge tone={s.status === "delivered" ? "green" : "red"}>{s.status === "delivered" ? tr("Delivered") : tr("Failed")}</Badge>
                    )}
                  </button>
                  {s.status === "pending" ? (
                    <a
                      href={navigationUrls(s.order.lat, s.order.lng).google}
                      target="_blank"
                      rel="noreferrer"
                      className="mr-3 grid size-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600"
                      aria-label={`Navigate to ${s.order.customerName || s.order.orderNumber}`}
                    >
                      <Navigation className="size-4" />
                    </a>
                  ) : (
                    <span className="mr-3 size-9 shrink-0" />
                  )}
                  </div>
                  {reload && (
                    <p className="flex items-center gap-2 bg-amber-50/70 px-4 py-2 text-xs text-amber-800">
                      <RefreshCcw className="size-3.5" /> {" "}{tr("Reload at depot ·")}{" "}{formatClock(reload.arrivalS)}–{formatClock(reload.departureS)}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {completedStops.length > 0 && (
          <section className="overflow-hidden rounded-2xl bg-white shadow-card">
            <button
              onClick={() => setShowDone(!showDone)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-semibold text-slate-900"
              aria-expanded={showDone || !pendingStops.length}
            >
              <span>
                {tr("Completed ·")}{" "}{completedStops.length}
                {cleared.size > 0 && <span className="ml-1.5 text-xs font-normal text-slate-400">({completedStops.length - visibleDone.length} {" "}{tr("cleared)")}</span>}
              </span>
              <ChevronDown className={cx("size-4 text-slate-400 transition-transform", (showDone || !pendingStops.length) && "rotate-180")} />
            </button>
            {(showDone || !pendingStops.length) && (
              <>
                {visibleDone.length > 0 && (
                  <ol className="divide-y divide-line border-t border-line">
                    {visibleDone.map((s) => (
                      <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className={cx("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white", s.status === "delivered" ? "bg-emerald-500" : "bg-red-500")}>
                          {s.status === "delivered" ? "✓" : "!"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-500">{s.order.customerName || s.order.orderNumber}</span>
                          <span className="block truncate text-xs text-slate-400">{s.order.address}</span>
                        </span>
                        <Badge tone={s.status === "delivered" ? "green" : "red"}>{s.status === "delivered" ? tr("Delivered") : tr("Problem")}</Badge>
                        <button
                          onClick={() => setCleared(new Set([...cleared, s.id]))}
                          className="grid size-8 place-items-center rounded-full text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                          aria-label={`Clear ${s.order.customerName || s.order.orderNumber} from my list`}
                        >
                          <X className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
                  {visibleDone.length > 0 ? (
                    <button onClick={() => setCleared(new Set(completedStops.map((s) => s.id)))} className="text-xs font-medium text-slate-500 hover:text-slate-800">
                      {tr("Clear all from my list")}</button>
                  ) : (
                    <button onClick={() => setCleared(new Set())} className="text-xs font-medium text-slate-500 hover:text-slate-800">
                      {tr("Show cleared stops")}</button>
                  )}
                  <Link href="/driver/history" className="flex items-center gap-1 text-xs font-medium text-blue-600">
                    <History className="size-3.5" /> {" "}{tr("History")}</Link>
                </div>
              </>
            )}
          </section>
        )}
      </main>

      <Modal open={sheet?.kind === "delivered"} onClose={() => setSheet(null)} title={tr("Confirm delivery")}>
        {sheet && (
          <OutcomeForm
            kind="delivered"
            action={markDelivered}
            fields={{ stopId: sheet.stopId }}
            reference={sheet.reference}
            requirePhoto={requirePhoto}
            requireSignature={requireSignature}
            onDone={() => finishSheet({ tone: "ok", text: `Delivered · ${sheet.name}` })}
          />
        )}
      </Modal>
      <Modal open={sheet?.kind === "failed"} onClose={() => setSheet(null)} title={tr("Report a delivery problem")}>
        {sheet && <OutcomeForm kind="failed" action={markFailed} fields={{ stopId: sheet.stopId }} onDone={() => finishSheet({ tone: "warn", text: `Problem reported · ${sheet.name}` })} />}
      </Modal>
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}

function LocationBar({
  status,
  lastSentAt,
  enabled,
  onToggle,
}: {
  status: string;
  lastSentAt: number | null;
  enabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  const tr = useT();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);
  // eslint-disable-next-line react-hooks/purity -- "x s ago" label, refreshed by the interval above
  const ago = lastSentAt ? Math.round((Date.now() - lastSentAt) / 1000) : null;
  const text = !enabled
    ? "Live location off — dispatch can't see where you are"
    : status === "denied"
      ? "Location permission denied — allow it in your browser settings"
      : status === "unavailable"
        ? "Location unavailable on this device"
        : status === "on"
          ? `Sharing live location${ago !== null ? ` · sent ${ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago` : ""}`
          : status === "stopped"
            ? "Location sharing ended for today"
            : "Starting location…";
  const good = enabled && status === "on";
  return (
    <section className={cx("flex items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-card", good ? "bg-emerald-50 text-emerald-900" : "bg-white text-slate-600")}>
      {good ? <LocateFixed className="size-5 shrink-0 text-emerald-600" /> : <LocateOff className="size-5 shrink-0 text-slate-400" />}
      <span className="min-w-0 flex-1">
        {<Tx>{text}</Tx>}
        {good && <span className="block text-[11px] text-emerald-700/80">{tr("Keep this page open while driving. Sharing stops when your route is finished.")}</span>}
      </span>
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input type="checkbox" className="peer sr-only" checked={enabled} onChange={(e) => onToggle(e.target.checked)} aria-label={tr("Share live location")} />
        <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-emerald-500" />
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </label>
    </section>
  );
}

/**
 * Completed stops the driver cleared from today's list. Only hidden on this phone: the delivery
 * record, photo and signature stay in History and with the office.
 */
function useClearedStops(date: string): [Set<string>, (next: Set<string>) => void] {
  const key = `dp.cleared.${date}`;
  // Read through useSyncExternalStore so the server render (nothing cleared) and the phone agree.
  const raw = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("dp:cleared", onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener("dp:cleared", onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => {
      try {
        return localStorage.getItem(key) ?? "[]";
      } catch {
        return "[]";
      }
    },
    () => "[]",
  );
  const cleared = useMemo(() => new Set(JSON.parse(raw) as string[]), [raw]);
  const set = (next: Set<string>) => {
    try {
      localStorage.setItem(key, JSON.stringify([...next]));
    } catch {
      // Storage blocked: nothing to remember.
    }
    window.dispatchEvent(new Event("dp:cleared"));
  };
  return [cleared, set];
}
