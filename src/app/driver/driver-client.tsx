"use client";

import { CheckCircle2, ChevronDown, Clock, History, LocateFixed, LocateOff, LogOut, MapPin, Navigation, Phone, PlayCircle, RefreshCcw, Route, StickyNote, TriangleAlert, Truck, Warehouse, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { logout } from "@/app/actions/auth";
import { markDelivered, markFailed, startRoute } from "@/app/actions/driver";
import { FormError, Modal, SubmitButton, Toast, type ToastMessage } from "@/components/client-ui";
import { DeliveryMap, type MapStop } from "@/components/map";
import { Badge, btn, cx, Field, inputCls, Spinner } from "@/components/ui";
import { prettyDate } from "@/lib/dates";
import { FAILURE_REASONS, multiStopNavigation, navigationUrls } from "@/lib/orders";
import type { RouteView, StopView } from "@/lib/planning";
import { formatClock, formatMinutesClock } from "@/lib/time";
import { PhotoCapture, SignaturePad } from "./proof-inputs";
import { readSharePref, useBestFix, useLocationSharing, writeSharePref } from "./use-location-sharing";

type Props = {
  name: string;
  linked: boolean;
  date: string;
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

export function DriverClient({ name, linked, date, nowS, depot, route, requirePhoto, requireSignature }: Props) {
  const router = useRouter();
  const [sharePref, setSharePref] = useState(readSharePref);
  const sharing = useLocationSharing(route?.status === "in_progress" && sharePref);
  const [pending, startTransition] = useTransition();
  // The stop the sheet was opened for. Saving refreshes the route, so `current` can already be the next stop by the time it's done.
  const [sheet, setSheet] = useState<null | { kind: "delivered" | "failed"; stopId: string; name: string }>(null);
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
    current && setSheet({ kind, stopId: current.id, name: current.order.customerName || current.order.orderNumber });
  const finishSheet = (t: Omit<ToastMessage, "id">) => {
    setSheet(null);
    setSelectedId(null);
    setToast({ id: Date.now(), ...t });
    router.refresh();
  };
  const delay = current ? Math.max(0, nowS - current.etaS) : 0;
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
          <p className="text-xs text-slate-400">{prettyDate(date, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="mt-0.5 text-xl font-semibold">
            {greeting(nowS)}, {name}
          </h1>
        </div>
        <div className="flex gap-2">
          <form action={logout}>
            <button className="grid size-9 place-items-center rounded-full bg-white/10 text-slate-300" aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );

  if (!linked || !route) {
    return (
      <div className="min-h-dvh">
        {header}
        <main className="mx-auto -mt-10 max-w-lg px-4">
          <div className="rounded-2xl bg-white p-8 text-center shadow-card">
            <Truck className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-semibold text-slate-900">{linked ? "No deliveries dispatched yet" : "Account not linked"}</p>
            <p className="mt-1 text-sm text-slate-500">
              {linked
                ? "Your shipment appears here as soon as the office sends it. This page refreshes automatically."
                : "Ask your dispatcher to link your login to your driver profile."}
            </p>
            {linked && (
              <Link href="/driver/history" className={btn("secondary", "md", "mt-5 rounded-xl")}>
                <History className="size-4" /> Past deliveries
              </Link>
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
                <p className="text-xs text-slate-500">{l}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / Math.max(1, stops.length)) * 100}%` }} />
          </div>
          <p className="mt-3 flex items-center justify-between text-sm">
            <span className="text-slate-500">Estimated finish</span>
            <span className="font-semibold text-slate-900">
              {formatClock(projectedFinish)}
              {delay > 600 && route.status === "in_progress" && <span className="ml-1.5 text-xs font-normal text-amber-600">running late</span>}
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
              Tap <strong>Start route &amp; navigate</strong> when you set off. Dispatch will see you&apos;re on the road.
            </span>
          </p>
        )}

        {/* Next delivery */}
        {current ? (
          // Keyed by stop so the next delivery visibly slides in after one is finished.
          <section key={current.id} className="animate-rise overflow-hidden rounded-2xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                {current.id === pendingStops[0]?.id ? "Next delivery" : "Selected stop"} · Stop {current.seq}
              </p>
              <span className="text-xs text-slate-500">{current.order.orderNumber}</span>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{current.order.customerName || "Customer"}</h2>
                <p className="mt-0.5 flex items-start gap-1.5 text-sm text-slate-600">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />
                  {current.order.address}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700">
                  <Clock className="size-3.5" /> ETA {formatClock(current.etaS)}
                </span>
                {(current.order.windowStartMin !== null || current.order.windowEndMin !== null) && (
                  <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-amber-800">
                    Window {formatMinutesClock(current.order.windowStartMin)}–{formatMinutesClock(current.order.windowEndMin)}
                  </span>
                )}
                {current.order.demand > 1 && <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700">{current.order.demand} units</span>}
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
                  onClick={() => route.status === "planned" && startTransition(async () => (await startRoute(route.id), router.refresh()))}
                >
                  {pending ? <Spinner className="size-5" /> : <Navigation className="size-5" />} {route.status === "planned" ? (pending ? "Starting…" : "Start route & navigate") : "Navigate"}
                </a>
                {current.order.phone && (
                  <a href={`tel:${current.order.phone.replace(/\s+/g, "")}`} className={btn("secondary", "lg", "rounded-xl px-4")} aria-label="Call customer">
                    <Phone className="size-5" />
                  </a>
                )}
              </div>
              <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <a href={navigationUrls(current.order.lat, current.order.lng).apple} target="_blank" rel="noreferrer" className="underline">
                  Use Apple Maps
                </a>
                {multiNav && (
                  <a href={multiNav.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline">
                    <Route className="size-3.5" /> Next {multiNav.count} stops in Google Maps
                  </a>
                )}
              </p>
              <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
                <button className={btn("success", "lg", "rounded-xl")} onClick={() => openSheet("delivered")}>
                  <CheckCircle2 className="size-5" /> Delivered
                </button>
                <button className={btn("danger", "lg", "rounded-xl")} onClick={() => openSheet("failed")}>
                  <TriangleAlert className="size-5" /> Problem
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-2xl bg-white p-6 text-center shadow-card">
            <CheckCircle2 className="mx-auto size-12 animate-check text-emerald-500" />
            <p className="mt-3 text-lg font-semibold">All stops completed</p>
            <p className="mt-1 text-sm text-slate-500">Great work today. Drive safely back to {depot?.name ?? "the depot"}.</p>
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 py-3">
              <div>
                <p className="text-xl font-semibold tabular-nums text-emerald-600">{completedStops.filter((s) => s.status === "delivered").length}</p>
                <p className="text-[11px] text-slate-500">Delivered</p>
              </div>
              <div>
                <p className={cx("text-xl font-semibold tabular-nums", completedStops.some((s) => s.status === "failed") ? "text-red-600" : "text-slate-900")}>
                  {completedStops.filter((s) => s.status === "failed").length}
                </p>
                <p className="text-[11px] text-slate-500">Problems</p>
              </div>
              <div>
                <p className="text-xl font-semibold tabular-nums text-slate-900">
                  {lastDoneAt ? new Date(lastDoneAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : "—"}
                </p>
                <p className="text-[11px] text-slate-500">Finished</p>
              </div>
            </div>
            <Link href="/driver/history" className={btn("secondary", "md", "mt-4 w-full rounded-xl")}>
              <History className="size-4" /> View delivery history
            </Link>
          </section>
        )}

        {current && reloadBefore && depot && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <Warehouse className="size-4" /> Reload at {depot.name} before this stop
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Trip {current.trip}: be at the depot around {formatClock(reloadBefore.arrivalS)}, leave by {formatClock(reloadBefore.departureS)}.
            </p>
            <a href={navigationUrls(depot.lat, depot.lng).google} target="_blank" rel="noreferrer" className={btn("secondary", "sm", "mt-2.5")}>
              <Navigation className="size-3.5" /> Navigate to depot
            </a>
          </section>
        )}

        <button className={btn("secondary", "md", "w-full rounded-xl")} onClick={() => setShowMap(!showMap)}>
          {showMap ? "Hide route map" : "Show route map"}
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
            {pendingStops.length ? `To deliver · ${pendingStops.length}` : "Today's stops"}
          </h3>
          {pendingStops.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">Nothing left to deliver.</p>}
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
                      <Badge tone={s.status === "delivered" ? "green" : "red"}>{s.status === "delivered" ? "Delivered" : "Failed"}</Badge>
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
                      <RefreshCcw className="size-3.5" /> Reload at depot · {formatClock(reload.arrivalS)}–{formatClock(reload.departureS)}
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
                Completed · {completedStops.length}
                {cleared.size > 0 && <span className="ml-1.5 text-xs font-normal text-slate-400">({completedStops.length - visibleDone.length} cleared)</span>}
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
                        <Badge tone={s.status === "delivered" ? "green" : "red"}>{s.status === "delivered" ? "Delivered" : "Problem"}</Badge>
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
                      Clear all from my list
                    </button>
                  ) : (
                    <button onClick={() => setCleared(new Set())} className="text-xs font-medium text-slate-500 hover:text-slate-800">
                      Show cleared stops
                    </button>
                  )}
                  <Link href="/driver/history" className="flex items-center gap-1 text-xs font-medium text-blue-600">
                    <History className="size-3.5" /> History
                  </Link>
                </div>
              </>
            )}
          </section>
        )}
      </main>

      <Modal open={sheet?.kind === "delivered"} onClose={() => setSheet(null)} title="Confirm delivery">
        {sheet && (
          <OutcomeForm
            kind="delivered"
            stopId={sheet.stopId}
            requirePhoto={requirePhoto}
            requireSignature={requireSignature}
            onDone={() => finishSheet({ tone: "ok", text: `Delivered · ${sheet.name}` })}
          />
        )}
      </Modal>
      <Modal open={sheet?.kind === "failed"} onClose={() => setSheet(null)} title="Report a delivery problem">
        {sheet && <OutcomeForm kind="failed" stopId={sheet.stopId} onDone={() => finishSheet({ tone: "warn", text: `Problem reported · ${sheet.name}` })} />}
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
        {text}
        {good && <span className="block text-[11px] text-emerald-700/80">Keep this page open while driving. Sharing stops when your route is finished.</span>}
      </span>
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input type="checkbox" className="peer sr-only" checked={enabled} onChange={(e) => onToggle(e.target.checked)} aria-label="Share live location" />
        <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-emerald-500" />
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </label>
    </section>
  );
}

function OutcomeForm({
  kind,
  stopId,
  onDone,
  requirePhoto = false,
  requireSignature = false,
}: {
  kind: "delivered" | "failed";
  stopId: string;
  onDone: () => void;
  requirePhoto?: boolean;
  requireSignature?: boolean;
}) {
  const [state, action] = useActionState(kind === "delivered" ? markDelivered : markFailed, undefined);
  const [photo, setPhoto] = useState<File | null>(null);
  const [signature, setSignature] = useState<File | null>(null);
  const fix = useBestFix();
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  const missing = kind === "delivered" && ((requirePhoto && !photo) || (requireSignature && !signature));
  return (
    <form
      action={(fd) => {
        // Images live in component state (resized / drawn), so attach them here.
        if (photo) fd.set("photo", photo);
        if (signature) fd.set("signature", signature);
        if (fix) {
          fd.set("lat", String(fix.lat));
          fd.set("lng", String(fix.lng));
          fd.set("accuracy", String(fix.accuracy));
        }
        return action(fd);
      }}
      className="space-y-4"
    >
      <input type="hidden" name="stopId" value={stopId} />
      {kind === "delivered" ? (
        <>
          <PhotoCapture value={photo} onChange={setPhoto} required={requirePhoto} />
          <Field label={signature || requireSignature ? "Received by *" : "Received by (optional)"}>
            <input name="recipient" autoComplete="off" required={!!signature || requireSignature} className={cx(inputCls, "h-11 text-base")} />
          </Field>
          <SignaturePad onChange={setSignature} required={requireSignature} />
        </>
      ) : (
        <>
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-1.5 text-xs font-medium text-slate-600">What happened?</legend>
            {FAILURE_REASONS.map((r, i) => (
              <label key={r} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm has-[:checked]:border-red-400 has-[:checked]:bg-red-50">
                <input type="radio" name="reason" value={r} required defaultChecked={i === 0} />
                {r}
              </label>
            ))}
          </fieldset>
          <PhotoCapture value={photo} onChange={setPhoto} />
        </>
      )}
      <Field label="Note (optional)">
        <textarea name="note" rows={2} className={cx(inputCls, "h-auto py-2 text-base")} />
      </Field>
      <p className={cx("flex items-center gap-1.5 text-xs", fix && fix.accuracy <= 30 ? "text-emerald-700" : "text-slate-500")}>
        {fix ? <LocateFixed className="size-3.5" /> : <Spinner className="size-3" />}
        {fix ? `Location recorded with this delivery · ±${Math.round(fix.accuracy)} m` : "Getting your exact location…"}
      </p>
      <FormError message={state && !state.ok ? state.error : null} />
      <SubmitButton disabled={missing} variant={kind === "delivered" ? "success" : "primary"} size="lg" className="w-full rounded-xl" pendingText="Uploading…">
        {kind === "delivered" ? "Confirm delivered" : "Report problem"}
      </SubmitButton>
    </form>
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
