"use client";

import { ArrowDown, ArrowUp, Camera, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CloudOff, Clock, History, ListOrdered, LocateFixed, LocateOff, LogOut, MapPin, MessageSquareText, Navigation, Package, Phone, PlayCircle, RefreshCcw, Route, StickyNote, TriangleAlert, Truck, Warehouse, X } from "lucide-react";
import Link from "@/components/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { flushSync } from "react-dom";
import { logout } from "@/app/actions/auth";
import { reorderStops, startRoute, tellCustomerArriving } from "@/app/actions/driver";
import { Modal, Toast, type ToastMessage } from "@/components/client-ui";
import { LanguageSwitch } from "@/components/language-switch";
import { RoleSwitch } from "@/components/role-switch";
import { DeliveryMap, type MapStop } from "@/components/map";
import { Badge, btn, cx, Spinner } from "@/components/ui";
import { prettyDate, shiftDate } from "@/lib/dates";
import { multiStopNavigation, navigationUrls } from "@/lib/orders";
import type { RouteView, StopView } from "@/lib/planning";
import { formatClock, formatMinutesClock } from "@/lib/time";
import { OutcomeForm } from "./outcome-form";
import { compressPhoto } from "./proof-inputs";
import { addPhotosToOutbox, addToOutbox, discardFromOutbox, type OutboxItem, retryFromOutbox, sendOutbox, useOutbox } from "./outbox";
import { readSharePref, useLocationSharing, writeSharePref } from "./use-location-sharing";
import { Tx, useLocale, useT } from "@/components/i18n";
import { intlLocale } from "@/lib/i18n";

/** A line to hand over at a stop: `qty` is what's on the van, `waiting` what's still short of stock. */
export type StopItem = {
  id: string;
  sku: string;
  name: string;
  packSize: string;
  unit: string;
  qty: number;
  waiting: number;
  /** From an invoice line without a quantity: show the item, not a made-up count. */
  noQty?: boolean;
  /** What it looks like: the product's photo, or the one printed on the invoice. */
  image?: string;
};

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
  /** Items per order id; orders without a shop/staff order have none (only a unit count). */
  items: Record<string, StopItem[]>;
  /** Photos already with the office for each finished stop (stop id → count). */
  photos: Record<string, number>;
  /** Every job this login does: more than one shows a switch (e.g. to sales). */
  roles: string[];
  /** Customer emails are on, so the "about 10 minutes away" button can be offered. */
  canTellCustomer: boolean;
  requirePhoto: boolean;
  requireSignature: boolean;
};

function greeting(nowS: number) {
  const h = nowS / 3600;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function DriverClient({ name, linked, date, today, days, nowS, depot, route, items, photos, roles, canTellCustomer, requirePhoto, requireSignature }: Props) {
  const tr = useT();
  // Clock times read "2:44pm" in English and "14:44" in Chinese.
  const clock = (s: number | null) => tr(formatClock(s));
  const locale = intlLocale(useLocale());
  const [sharePref, setSharePref] = useState(readSharePref);
  const sharing = useLocationSharing(route?.status === "in_progress" && sharePref);
  const [pending, startTransition] = useTransition();
  // The stop the sheet was opened for. Saving refreshes the route, so `current` can already be the next stop by the time it's done.
  const [sheet, setSheet] = useState<null | { kind: "delivered" | "failed"; stopId: string; name: string; reference: string }>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  // The driver's own stop order while they arrange it (stop ids), null when not arranging.
  const [arranging, setArranging] = useState<string[] | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  // Deliveries saved on this phone and still uploading count as done here already.
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const outbox = useOutbox(refresh);
  // Finished stops still on the phone (stop id → how it went); added photos are counted apart.
  const queued = useMemo(
    () => new Map(outbox.items.flatMap((i) => (i.kind === "photos" ? [] : [[i.stopId, { ...i, kind: i.kind as "delivered" | "failed" }] as const]))),
    [outbox.items],
  );
  // Photos added to finished stops, still on the phone (stop id → count).
  const queuedPhotos = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of outbox.items) if (i.kind === "photos") m.set(i.stopId, (m.get(i.stopId) ?? 0) + i.files.length);
    return m;
  }, [outbox.items]);
  const stops = (route?.stops ?? []).map((s) => {
    const q = s.status === "pending" ? queued.get(s.id) : undefined;
    return q ? { ...s, status: q.kind } : s;
  });
  const pendingStops = stops.filter((s) => s.status === "pending");
  const completedStops = stops.filter((s) => s.status !== "pending");
  const [cleared, setCleared] = useStoredSet(`dp.cleared.${date}`);
  // Items the driver ticked off as handed over. Kept on the phone, so a reload or a trip to the maps app doesn't lose them.
  const [ticked, setTicked] = useStoredSet(`dp.ticked.${date}`);
  const [showDone, setShowDone] = useState(false);
  const visibleDone = completedStops.filter((s) => !cleared.has(s.id));
  const lastDoneAt = completedStops.map((s) => s.completedAt).filter(Boolean).sort().at(-1);
  const doneCount = stops.length - pendingStops.length;
  const current: StopView | undefined = pendingStops.find((s) => s.id === selectedId) ?? pendingStops[0];
  const currentItems = current ? (items[current.orderId] ?? []).filter((i) => i.qty > 0) : [];
  const tickedHere = currentItems.filter((i) => ticked.has(i.id)).length;
  const openSheet = (kind: "delivered" | "failed") => {
    if (!current) return;
    // Only asks when the driver is using the ticks and has missed some.
    if (kind === "delivered" && tickedHere > 0 && tickedHere < currentItems.length) {
      if (!confirm(tr("You've ticked {done} of {total} items. Confirm the delivery anyway?", { done: tickedHere, total: currentItems.length }))) return;
    }
    setSheet({ kind, stopId: current.id, name: current.order.customerName || current.order.orderNumber, reference: current.order.orderNumber });
  };
  const save = (kind: "delivered" | "failed", stop: { stopId: string; name: string }) => (fd: FormData) =>
    addToOutbox(fd, { stopId: stop.stopId, kind, name: stop.name });
  const finishSheet = (t: Omit<ToastMessage, "id">) => {
    setSheet(null);
    setSelectedId(null);
    setToast({ id: Date.now(), ...t });
  };
  const saveOrder = (stopIds: string[] | null) =>
    startTransition(async () => {
      const r = await reorderStops(route!.id, stopIds);
      setToast({ id: Date.now(), tone: r.ok ? "ok" : "warn", text: tr(r.ok ? (r.message ?? "Saved") : r.error) });
      if (r.ok) {
        setArranging(null);
        setSelectedId(null);
        refresh();
      }
    });
  // The two stops glide past each other (where the browser can animate the swap).
  const move = (i: number, by: number) => {
    const swap = () =>
      setArranging((list) => {
        if (!list || i + by < 0 || i + by >= list.length) return list;
        const next = [...list];
        [next[i], next[i + by]] = [next[i + by], next[i]];
        return next;
      });
    if (typeof document !== "undefined" && "startViewTransition" in document) document.startViewTransition(() => flushSync(swap));
    else swap();
  };
  // Kept on the phone first (like a delivery), so it uploads by itself where there's no signal.
  const addPhotos = (stopId: string, name: string, input: HTMLInputElement) => {
    const files = [...(input.files ?? [])].slice(0, 10);
    input.value = "";
    if (!files.length) return;
    startTransition(async () => {
      await addPhotosToOutbox(await Promise.all(files.map((f) => compressPhoto(f))), { stopId, name });
      setToast({ id: Date.now(), tone: "ok", text: tr("{n} photo(s) saved · uploading to the office", { n: files.length }) });
    });
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
  // A route can only be started on its delivery day; before that the button just navigates.
  const canStart = route?.status === "planned" && date === today;

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
          <RoleSwitch roles={roles} current="driver" compact />
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

  // Any day, back or forward: past days to look back at (and add a forgotten photo).
  const dayHref = (d: string) => (d === today ? "/driver" : `/driver?date=${d}`);
  const dayBar = (
    <div className="flex items-center gap-1.5 rounded-2xl bg-white p-1.5 shadow-card">
      <Link href={dayHref(shiftDate(date, -1))} className="grid size-10 shrink-0 place-items-center rounded-xl text-slate-600 transition-colors active:bg-slate-100" aria-label={tr("Previous day")}>
        <ChevronLeft className="size-5" />
      </Link>
      <label className="relative flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold text-slate-900 transition-colors active:bg-slate-100">
        <Clock className="size-4 text-slate-400" />
        <span className="truncate">
          {date === today ? tr("Today") : <Tx>{prettyDate(date, { weekday: "short", day: "numeric", month: "short", year: date.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" })}</Tx>}
        </span>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && router.push(dayHref(e.target.value))}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={tr("Choose a day")}
        />
      </label>
      {date !== today && (
        <Link href="/driver" className={btn("secondary", "sm", "shrink-0 rounded-xl")}>
          {tr("Today")}
        </Link>
      )}
      <Link href={dayHref(shiftDate(date, 1))} className="grid size-10 shrink-0 place-items-center rounded-xl text-slate-600 transition-colors active:bg-slate-100" aria-label={tr("Next day")}>
        <ChevronRight className="size-5" />
      </Link>
    </div>
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
          {dayBar}
          {dayTabs}
          <div className="rounded-2xl bg-white p-8 text-center shadow-card">
            <Truck className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-semibold text-slate-900">{!linked ? tr("Account not linked") : date < today ? tr("No deliveries on this day") : tr("No deliveries dispatched yet")}</p>
            <p className="mt-1 text-sm text-slate-500">
              {!linked
                ? tr("Ask your dispatcher to link your login to your driver profile.")
                : date < today
                  ? tr("Nothing was sent to you for this day. Pick another day above.")
                  : tr("Your shipment appears here as soon as the office sends it. This page refreshes automatically.")}
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
    lines: [s.order.address, `${tr("ETA")} ${clock(s.etaS)}`],
    navigateUrl: navigationUrls(s.order.lat, s.order.lng).google,
  }));

  return (
    // Room at the bottom for the action bar that sits above the tab bar.
    <div className={cx("min-h-dvh", current ? "pb-28" : "pb-10")}>
      {header}
      <main className="mx-auto -mt-12 max-w-lg space-y-4 px-4">
        {dayBar}
        {dayTabs}
        {date !== today && (
          <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-900 ring-1 ring-blue-200">
            {tr("This shipment is for {day}. You can look it over now; deliver it on the day.", { day: tr(prettyDate(date, { weekday: "long", day: "numeric", month: "long" })) })}
          </p>
        )}
        <OutboxBanner items={outbox.items} busy={outbox.busy} persistent={outbox.persistent} />
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
              {clock(projectedFinish)}
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

        {canStart && current && (
          <p className="flex items-center gap-2 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <PlayCircle className="size-5 shrink-0 text-blue-600" />
            <span>
              {tr("Tap")}{" "}<strong>{tr("Start route & navigate")}</strong> {" "}{tr("when you set off. Dispatch will see you're on the road.")}{" "}
              {tr("Arrival times are counted from the moment you start.")}</span>
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
                  <Clock className="size-3.5" /> {" "}{tr("ETA")}{" "}{clock(current.etaS)}
                </span>
                {(current.order.windowStartMin !== null || current.order.windowEndMin !== null) && (
                  <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-amber-800">
                    {tr("Window")}{" "}{formatMinutesClock(current.order.windowStartMin)}–{formatMinutesClock(current.order.windowEndMin)}
                  </span>
                )}
                {current.order.demand > 1 && !!items[current.orderId]?.length && <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700">{current.order.demand} {" "}{tr("units")}</span>}
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
                  onClick={() => canStart && startTransition(async () => {
                    const r = await startRoute(route.id);
                    if (!r.ok) setToast({ id: Date.now(), tone: "warn", text: tr(r.error) });
                  })}
                >
                  {pending ? <Spinner className="size-5" /> : <Navigation className="size-5" />} {canStart ? (pending ? tr("Starting…") : tr("Start route & navigate")) : tr("Navigate")}
                </a>
                {current.order.phone && (
                  <a href={`tel:${current.order.phone.replace(/\s+/g, "")}`} className={btn("secondary", "lg", "rounded-xl px-4")} aria-label={tr("Call customer")}>
                    <Phone className="size-5" />
                  </a>
                )}
              </div>
              {canTellCustomer && date === today && route.status === "in_progress" && (
                <button
                  type="button"
                  disabled={!!current.headsUpAt || pending}
                  className={btn("secondary", "md", "w-full rounded-xl")}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await tellCustomerArriving(current.id);
                      setToast({ id: Date.now(), tone: r.ok ? "ok" : "warn", text: tr(r.ok ? (r.message ?? "Sent") : r.error) });
                    })
                  }
                >
                  <MessageSquareText className="size-4" />{" "}
                  {current.headsUpAt ? tr("Customer told you're 10 minutes away") : tr("Tell customer: about 10 minutes away")}
                </button>
              )}
              <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <a href={navigationUrls(current.order.lat, current.order.lng).apple} target="_blank" rel="noreferrer" className="underline">
                  {tr("Use Apple Maps")}</a>
                {multiNav && (
                  <a href={multiNav.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline">
                    <Route className="size-3.5" /> {" "}{tr("Next")}{" "}{multiNav.count} {" "}{tr("stops in Google Maps")}</a>
                )}
              </p>
              <ItemChecklist
                items={items[current.orderId] ?? []}
                demand={current.order.demand}
                ticked={ticked}
                onToggle={(id) => {
                  const next = new Set(ticked);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  setTicked(next);
                }}
              />
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
                  {lastDoneAt ? new Date(lastDoneAt).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) : "—"}
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
              {tr("Trip")}{" "}{current.trip}{tr(": be at the depot around")}{" "}{clock(reloadBefore.arrivalS)}{tr(", leave by")}{" "}{clock(reloadBefore.departureS)}.
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
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-900">{pendingStops.length ? tr(`To deliver · ${pendingStops.length}`) : tr("Today's stops")}</h3>
            {pendingStops.length > 1 && !arranging && (
              <button type="button" className={btn("ghost", "sm")} onClick={() => setArranging(pendingStops.map((s) => s.id))}>
                <ListOrdered className="size-4" /> {tr("Change order")}
              </button>
            )}
          </div>
          {pendingStops.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">{tr("Nothing left to deliver.")}</p>}
          {arranging ? (
            <div>
              <p className="bg-blue-50 px-4 py-2 text-xs text-blue-800">{tr("Move stops up or down into the order you'll deliver them. Arrival times are worked out again when you save.")}</p>
              <ol className="divide-y divide-line">
                {arranging.map((id, i) => {
                  const s = pendingStops.find((x) => x.id === id);
                  if (!s) return null;
                  return (
                    <li key={id} className="flex items-center gap-3 bg-white py-2 pl-4 pr-2" style={{ viewTransitionName: `stop-${id}` }}>
                      <span className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: route.color }}>
                        {doneCount + i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{s.order.customerName || s.order.orderNumber}</span>
                        <span className="block truncate text-xs text-slate-500">{s.order.address}</span>
                      </span>
                      <button type="button" className="grid size-11 place-items-center rounded-full text-slate-600 active:bg-slate-100 disabled:opacity-25" disabled={i === 0} onClick={() => move(i, -1)} aria-label={tr("Move up")}>
                        <ArrowUp className="size-5" />
                      </button>
                      <button type="button" className="grid size-11 place-items-center rounded-full text-slate-600 active:bg-slate-100 disabled:opacity-25" disabled={i === arranging.length - 1} onClick={() => move(i, 1)} aria-label={tr("Move down")}>
                        <ArrowDown className="size-5" />
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
                <button type="button" className={btn("secondary", "md", "rounded-xl")} disabled={pending} onClick={() => setArranging(null)}>
                  {tr("Cancel")}
                </button>
                <button type="button" className={btn("primary", "md", "rounded-xl")} disabled={pending} onClick={() => saveOrder(arranging)}>
                  {pending ? <Spinner className="size-4" /> : null} {tr("Save order")}
                </button>
                <button type="button" className="col-span-2 py-1 text-xs text-slate-500 underline" disabled={pending} onClick={() => saveOrder(null)}>
                  {tr("Back to the best order from where I am")}
                </button>
              </div>
            </div>
          ) : (
          <ol className="divide-y divide-line">
            {pendingStops.map((s, i) => {
              const isCurrent = s.id === current?.id;
              const reload = route.reloads.find((r) => r.afterSeq === s.seq);
              return (
                <li key={s.id} className="stagger" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                  <div className={cx("flex items-center transition-colors duration-300", isCurrent && "bg-blue-50")}>
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
                      {items[s.orderId]?.some((i) => i.qty > 0) && (
                        <span className="block truncate text-xs text-slate-400">
                          {items[s.orderId]
                            .filter((i) => i.qty > 0)
                            .map((i) => `${i.qty}× ${i.name}`)
                            .join(" · ")}
                        </span>
                      )}
                    </span>
                    {s.status === "pending" ? (
                      <span className="text-sm font-semibold tabular-nums text-slate-700">{clock(s.etaS)}</span>
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
                      <RefreshCcw className="size-3.5" /> {" "}{tr("Reload at depot ·")}{" "}{clock(reload.arrivalS)}–{clock(reload.departureS)}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          )}
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
                      <li key={s.id} className="flex animate-rise items-center gap-3 px-4 py-2.5">
                        <span className={cx("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white", s.status === "delivered" ? "bg-emerald-500" : "bg-red-500")}>
                          {s.status === "delivered" ? "✓" : "!"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-500">{s.order.customerName || s.order.orderNumber}</span>
                          <span className="block truncate text-xs text-slate-400">{s.order.address}</span>
                          {!queued.has(s.id) && (
                            <span className={cx("mt-0.5 flex items-center gap-1 text-[11px]", photos[s.id] || queuedPhotos.has(s.id) ? "text-slate-400" : "text-amber-700")}>
                              <Camera className="size-3" />
                              {photos[s.id] ? tr("{n} photo(s)", { n: photos[s.id] }) : queuedPhotos.has(s.id) ? null : tr("No photo")}
                              {queuedPhotos.has(s.id) && <span className="text-amber-700">{tr("+{n} uploading", { n: queuedPhotos.get(s.id)! })}</span>}
                            </span>
                          )}
                        </span>
                        <label
                          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-blue-50 text-blue-600 transition-transform active:scale-90"
                          aria-label={tr("Add photos to {name}", { name: s.order.customerName || s.order.orderNumber })}
                        >
                          <Camera className="size-4" />
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="sr-only"
                            onChange={(e) => addPhotos(s.id, s.order.customerName || s.order.orderNumber, e.target)}
                          />
                        </label>
                        {queued.has(s.id) ? (
                          <Badge tone="amber">{tr("Waiting to upload")}</Badge>
                        ) : (
                          <Badge tone={s.status === "delivered" ? "green" : "red"}>{s.status === "delivered" ? tr("Delivered") : tr("Problem")}</Badge>
                        )}
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

      {/* Delivered / Problem always within thumb reach, however long the stop card gets. */}
      {current && (
        <div className="no-print fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 animate-rise border-t border-line bg-white/95 px-4 py-2.5 backdrop-blur">
          <div className="mx-auto max-w-lg">
            <p className="mb-1.5 truncate text-xs text-slate-500">
              {tr("Stop")}{" "}{current.seq} · <span className="font-medium text-slate-800">{current.order.customerName || current.order.orderNumber}</span>
              {currentItems.length > 0 && <span className="tabular-nums"> · {tickedHere}/{currentItems.length}</span>}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button className={btn("success", "lg", "rounded-xl")} onClick={() => openSheet("delivered")}>
                <CheckCircle2 className="size-5" /> {" "}{tr("Delivered")}</button>
              <button className={btn("danger", "lg", "rounded-xl")} onClick={() => openSheet("failed")}>
                <TriangleAlert className="size-5" /> {" "}{tr("Problem")}</button>
            </div>
          </div>
        </div>
      )}
      <Modal open={sheet?.kind === "delivered"} onClose={() => setSheet(null)} title={tr("Confirm delivery")}>
        {sheet && (
          <OutcomeForm
            kind="delivered"
            save={save("delivered", sheet)}
            fields={{ stopId: sheet.stopId }}
            reference={sheet.reference}
            requirePhoto={requirePhoto}
            requireSignature={requireSignature}
            onDone={() => finishSheet({ tone: "ok", text: `Delivered · ${sheet.name}` })}
          />
        )}
      </Modal>
      <Modal open={sheet?.kind === "failed"} onClose={() => setSheet(null)} title={tr("Report a delivery problem")}>
        {sheet && <OutcomeForm kind="failed" save={save("failed", sheet)} fields={{ stopId: sheet.stopId }} onDone={() => finishSheet({ tone: "warn", text: `Problem reported · ${sheet.name}` })} />}
      </Modal>
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}

/**
 * Deliveries kept on this phone because they haven't reached the office yet (no signal when
 * they were done). They upload by themselves; this says so, and shows any the office turned down.
 */
function OutboxBanner({ items, busy, persistent }: { items: OutboxItem[]; busy: boolean; persistent: boolean }) {
  const tr = useT();
  if (!items.length) return null;
  const waiting = items.filter((i) => !i.rejected);
  const waitingStops = waiting.filter((i) => i.kind !== "photos").length;
  const waitingPhotos = waiting.filter((i) => i.kind === "photos").reduce((t, i) => t + i.files.length, 0);
  const rejected = items.filter((i) => i.rejected);
  return (
    <section className="space-y-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 shadow-card ring-1 ring-amber-200">
      {waiting.length > 0 && (
        <div className="flex items-start gap-3">
          {busy ? <Spinner className="mt-0.5 size-5 shrink-0" /> : <CloudOff className="mt-0.5 size-5 shrink-0 text-amber-600" />}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {waitingStops > 0 &&
                (waitingStops === 1 ? tr("1 delivery saved on this phone, not uploaded yet") : tr("{n} deliveries saved on this phone, not uploaded yet", { n: waitingStops }))}
              {waitingStops > 0 && waitingPhotos > 0 && " · "}
              {waitingPhotos > 0 && tr("{n} added photo(s) not uploaded yet", { n: waitingPhotos })}
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              {tr("Signatures and photos are kept. They upload by themselves when there's signal, so carry on with your next stop.")}
            </p>
            {!persistent && <p className="mt-1 text-xs font-semibold text-red-700">{tr("Keep this page open until they're uploaded.")}</p>}
          </div>
          <button type="button" onClick={() => void sendOutbox()} disabled={busy} className={btn("secondary", "sm", "shrink-0")}>
            {tr("Send now")}
          </button>
        </div>
      )}
      {rejected.map((i) => (
        <div key={i.id} className="rounded-xl bg-white p-3 ring-1 ring-red-200">
          <p className="font-semibold text-red-700">{tr("Not accepted: {name}", { name: i.name })}</p>
          {i.error && <p className="mt-0.5 text-xs text-slate-600">{tr(i.error)}</p>}
          <p className="mt-0.5 text-xs text-slate-500">{tr("Call the office. The signature and photo are still saved on this phone.")}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void retryFromOutbox(i.id)} className={btn("secondary", "sm")}>
              {tr("Try again")}
            </button>
            <button
              type="button"
              onClick={() =>
                confirm(i.kind === "photos" ? tr("Remove these photos from the phone?") : tr("Remove this delivery from the phone? Its signature and photo will be lost.")) &&
                void discardFromOutbox(i.id)
              }
              className={btn("ghost", "sm", "text-red-600")}
            >
              {tr("Remove")}
            </button>
          </div>
        </div>
      ))}
    </section>
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

/** What the hook below holds when the phone won't let the page store anything. */
const memoryStore = new Map<string, string>();

/**
 * A set of ids kept on this phone (cleared stops, ticked items). Only on this phone: the
 * delivery record, photo and signature stay in History and with the office.
 */
function useStoredSet(key: string): [Set<string>, (next: Set<string>) => void] {
  // Read through useSyncExternalStore so the server render (empty) and the phone agree.
  const raw = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("dp:stored", onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener("dp:stored", onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => {
      try {
        return localStorage.getItem(key) ?? memoryStore.get(key) ?? "[]";
      } catch {
        return memoryStore.get(key) ?? "[]";
      }
    },
    () => "[]",
  );
  const value = useMemo(() => new Set(JSON.parse(raw) as string[]), [raw]);
  const set = (next: Set<string>) => {
    const v = JSON.stringify([...next]);
    memoryStore.set(key, v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // Storage blocked: kept for as long as the page is open.
    }
    window.dispatchEvent(new Event("dp:stored"));
  };
  return [value, set];
}

/** What to hand over at this stop, with a tick per line. Long orders show the first few until opened. */
function ItemChecklist({ items, demand, ticked, onToggle }: { items: StopItem[]; demand: number; ticked: Set<string>; onToggle: (id: string) => void }) {
  const tr = useT();
  const [all, setAll] = useState(false);
  const onVan = items.filter((i) => i.qty > 0);
  const short = items.filter((i) => i.waiting > 0);
  if (!items.length) {
    return demand > 0 ? (
      <p className="flex items-center gap-2 border-t border-line pt-3 text-sm text-slate-600">
        <Package className="size-4 text-slate-400" /> {tr("Hand over {n} units", { n: demand })}
      </p>
    ) : null;
  }
  const done = onVan.filter((i) => ticked.has(i.id)).length;
  const shown = all || onVan.length <= 6 ? onVan : onVan.slice(0, 5);
  return (
    <div className="border-t border-line pt-3">
      <p className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
        <span className="flex items-center gap-1.5">
          <Package className="size-3.5" /> {tr("To hand over")}
        </span>
        <span className={cx("tabular-nums", done === onVan.length && onVan.length > 0 ? "text-emerald-600" : "text-slate-400")}>
          {done}/{onVan.length}
        </span>
      </p>
      <ul className="mt-2 space-y-1">
        {shown.map((i) => {
          const on = ticked.has(i.id);
          return (
            <li key={i.id}>
              <label
                className={cx(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 ring-1 transition-[background-color,box-shadow] duration-200 active:scale-[0.99]",
                  on ? "animate-pop bg-emerald-50 ring-emerald-200" : "ring-line",
                )}
              >
                <input type="checkbox" className="size-5 shrink-0 accent-emerald-600" checked={on} onChange={() => onToggle(i.id)} />
                {i.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small signed-in thumbnail
                  <img src={i.image} alt="" loading="lazy" className="size-11 shrink-0 rounded-md bg-white object-contain ring-1 ring-line" />
                ) : (
                  <span className="grid size-11 shrink-0 place-items-center rounded-md bg-slate-50 text-slate-300 ring-1 ring-line">
                    <Package className="size-5" />
                  </span>
                )}
                <span className="w-9 shrink-0 text-right text-base font-semibold tabular-nums text-slate-900">{i.noQty ? "•" : `${i.qty}×`}</span>
                <span className={cx("min-w-0 flex-1 text-sm transition-colors duration-200", on ? "text-slate-500 line-through" : "text-slate-800")}>
                  {i.name}
                  {(i.packSize || i.unit || i.sku) && <span className="block text-[11px] text-slate-400">{[i.packSize, i.unit, i.sku].filter(Boolean).join(" · ")}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {shown.length < onVan.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-1.5 text-xs font-medium text-blue-600">
          {tr("Show all {n} items", { n: onVan.length })}
        </button>
      )}
      {short.length > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {tr("Not on the van (waiting for stock):")}{" "}
          {short.map((i) => `${i.waiting}× ${i.name}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
