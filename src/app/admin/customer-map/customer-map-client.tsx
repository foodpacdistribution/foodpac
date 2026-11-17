"use client";

import { AlertTriangle, ArrowDownRight, ArrowUpRight, Crosshair, MapPinned, Navigation, Phone, RotateCcw, Route, Search, Truck, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { locateCustomerBatch, planVisits, retryFailedLocations, type VisitPlan } from "@/app/actions/customer-map";
import { Modal } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { CustomerMap } from "@/components/map";
import { btn, Card, cx, EmptyState, inputCls, PageHeader, Spinner } from "@/components/ui";
import type { VanRun } from "@/lib/area-insights";
import {
  type AreaNumbers,
  type CustomerPin,
  distanceM,
  FOLLOW_COLOR,
  type FollowState,
  MAX_VISITS,
  salesTrend,
  STAGE_COLOR,
  UNKNOWN_AREA,
  visitScore,
  WEEKDAY_COLOR,
  WEEKDAY_SHORT,
} from "@/lib/customer-map";
import type { Role, SalesStage } from "@/lib/db/schema";
import type { DueFollowUp } from "@/lib/follow-up";
import { dueText } from "@/lib/follow-up-text";
import { aud } from "@/lib/money";
import { SALES_STAGES, STAGE_INFO } from "@/lib/sales-stage";
import { formatMinutesClock } from "@/lib/time";

export type MapCustomer = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  address: string;
  active: boolean;
  stage: SalesStage;
  /** placed = on the map; pending = still to look up; failed = address not found; none = no address. */
  place: "placed" | "pending" | "failed" | "none";
  lat: number | null;
  lng: number | null;
  approximate: boolean;
  areaKey: string;
  areaName: string;
  href: string | null;
  repId: string | null;
  /** Why they're due a call today, if they are. */
  due: DueFollowUp | null;
  last90Cents: number;
  prev90Cents: number;
  /** Weekdays a delivery run passes nearby (0 = Sunday). */
  vanDays: number[];
};

type Area = AreaNumbers & {
  key: string;
  name: string;
  total: number;
  byStage: Record<SalesStage, number>;
  byFollow: Record<FollowState, number>;
  pins: CustomerPin[];
  vanDays: number[];
  score: number;
};

const emptyStages = (): Record<SalesStage, number> => ({ new: 0, interested: 0, negotiating: 0, won: 0, not_now: 0 });
const emptyFollow = (): Record<FollowState, number> => ({ due: 0, talks: 0, fine: 0, lead: 0, no: 0 });

/** Due a call; in talks; buying normally; a lead not buying yet; said not now (and not due to try again). */
const followOf = (c: Pick<MapCustomer, "due" | "stage">): FollowState =>
  c.due ? "due" : c.stage === "interested" || c.stage === "negotiating" ? "talks" : c.stage === "won" ? "fine" : c.stage === "not_now" ? "no" : "lead";
const FOLLOW_LABEL: Record<FollowState, string> = { due: "To follow up", talks: "In talks", fine: "Buying normally", lead: "New leads", no: "Not now" };
const FOLLOW_STATES = Object.keys(FOLLOW_LABEL) as FollowState[];
/** Who's worth a visit, in order: due a call, in talks, then leads. */
const VISIT_RANK: Partial<Record<FollowState, number>> = { due: 0, talks: 1, lead: 2 };
/** How far "near me" reaches. */
const NEAR_M = 2000;

type Sort = "worth" | "sales" | "customers";

/**
 * Looks up addresses still waiting, a batch at a time, until none are left. Each batch refreshes
 * the page, so the pins appear while you watch. Stops on an error or when a batch gets nowhere.
 */
function useLocating(pending: number) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const busy = useRef(false);
  const run = async (first?: () => ReturnType<typeof locateCustomerBatch>) => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setError(null);
    try {
      for (let i = 0; i < 500 && live.current; i++) {
        const r = await (i === 0 && first ? first() : locateCustomerBatch());
        if (!r.ok) {
          setError(r.error);
          break;
        }
        if (!r.data || r.data.remaining === 0 || r.data.located === 0) break;
      }
    } finally {
      busy.current = false;
      if (live.current) setRunning(false);
    }
  };
  const runRef = useRef(run);
  useEffect(() => {
    live.current = true;
    // Started on open when there is anything to place (e.g. right after an import).
    if (pending > 0) queueMicrotask(() => runRef.current());
    return () => {
      live.current = false;
    };
    // Only on open: later batches carry on by themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { running, error, run };
}

export function CustomerMapClient({ customers, me, runs }: { customers: MapCustomer[]; me: { id: string; role: Role }; runs: VanRun[] }) {
  const tr = useT();
  // The follow-up view says who to see; the stage view is the pipeline on a map.
  const [view, setView] = useState<"follow" | "stage">("follow");
  const [stage, setStage] = useState<SalesStage | "all">("all");
  const [follow, setFollow] = useState<FollowState | "all">("all");
  const [withInactive, setWithInactive] = useState(false);
  const hasMine = customers.some((c) => c.repId === me.id);
  // Sales staff start with their own customers.
  const [onlyMine, setOnlyMine] = useState(me.role === "sales" && hasMine);
  const [showRuns, setShowRuns] = useState(false);
  const [runDays, setRunDays] = useState<number[]>([]);
  const [areaKey, setAreaKey] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("worth");
  const [q, setQ] = useState("");
  const [showFailed, setShowFailed] = useState(false);
  const [retrying, startRetry] = useTransition();
  // "Near me": where the phone is, once asked.
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [locatingMe, setLocatingMe] = useState(false);
  const [hereError, setHereError] = useState<string | null>(null);
  const [plan, setPlan] = useState<VisitPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, startPlanning] = useTransition();

  const pending = customers.filter((c) => c.place === "pending").length;
  const failed = customers.filter((c) => c.place === "failed");
  const noAddress = customers.filter((c) => c.place === "none").length;
  const locating = useLocating(pending);

  // Counts follow the inactive and "mine" switches; the map follows the chips as well.
  const visible = useMemo(() => customers.filter((c) => (withInactive || c.active) && (!onlyMine || c.repId === me.id)), [customers, withInactive, onlyMine, me.id]);
  const stageCounts = useMemo(() => {
    const n = emptyStages();
    for (const c of visible) n[c.stage]++;
    return n;
  }, [visible]);
  const followCounts = useMemo(() => {
    const n = emptyFollow();
    for (const c of visible) n[followOf(c)]++;
    return n;
  }, [visible]);
  const shown = useMemo(
    () => visible.filter((c) => (view === "stage" ? stage === "all" || c.stage === stage : follow === "all" || followOf(c) === follow)),
    [visible, view, stage, follow],
  );
  const toPin = (c: MapCustomer): CustomerPin => ({
    id: c.id,
    lat: c.lat!,
    lng: c.lng!,
    name: c.name,
    code: c.code,
    address: c.address,
    phone: c.phone,
    stage: c.stage,
    active: c.active,
    approximate: c.approximate,
    areaKey: c.areaKey,
    href: c.href,
    canLog: me.role !== "sales" || c.repId === null || c.repId === me.id,
    ...(view === "follow" ? { color: FOLLOW_COLOR[followOf(c)] } : {}),
    note: c.due ? dueText(c.due, tr) : null,
  });
  const pins = useMemo<CustomerPin[]>(
    () => shown.filter((c) => c.place === "placed").map(toPin),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, view],
  );

  const areas = useMemo(() => {
    const byKey = new Map<string, Area>();
    const shownIds = new Set(pins.map((p) => p.id));
    const pinById = new Map(pins.map((p) => [p.id, p]));
    for (const c of visible) {
      if (c.place === "none") continue;
      let a = byKey.get(c.areaKey);
      if (!a)
        byKey.set(
          c.areaKey,
          (a = {
            key: c.areaKey,
            name: c.areaName,
            total: 0,
            byStage: emptyStages(),
            byFollow: emptyFollow(),
            pins: [],
            vanDays: [],
            due: 0,
            talks: 0,
            leads: 0,
            won: 0,
            last90Cents: 0,
            prev90Cents: 0,
            score: 0,
          }),
        );
      a.total++;
      a.byStage[c.stage]++;
      const f = followOf(c);
      a.byFollow[f]++;
      if (f === "due") a.due++;
      else if (f === "talks") a.talks++;
      else if (f === "lead") a.leads++;
      if (c.stage === "won") a.won++;
      a.last90Cents += c.last90Cents;
      a.prev90Cents += c.prev90Cents;
      for (const d of c.vanDays) if (!a.vanDays.includes(d)) a.vanDays.push(d);
      if (shownIds.has(c.id)) a.pins.push(pinById.get(c.id)!);
    }
    for (const a of byKey.values()) {
      a.vanDays.sort((x, y) => x - y);
      a.score = visitScore(a);
    }
    const by = { worth: (a: Area) => a.score, sales: (a: Area) => a.last90Cents, customers: (a: Area) => a.total }[sort];
    // Highest first; "unknown" always last.
    return [...byKey.values()].sort((x, y) => Number(x.key === UNKNOWN_AREA) - Number(y.key === UNKNOWN_AREA) || by(y) - by(x) || y.total - x.total || x.name.localeCompare(y.name));
  }, [visible, pins, sort]);

  const picked = areaKey ? areas.find((a) => a.key === areaKey) : undefined;

  // Who's worth a visit near here, nearest first.
  const nearby = useMemo(() => {
    if (!here) return [];
    return visible
      .filter((c) => c.place === "placed" && VISIT_RANK[followOf(c)] !== undefined)
      .map((c) => ({ c, m: distanceM(here, { lat: c.lat!, lng: c.lng! }) }))
      .filter((x) => x.m <= NEAR_M)
      .sort((a, b) => a.m - b.m);
  }, [here, visible]);

  const fitPins = here ? [here, ...nearby.map((x) => ({ lat: x.c.lat!, lng: x.c.lng! }))] : picked?.pins.length ? picked.pins : pins;
  // Re-frame when a filter, area or "near me" changes, and once when the first pins arrive.
  const fitKey = `${view}|${stage}|${follow}|${withInactive}|${onlyMine}|${picked?.key ?? ""}|${here ? `${here.lat},${here.lng}` : ""}|${pins.length > 0}`;
  const maxArea = Math.max(1, ...areas.map((a) => a.total));
  const term = q.trim().toLowerCase();
  const listed = term ? areas.filter((a) => a.name.toLowerCase().includes(term)) : areas;

  const lines = useMemo(
    () => (showRuns ? runs.filter((r) => !runDays.length || runDays.includes(r.weekday)).map((r, i) => ({ key: `r${i}`, color: WEEKDAY_COLOR[r.weekday], path: r.path })) : []),
    [showRuns, runs, runDays],
  );
  const runWeekdays = useMemo(() => [...new Set(runs.map((r) => r.weekday))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)), [runs]);

  const retry = () =>
    startRetry(async () => {
      await locating.run(retryFailedLocations);
    });

  const findMe = () => {
    setHereError(null);
    if (!navigator.geolocation) return setHereError(tr("This device can't share its location."));
    setLocatingMe(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocatingMe(false);
        setAreaKey(null);
        setHere({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        setLocatingMe(false);
        setHereError(tr("Couldn't get your location. Allow location for this site and try again."));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  /** Plans the quickest visits: from "here" when known, else from the depot. */
  const planTrip = (ids: string[]) => {
    setPlanError(null);
    startPlanning(async () => {
      const r = await planVisits({ customerIds: ids.slice(0, MAX_VISITS), start: here });
      if (r.ok && r.data) setPlan(r.data);
      else if (!r.ok) setPlanError(r.error);
    });
  };
  /** The area's customers worth a visit, most pressing first. */
  const visitsIn = (a: Area) =>
    visible
      .filter((c) => c.areaKey === a.key && c.place === "placed" && VISIT_RANK[followOf(c)] !== undefined)
      .sort((x, y) => VISIT_RANK[followOf(x)]! - VISIT_RANK[followOf(y)]!)
      .map((c) => c.id);

  return (
    <div>
      <PageHeader
        title={tr("Customer Map")}
        subtitle={tr("Where to go selling: red pins are customers due a call, and the areas list puts the ones most worth a visit first.")}
        actions={
          <button type="button" className={btn(here ? "primary" : "secondary")} onClick={here ? () => setHere(null) : findMe} disabled={locatingMe}>
            {locatingMe ? <Spinner className="size-4" /> : here ? <X className="size-4" /> : <Crosshair className="size-4" />}
            {here ? tr("Leave near me") : tr("Near me")}
          </button>
        }
      />

      {/* View, with what's in each group; then the switches. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-line bg-white p-0.5">
          {(["follow", "stage"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cx("h-7 rounded-full px-3 text-sm font-medium", view === v ? "bg-navy-800 text-white" : "text-slate-600 hover:text-slate-900")}
            >
              {v === "follow" ? tr("Follow-up") : tr("Sales stage")}
            </button>
          ))}
        </div>
        {view === "follow" ? (
          <>
            <Chip on={follow === "all"} onClick={() => setFollow("all")} label={tr("All")} n={visible.length} />
            {FOLLOW_STATES.map((f) => (
              <Chip key={f} on={follow === f} onClick={() => setFollow(follow === f ? "all" : f)} label={tr(FOLLOW_LABEL[f])} n={followCounts[f]} color={FOLLOW_COLOR[f]} />
            ))}
          </>
        ) : (
          <>
            <Chip on={stage === "all"} onClick={() => setStage("all")} label={tr("All")} n={visible.length} />
            {SALES_STAGES.map((s) => (
              <Chip key={s} on={stage === s} onClick={() => setStage(stage === s ? "all" : s)} label={tr(STAGE_INFO[s].label)} n={stageCounts[s]} color={STAGE_COLOR[s]} />
            ))}
          </>
        )}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
        {(me.role === "sales" || hasMine) && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="size-4 rounded border-line" />
            {tr("Only my customers")}
          </label>
        )}
        {runs.length > 0 && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showRuns} onChange={(e) => setShowRuns(e.target.checked)} className="size-4 rounded border-line" />
            <Truck className="size-4 text-slate-400" /> {tr("Delivery runs (last 4 weeks)")}
          </label>
        )}
        {showRuns && (
          <span className="flex flex-wrap gap-1">
            {runWeekdays.map((d) => {
              const on = runDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setRunDays((ds) => (on ? ds.filter((x) => x !== d) : [...ds, d]))}
                  className={cx("flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium", on ? "border-slate-400 bg-slate-100 text-slate-900" : "border-line bg-white text-slate-600")}
                >
                  <span className="h-1 w-3 rounded-full" style={{ background: WEEKDAY_COLOR[d] }} />
                  {tr(WEEKDAY_SHORT[d])}
                </button>
              );
            })}
          </span>
        )}
        <label className="ml-auto flex items-center gap-2">
          <input type="checkbox" checked={withInactive} onChange={(e) => setWithInactive(e.target.checked)} className="size-4 rounded border-line" />
          {tr("Include inactive customers")}
        </label>
      </div>
      {hereError && <p className="mb-3 text-sm text-red-600">{hereError}</p>}

      {/* What isn't on the map, and why. */}
      {(locating.running || pending > 0 || failed.length > 0 || noAddress > 0 || locating.error) && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {(locating.running || pending > 0) && (
            <span className="flex items-center gap-2 text-blue-700">
              {locating.running ? <Spinner className="size-3.5" /> : <MapPinned className="size-4" />}
              {locating.running ? tr("Placing customers on the map: {n} to go", { n: pending }) : tr(pending === 1 ? "1 customer waiting to be placed" : "{n} customers waiting to be placed", { n: pending })}
              {!locating.running && (
                <button type="button" className={btn("secondary", "sm")} onClick={() => locating.run()}>
                  {tr("Place them now")}
                </button>
              )}
            </span>
          )}
          {locating.error && <span className="text-red-600">{tr(locating.error)}</span>}
          {failed.length > 0 && (
            <button type="button" onClick={() => setShowFailed((v) => !v)} aria-expanded={showFailed} className="flex items-center gap-1.5 text-amber-700 hover:underline">
              <AlertTriangle className="size-4" />
              {tr(failed.length === 1 ? "1 address couldn't be found" : "{n} addresses couldn't be found", { n: failed.length })}
            </button>
          )}
          {noAddress > 0 && <span className="text-slate-500">{tr(noAddress === 1 ? "1 customer has no address" : "{n} customers have no address", { n: noAddress })}</span>}
        </div>
      )}

      {showFailed && failed.length > 0 && (
        <Card className="mb-3 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">{tr("Fix the address on the customer, or try again if the map service was busy.")}</p>
            <button type="button" className={btn("secondary", "sm")} onClick={retry} disabled={retrying || locating.running}>
              {retrying ? <Spinner className="size-3.5" /> : <RotateCcw className="size-3.5" />}
              {tr("Try again")}
            </button>
          </div>
          <ul className="max-h-48 divide-y divide-line overflow-y-auto text-sm">
            {failed.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-x-3 py-1.5">
                {c.href ? (
                  <Link href={c.href} className="font-medium text-slate-900 hover:text-blue-600 hover:underline">
                    {c.name}
                  </Link>
                ) : (
                  <span className="font-medium text-slate-900">{c.name}</span>
                )}
                <span className="text-slate-500">{c.address}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {customers.length === 0 ? (
        <Card>
          <EmptyState icon={MapPinned} title={tr("No customers yet")}>
            {tr("Import your customers or add them, and they show up here by their address.")}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <Card className="relative h-[60vh] min-h-[420px] overflow-hidden lg:h-[calc(100dvh-18rem)]">
              <CustomerMap pins={pins} fitKey={fitKey} fitPins={fitPins} lines={lines} me={here} className="z-0 h-full w-full" />
              {pins.length === 0 && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center bg-white/60 text-sm text-slate-600">
                  {locating.running ? tr("Placing customers on the map…") : tr("No customers with an address match these filters.")}
                </div>
              )}
            </Card>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              {view === "follow"
                ? FOLLOW_STATES.map((f) => (
                    <span key={f} className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full" style={{ background: FOLLOW_COLOR[f] }} />
                      {tr(FOLLOW_LABEL[f])}
                    </span>
                  ))
                : SALES_STAGES.map((s) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full" style={{ background: STAGE_COLOR[s] }} />
                      {tr(STAGE_INFO[s].label)}
                    </span>
                  ))}
              <span className="flex items-center gap-1.5">
                <span className="grid size-3.5 place-items-center rounded-full bg-amber-500 text-[8px] font-extrabold text-white">?</span>
                {tr("Placed roughly")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="grid size-4 place-items-center rounded-full bg-blue-500 text-[9px] font-bold text-white">5</span>
                {tr("Customers close together")}
              </span>
            </div>
          </div>

          {here ? (
            <NearMe
              nearby={nearby}
              planning={planning}
              planError={planError}
              onPlan={() => planTrip(nearby.map((x) => x.c.id))}
              onClose={() => setHere(null)}
            />
          ) : (
            <Card className="flex max-h-[calc(100dvh-12rem)] min-h-0 flex-col lg:h-[calc(100dvh-18rem)]">
              <div className="border-b border-line px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">{tr("Areas")}</h2>
                  {picked ? (
                    <button type="button" onClick={() => setAreaKey(null)} className="text-xs font-medium text-blue-600 hover:underline">
                      {tr("Show all areas")}
                    </button>
                  ) : (
                    <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={tr("Sort areas")} className="h-7 rounded-md border border-line bg-white px-1.5 text-xs text-slate-700">
                      <option value="worth">{tr("Most worth a visit")}</option>
                      <option value="sales">{tr("Most sales")}</option>
                      <option value="customers">{tr("Most customers")}</option>
                    </select>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{tr(areas.length === 1 ? "1 area · click it to zoom to it" : "{n} areas · click one to zoom to it", { n: areas.length })}</p>
                {areas.length > 8 && (
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
                    <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Find a suburb or postcode")} className={cx(inputCls, "pl-9")} />
                  </div>
                )}
              </div>
              <ol className="min-h-0 flex-1 overflow-y-auto p-2">
                {listed.map((a) => {
                  const on = a.key === areaKey;
                  const trend = salesTrend(a);
                  const visits = on ? visitsIn(a) : [];
                  return (
                    <li key={a.key} className={cx("rounded-lg", on && "bg-blue-50 ring-1 ring-blue-200")}>
                      <button
                        type="button"
                        onClick={() => setAreaKey(on ? null : a.key)}
                        aria-pressed={on}
                        disabled={!a.pins.length}
                        className={cx("w-full rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-default", !on && "hover:bg-slate-50")}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cx("truncate text-sm font-medium", a.key === UNKNOWN_AREA ? "text-slate-500" : "text-slate-900")}>{tr(a.name)}</span>
                          <span className="shrink-0 text-xs text-slate-500 tabular-nums">{tr(a.total === 1 ? "1 customer" : "{n} customers", { n: a.total })}</span>
                        </span>
                        {/* Bar length = customers here compared with the busiest area; colours = the pins' colours. */}
                        <span className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-slate-100" style={{ width: `${Math.max(6, (a.total / maxArea) * 100)}%` }}>
                          {view === "follow"
                            ? FOLLOW_STATES.map((f) => (a.byFollow[f] ? <span key={f} style={{ width: `${(a.byFollow[f] / a.total) * 100}%`, background: FOLLOW_COLOR[f] }} /> : null))
                            : SALES_STAGES.map((s) => (a.byStage[s] ? <span key={s} style={{ width: `${(a.byStage[s] / a.total) * 100}%`, background: STAGE_COLOR[s] }} /> : null))}
                        </span>
                        {(a.due > 0 || a.talks > 0 || a.leads > 0) && (
                          <span className="mt-1.5 flex flex-wrap gap-1 text-[11px] font-medium">
                            {a.due > 0 && <span className="rounded bg-red-50 px-1.5 py-px text-red-700">{tr("{n} to follow up", { n: a.due })}</span>}
                            {a.talks > 0 && <span className="rounded bg-amber-50 px-1.5 py-px text-amber-800">{tr("{n} in talks", { n: a.talks })}</span>}
                            {a.leads > 0 && <span className="rounded bg-slate-100 px-1.5 py-px text-slate-600">{tr(a.leads === 1 ? "1 lead" : "{n} leads", { n: a.leads })}</span>}
                          </span>
                        )}
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                          {(a.last90Cents > 0 || a.prev90Cents > 0) && (
                            <span className="flex items-center gap-0.5 tabular-nums">
                              {tr("{amount} in 90 days", { amount: aud(a.last90Cents) })}
                              {trend !== null && (
                                <span className={cx("ml-1 flex items-center font-medium", trend < 0 ? "text-red-600" : "text-emerald-700")}>
                                  {trend < 0 ? <ArrowDownRight className="size-3" /> : <ArrowUpRight className="size-3" />}
                                  {Math.abs(trend)}%
                                </span>
                              )}
                            </span>
                          )}
                          {a.vanDays.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Truck className="size-3" /> {a.vanDays.map((d) => tr(WEEKDAY_SHORT[d])).join(" · ")}
                            </span>
                          )}
                        </span>
                        {/* Leads the van already passes: cheap to win and deliver to. */}
                        {a.vanDays.length > 0 && a.leads + a.talks > 0 && a.won < 3 && (
                          <span className="mt-1 block text-[11px] font-medium text-emerald-700">{tr("On the van's way: new customers here cost little to deliver to")}</span>
                        )}
                      </button>
                      {on && (
                        <div className="px-2.5 pb-2.5">
                          <button type="button" className={btn("primary", "sm", "w-full")} disabled={!visits.length || planning} onClick={() => planTrip(visits)}>
                            {planning ? <Spinner className="size-3.5" /> : <Route className="size-3.5" />}
                            {visits.length
                              ? tr("Plan visits here ({n})", { n: Math.min(visits.length, MAX_VISITS) })
                              : tr("No one to visit here right now")}
                          </button>
                          {visits.length > MAX_VISITS && <p className="mt-1 text-[11px] text-slate-500">{tr("The {n} most pressing first.", { n: MAX_VISITS })}</p>}
                          {planError && <p className="mt-1 text-xs text-red-600">{tr(planError)}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
                {listed.length === 0 && <li className="px-2.5 py-6 text-center text-sm text-slate-500">{tr(areas.length ? "No area matches that search." : "No areas yet.")}</li>}
              </ol>
            </Card>
          )}
        </div>
      )}

      <Modal open={plan !== null} onClose={() => setPlan(null)} title={tr("Visit plan")}>
        {plan && <PlanView plan={plan} fromHere={!!here} />}
      </Modal>
    </div>
  );
}

/** Who's worth a visit within walking or a short drive of here, nearest first. */
function NearMe({
  nearby,
  planning,
  planError,
  onPlan,
  onClose,
}: {
  nearby: { c: MapCustomer; m: number }[];
  planning: boolean;
  planError: string | null;
  onPlan: () => void;
  onClose: () => void;
}) {
  const tr = useT();
  const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
  return (
    <Card className="flex max-h-[calc(100dvh-12rem)] min-h-0 flex-col lg:h-[calc(100dvh-18rem)]">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{tr("Near you")}</h2>
          <button type="button" onClick={onClose} className="text-xs font-medium text-blue-600 hover:underline">
            {tr("Show all areas")}
          </button>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">{tr("Customers due a call, in talks or new leads within 2 km.")}</p>
        {nearby.length > 0 && (
          <button type="button" className={btn("primary", "sm", "mt-2 w-full")} disabled={planning} onClick={onPlan}>
            {planning ? <Spinner className="size-3.5" /> : <Navigation className="size-3.5" />}
            {tr("Plan visits from here ({n})", { n: Math.min(nearby.length, MAX_VISITS) })}
          </button>
        )}
        {planError && <p className="mt-1 text-xs text-red-600">{tr(planError)}</p>}
      </div>
      <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {nearby.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">{tr("No one to visit within 2 km.")}</li>}
        {nearby.map(({ c, m }) => (
          <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: FOLLOW_COLOR[followOf(c)] }} />
            <span className="min-w-0 flex-1 text-sm">
              {c.href ? (
                <Link href={c.href} className="font-medium text-slate-900 hover:text-blue-600 hover:underline">
                  {c.name}
                </Link>
              ) : (
                <span className="font-medium text-slate-900">{c.name}</span>
              )}
              <span className="block text-xs text-slate-500">
                {km(m)} · {c.due ? dueText(c.due, tr) : tr(FOLLOW_LABEL[followOf(c)])}
              </span>
            </span>
            {c.phone && (
              <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className={btn("ghost", "icon")} aria-label={tr("Call {name}", { name: c.name })}>
                <Phone className="size-4" />
              </a>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** The planned visits in order, with times, and the whole trip in Google Maps. */
function PlanView({ plan, fromHere }: { plan: VisitPlan; fromHere: boolean }) {
  const tr = useT();
  const mins = (s: number) => Math.max(1, Math.round(s / 60));
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {tr(plan.stops.length === 1 ? "1 visit · about {min} min driving · {km} km" : "{n} visits · about {min} min driving · {km} km", { n: plan.stops.length, min: mins(plan.driveS), km: (plan.distanceM / 1000).toFixed(1) })}
        {" · "}
        {fromHere ? tr("from where you are") : tr("from the depot")}
      </p>
      {plan.estimate && <p className="text-xs text-amber-700">{tr("Drive times are rough: the road service didn't answer.")}</p>}
      <ol className="divide-y divide-line rounded-xl border border-line">
        {plan.stops.map((s, i) => (
          <li key={s.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-navy-800 text-xs font-semibold text-white">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-slate-900">{s.name}</span>
              <span className="block text-xs text-slate-500">{s.address}</span>
            </span>
            <span className="shrink-0 text-right text-xs text-slate-500 tabular-nums">
              {formatMinutesClock(Math.round(s.arriveS / 60))}
              <span className="block">{tr("{n} min drive", { n: mins(s.driveS) })}</span>
            </span>
          </li>
        ))}
      </ol>
      <a href={plan.mapsUrl} target="_blank" rel="noreferrer" className={btn("primary", "md", "w-full")}>
        <Navigation className="size-4" /> {tr("Open in Google Maps")}
      </a>
    </div>
  );
}

function Chip({ on, onClick, label, n, color }: { on: boolean; onClick: () => void; label: string; n: number; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        "flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
        on ? "border-blue-500 bg-blue-50 text-blue-700" : "border-line bg-white text-slate-600 hover:border-slate-300",
      )}
    >
      {color && <span className="size-2 rounded-full" style={{ background: color }} />}
      {label}
      <span className="tabular-nums text-slate-400">{n}</span>
    </button>
  );
}
