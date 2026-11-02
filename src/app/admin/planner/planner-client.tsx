"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  GripVertical,
  KanbanSquare,
  Map as MapIcon,
  RefreshCcw,
  RotateCcw,
  Send,
  Sparkles,
  Undo2,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useHoldLiveRefresh } from "@/components/live-refresh";
import { dispatch, optimise, saveManualEdit } from "@/app/actions/planner";
import { DateNav } from "@/components/date-nav";
import { DeliveryMap, type MapRoute, type MapStop } from "@/components/map";
import { Badge, btn, Card, CardHeader, ColorDot, cx, Field, inputCls, PageHeader, Spinner, UNASSIGNED_REASON } from "@/components/ui";
import type { Objective } from "@/lib/vrp/types";
import type { PlanView, RouteView, StopView } from "@/lib/planning";
import { formatClock, formatDuration, formatKm, formatMinutesClock, inputToMinutes, minutesToInput } from "@/lib/time";
import { ComparisonCard, SummaryCard } from "./summary-cards";

type Driver = {
  id: string;
  name: string;
  color: string;
  vehicle: string | null;
  capacity: number | null;
  shiftStartMin: number | null;
  maxShiftMin: number | null;
  depotId: string | null;
  maxTrips: number;
};
type Order = {
  id: string;
  orderNumber: string;
  customerName: string;
  address: string;
  lat: number | null;
  lng: number | null;
  geocodeStatus: string;
  status: string;
  windowStartMin: number | null;
  windowEndMin: number | null;
  priority: number;
  demand: number;
  pinnedDriverId: string | null;
  depotId: string | null;
};

type Props = {
  date: string;
  today: string;
  depots: { id: string; lat: number; lng: number; name: string }[];
  defaults: { startMin: number; serviceMin: number; trafficFactor: number; returnToDepot: boolean; maxShiftMin: number };
  lastSettings: Record<string, unknown> | null;
  drivers: Driver[];
  orders: Order[];
  view: PlanView;
};

/** Pending order ids per driver, plus the unassigned pool — the thing the dispatcher edits. */
type Draft = { routes: Record<string, string[]>; unassigned: string[] };

const OPEN_STATUSES = new Set(["pending", "planned", "dispatched"]);

const OBJECTIVES = [
  ["balanced", "Finish everyone early", "Balances workload; all routes done soonest"],
  ["time", "Least total driving time", "May give some drivers more stops"],
  ["distance", "Shortest distance", "Fewest kilometres (fuel)"],
] as const;

function buildDraft(view: PlanView, orders: Order[]): Draft {
  const routes: Record<string, string[]> = {};
  for (const id of view.plan?.driverIds ?? []) routes[id] = [];
  for (const r of view.routes) routes[r.driverId] = r.stops.filter((s) => s.status === "pending").map((s) => s.orderId);
  const inRoute = new Set(Object.values(routes).flat());
  const unassigned = orders.filter((o) => OPEN_STATUSES.has(o.status) && o.lat !== null && !inRoute.has(o.id)).map((o) => o.id);
  return { routes, unassigned };
}

function windowLabel(o: { windowStartMin: number | null; windowEndMin: number | null }) {
  if (o.windowStartMin === null && o.windowEndMin === null) return null;
  if (o.windowStartMin === null) return `by ${formatMinutesClock(o.windowEndMin)}`;
  if (o.windowEndMin === null) return `after ${formatMinutesClock(o.windowStartMin)}`;
  return `${formatMinutesClock(o.windowStartMin)}–${formatMinutesClock(o.windowEndMin)}`;
}

export function PlannerClient(props: Props) {
  const { date, view, drivers, orders, defaults } = props;
  const plan = view.plan;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | "optimise" | "save" | "dispatch">(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [mode, setMode] = useState<"map" | "board">("map");
  const [focusRouteId, setFocusRouteId] = useState<string | null>(null);
  const [highlightStop, setHighlightStop] = useState<string | null>(null);

  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const routeByDriver = useMemo(() => new Map(view.routes.map((r) => [r.driverId, r])), [view.routes]);
  const stopByOrder = useMemo(() => {
    const m = new Map<string, StopView>();
    view.routes.forEach((r) => r.stops.forEach((s) => m.set(s.orderId, s)));
    return m;
  }, [view.routes]);

  // ----- planning settings -----
  const last = props.lastSettings;
  const [driverIds, setDriverIds] = useState<string[]>(() => {
    const prev = (last?.driverIds as string[] | undefined)?.filter((id) => driverById.has(id));
    return prev?.length ? prev : drivers.map((d) => d.id);
  });
  const [startMin, setStartMin] = useState<number>((last?.startMin as number) ?? defaults.startMin);
  const [serviceMin, setServiceMin] = useState<number>((last?.defaultServiceMin as number) ?? defaults.serviceMin);
  const [objective, setObjective] = useState<Objective>((last?.objective as Objective) ?? "balanced");
  const [traffic, setTraffic] = useState<number>((last?.trafficFactor as number) ?? defaults.trafficFactor);
  const [returnToDepot, setReturnToDepot] = useState<boolean>((last?.returnToDepot as boolean) ?? defaults.returnToDepot);

  // ----- manual edit draft -----
  const saved = useMemo(() => buildDraft(view, orders), [view, orders]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [dirty, setDirty] = useState(false);
  // Don't let live updates wipe unsaved drag-and-drop changes; a "Refresh" button appears instead.
  useHoldLiveRefresh(dirty);
  // New server data (after save/optimise/refresh) replaces the local draft.
  const [prevSaved, setPrevSaved] = useState(saved);
  if (prevSaved !== saved) {
    setPrevSaved(saved);
    setDraft(saved);
    setDirty(false);
  }

  function moveOrder(orderId: string, to: string, index?: number) {
    setDraft((d) => {
      const routes = Object.fromEntries(Object.entries(d.routes).map(([k, v]) => [k, v.filter((x) => x !== orderId)]));
      let unassigned = d.unassigned.filter((x) => x !== orderId);
      if (to === "unassigned") unassigned = [...unassigned, orderId];
      else {
        const list = [...(routes[to] ?? [])];
        list.splice(index ?? list.length, 0, orderId);
        routes[to] = list;
      }
      return { routes, unassigned };
    });
    setDirty(true);
  }

  function shift(driverId: string, idx: number, delta: number) {
    setDraft((d) => {
      const list = [...d.routes[driverId]];
      const j = idx + delta;
      if (j < 0 || j >= list.length) return d;
      [list[idx], list[j]] = [list[j], list[idx]];
      return { ...d, routes: { ...d.routes, [driverId]: list } };
    });
    setDirty(true);
  }

  // ----- readiness -----
  const open = orders.filter((o) => OPEN_STATUSES.has(o.status));
  const notLocated = open.filter((o) => o.lat === null);
  const done = orders.filter((o) => o.status === "delivered" || o.status === "failed");
  const startedRoutes = view.routes.filter((r) => r.status !== "planned").length;
  // Why "Optimise" can't run yet, with the fix, so a disabled button never leaves the user guessing.
  const blocker: { text: string; href?: string; cta?: string } | null = !props.depots.length
    ? { text: "Add a depot address first.", href: "/admin/settings", cta: "Open settings" }
    : !drivers.length
      ? { text: "Add your drivers first.", href: "/admin/drivers", cta: "Add drivers" }
      : !open.length
        ? { text: "There are no orders to plan for this day.", href: `/admin/orders?date=${date}`, cta: "Add or import orders" }
        : !driverIds.length
          ? { text: "Tick at least one driver on shift." }
          : null;

  function report(r: { ok: boolean; message?: string; error?: string }) {
    setNotice(r.ok ? { tone: "ok", text: r.message ?? "Done" } : { tone: "error", text: r.error ?? "Failed" });
  }

  function runOptimise() {
    if (plan?.status === "dispatched" && !confirm("This plan is already with the drivers. Re-optimising updates their remaining stops. Continue?")) return;
    setBusy("optimise");
    startTransition(async () => {
      report(await optimise({ date, driverIds, startMin, defaultServiceMin: serviceMin, objective, trafficFactor: traffic, returnToDepot }));
      setBusy(null);
      router.refresh();
    });
  }

  function saveDraft() {
    setBusy("save");
    startTransition(async () => {
      report(await saveManualEdit(date, Object.entries(draft.routes).map(([driverId, orderIds]) => ({ driverId, orderIds }))));
      setBusy(null);
      router.refresh();
    });
  }

  function toggleDispatch(on: boolean) {
    if (!on && !confirm("Recall this plan? Drivers will no longer see it.")) return;
    setBusy("dispatch");
    startTransition(async () => {
      report(await dispatch(date, on));
      setBusy(null);
      router.refresh();
    });
  }

  // ----- map data -----
  const mapStops: MapStop[] = [];
  const planDriverIds = Object.keys(draft.routes);
  for (const driverId of planDriverIds) {
    const route = routeByDriver.get(driverId);
    const driver = driverById.get(driverId);
    const color = driver?.color ?? "#64748b";
    const completed = route?.stops.filter((s) => s.status !== "pending") ?? [];
    completed.forEach((s) =>
      mapStops.push({
        id: s.orderId,
        routeId: driverId,
        lat: s.order.lat,
        lng: s.order.lng,
        label: String(s.seq),
        color,
        status: s.status,
        title: `${s.order.orderNumber} · ${s.order.customerName}`,
        lines: [s.order.address, s.status === "delivered" ? "Delivered" : "Delivery failed"],
      }),
    );
    draft.routes[driverId].forEach((orderId, i) => {
      const o = orderById.get(orderId);
      if (!o || o.lat === null || o.lng === null) return;
      const st = stopByOrder.get(orderId);
      const w = windowLabel(o);
      mapStops.push({
        id: orderId,
        routeId: driverId,
        lat: o.lat,
        lng: o.lng,
        label: String(completed.length + i + 1),
        color,
        status: "pending",
        title: `${o.orderNumber} · ${o.customerName || "Customer"}`,
        lines: [
          o.address,
          `${driver?.name ?? "Driver"} · stop ${completed.length + i + 1}`,
          ...(st && !dirty ? [`ETA ${formatClock(st.etaS)}${st.lateS ? " (late)" : ""}`] : []),
          ...(w ? [`Window ${w}`] : []),
        ],
      });
    });
  }
  for (const orderId of draft.unassigned) {
    const o = orderById.get(orderId);
    if (!o || o.lat === null || o.lng === null) continue;
    mapStops.push({
      id: orderId,
      routeId: null,
      lat: o.lat,
      lng: o.lng,
      label: "",
      color: "#94a3b8",
      status: "unrouted",
      title: `${o.orderNumber} · ${o.customerName || "Customer"}`,
      lines: [o.address, "Not on a route yet"],
    });
  }
  const mapRoutes: MapRoute[] = dirty
    ? []
    : view.routes.filter((r) => r.geometry?.length).map((r) => ({ id: r.driverId, color: r.color, path: r.geometry! }));

  const unassignedReasons = new Map((plan?.unassigned ?? []).map((u) => [u.orderId, u.reason]));

  return (
    <>
      <PageHeader
        title="Route Planner"
        subtitle={
          plan ? (
            <span className="flex flex-wrap items-center gap-2">
              {plan.status === "dispatched" ? <Badge tone="blue">Dispatched to drivers</Badge> : <Badge tone="violet">Draft plan</Badge>}
              <span>Last updated {new Date(plan.updatedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}</span>
            </span>
          ) : (
            "Set the day's conditions, then let the optimiser build the routes."
          )
        }
        actions={
          <>
            <DateNav date={date} today={props.today} basePath="/admin/planner" />
            {plan && (
              <a href={`/api/plans/${date}/export`} className={btn("secondary")}>
                <Download className="size-4" /> Export
              </a>
            )}
            {plan &&
              (plan.status === "dispatched" ? (
                <button className={btn("secondary")} disabled={pending || startedRoutes > 0} onClick={() => toggleDispatch(false)} title={startedRoutes ? "Drivers have started" : undefined}>
                  <Undo2 className="size-4" /> Recall
                </button>
              ) : (
                <button className={btn("success")} disabled={pending || dirty || !view.routes.length} onClick={() => toggleDispatch(true)}>
                  {busy === "dispatch" ? <Spinner /> : <Send className="size-4" />} {busy === "dispatch" ? "Sending…" : "Dispatch to drivers"}
                </button>
              ))}
          </>
        }
      />

      {notice && (
        <div
          key={notice.text}
          className={cx(
            "mb-4 flex animate-rise items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ring-1",
            notice.tone === "ok" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200",
          )}
        >
          {notice.text}
          <button className="text-xs opacity-70 hover:opacity-100" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[18.5rem_minmax(0,1fr)_25rem]">
        {/* ---------------- Left: conditions ---------------- */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Today's orders" />
            <dl className="grid grid-cols-2 gap-px bg-line text-center">
              {[
                ["Open", open.length, "text-slate-900"],
                ["Located", open.length - notLocated.length, "text-emerald-600"],
                ["Not located", notLocated.length, notLocated.length ? "text-amber-600" : "text-slate-400"],
                ["Completed", done.length, "text-slate-500"],
              ].map(([label, n, tone]) => (
                <div key={label as string} className="bg-white px-3 py-2.5">
                  <dd className={cx("text-xl font-semibold tabular-nums", tone as string)}>{n}</dd>
                  <dt className="text-[11px] text-slate-500">{label}</dt>
                </div>
              ))}
            </dl>
            {notLocated.length > 0 && (
              <Link href={`/admin/orders?date=${date}&status=attention`} className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-xs font-medium text-amber-700 hover:bg-amber-50">
                <AlertTriangle className="size-3.5" /> Fix {notLocated.length} address(es) before planning
              </Link>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Planning conditions"
              subtitle={props.depots.length ? `${props.depots.length === 1 ? "Depot" : "Depots"}: ${props.depots.map((d) => d.name).join(", ")}` : undefined}
            />
            <div className="space-y-4 p-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">Drivers on shift</p>
                <div className="space-y-1">
                  {drivers.map((d) => (
                    <label key={d.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={driverIds.includes(d.id)}
                        onChange={(e) => setDriverIds(e.target.checked ? [...driverIds, d.id] : driverIds.filter((x) => x !== d.id))}
                      />
                      <ColorDot color={d.color} />
                      {/* Name on its own line so a long depot name can't squeeze it to "Jo…". */}
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate text-sm text-slate-800">{d.name}</span>
                        <span className="block truncate text-[11px] text-slate-400">
                          {[
                            d.capacity !== null ? `${d.capacity} units${d.maxTrips > 1 ? ` × ${d.maxTrips} trips` : ""}` : d.vehicle,
                            props.depots.length > 1 && props.depots.find((x) => x.id === d.depotId)?.name,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </label>
                  ))}
                  {drivers.length === 0 && (
                    <Link href="/admin/drivers" className="text-xs text-blue-600">
                      Add drivers first →
                    </Link>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start time" hint="Unless set per driver">
                  <input type="time" value={minutesToInput(startMin)} onChange={(e) => setStartMin(inputToMinutes(e.target.value) ?? startMin)} className={inputCls} />
                </Field>
                <Field label="Unload / stop" hint="Default minutes">
                  <input type="number" min={0} max={240} value={serviceMin} onChange={(e) => setServiceMin(Number(e.target.value))} className={inputCls} />
                </Field>
              </div>
              {/* The defaults suit most days; keep the extra knobs out of a first-time user's way. */}
              <details className="group rounded-lg border border-line">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800">More options</span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {OBJECTIVES.find(([v]) => v === objective)?.[1]} · {traffic === 1 ? "no traffic buffer" : `+${Math.round((traffic - 1) * 100)}% traffic`} ·{" "}
                      {returnToDepot ? "back to depot" : "end at last stop"}
                    </span>
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
                </summary>
                <div className="animate-rise space-y-4 border-t border-line p-3">
                  <Field label="Optimise for">
                    <div className="space-y-1">
                      {OBJECTIVES.map(([value, label, hint]) => (
                        <label
                          key={value}
                          className={cx(
                            "flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2",
                            objective === value ? "border-blue-500 bg-blue-50/50" : "border-line hover:bg-slate-50",
                          )}
                        >
                          <input type="radio" name="objective" checked={objective === value} onChange={() => setObjective(value)} className="mt-0.5" />
                          <span>
                            <span className="block text-sm font-medium text-slate-800">{label}</span>
                            <span className="block text-[11px] text-slate-500">{hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label="Traffic buffer" hint="Road times are free-flow; add a margin for traffic and parking.">
                    <select value={traffic} onChange={(e) => setTraffic(Number(e.target.value))} className={inputCls}>
                      {[1, 1.1, 1.15, 1.25, 1.35, 1.5].map((f) => (
                        <option key={f} value={f}>
                          {f === 1 ? "None" : `+${Math.round((f - 1) * 100)}%`}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={returnToDepot} onChange={(e) => setReturnToDepot(e.target.checked)} />
                    Drivers return to depot
                  </label>
                </div>
              </details>
              {blocker?.href ? (
                <Link href={blocker.href} className={btn("primary", "lg", "w-full")}>
                  {blocker.cta} →
                </Link>
              ) : (
                <button className={btn("primary", "lg", "w-full")} disabled={pending || !!blocker} onClick={runOptimise}>
                  {busy === "optimise" ? (
                    <>
                      <Spinner /> Optimising…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" /> {plan ? "Re-optimise routes" : "Optimise routes"}
                    </>
                  )}
                </button>
              )}
              {blocker && <p className="text-center text-xs text-slate-500">{blocker.text}</p>}
              {plan?.status === "dispatched" && done.length > 0 && (
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Completed stops stay as they are. Remaining orders are re-planned from each driver&apos;s last stop.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* ---------------- Centre: map / board ---------------- */}
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex rounded-lg border border-line bg-white p-0.5 shadow-sm">
              {(
                [
                  ["map", "Map", MapIcon],
                  ["board", "Dispatch board", KanbanSquare],
                ] as const
              ).map(([m, label, Icon]) => (
                <button key={m} onClick={() => setMode(m)} className={cx(btn(mode === m ? "primary" : "ghost", "sm"), mode !== m && "shadow-none")}>
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
            {focusRouteId && (
              <button className={btn("ghost", "sm")} onClick={() => setFocusRouteId(null)}>
                Show all routes
              </button>
            )}
          </div>

          {dirty && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm text-white shadow-pop">
              <span>Unsaved changes — arrival times will update when you recalculate.</span>
              <span className="flex gap-2">
                <button className={btn("ghost", "sm", "text-slate-200 hover:bg-white/10")} onClick={() => (setDraft(saved), setDirty(false))}>
                  <RotateCcw className="size-3.5" /> Discard
                </button>
                <button className={btn("primary", "sm")} disabled={pending} onClick={saveDraft}>
                  {busy === "save" ? <Spinner className="size-3.5" /> : <Check className="size-3.5" />} {busy === "save" ? "Recalculating…" : "Recalculate & save"}
                </button>
              </span>
            </div>
          )}

          {plan?.matrixSource === "estimate" && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              Road routing was unreachable, so times and distances are straight-line estimates. Re-optimise when online for real road data.
            </p>
          )}

          {mode === "map" ? (
            <Card className="relative h-[460px] overflow-hidden xl:h-[calc(100dvh-11rem)] xl:min-h-[560px]">
              <DeliveryMap
                depots={props.depots}
                stops={mapStops}
                routes={mapRoutes}
                focusRouteId={focusRouteId}
                highlightStopId={highlightStop}
                onSelectStop={setHighlightStop}
              />
              {/* The optimiser takes a few seconds: say what's happening where the routes will appear. */}
              {busy === "optimise" && (
                <div className="absolute inset-0 z-[500] grid animate-fade-in place-items-center bg-white/55 backdrop-blur-[2px]" role="status">
                  <p className="flex items-center gap-2.5 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-pop">
                    <Spinner className="text-blue-600" /> Finding the best routes with real road times…
                  </p>
                </div>
              )}
            </Card>
          ) : (
            <Board
              draft={draft}
              orderById={orderById}
              driverById={driverById}
              routeByDriver={routeByDriver}
              stopByOrder={stopByOrder}
              dirty={dirty}
              reasons={unassignedReasons}
              onMove={moveOrder}
            />
          )}
        </div>

        {/* ---------------- Right: results ---------------- */}
        <div className="space-y-4">
          {!plan ? (
            <Card className="p-6 text-center">
              <Sparkles className="mx-auto size-8 text-blue-500" />
              <p className="mt-3 text-sm font-semibold text-slate-900">No routes yet</p>
              <p className="mt-1 text-sm text-slate-500">
                {blocker ? (
                  blocker.text
                ) : (
                  <>
                    Tick the drivers on shift, then press <strong>Optimise routes</strong>. The planner uses real road travel times to decide the
                    stop order and which driver takes each order.
                  </>
                )}
              </p>
            </Card>
          ) : (
            <>
              {/* The next step, right where the user is looking after optimising. */}
              {plan.status === "dispatched" ? (
                <div className="flex animate-rise items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
                  <Check className="size-5 shrink-0 text-emerald-600" />
                  <span className="min-w-0 flex-1">Sent. Drivers see their route when they open the app.</span>
                  <Link href="/admin/tracking" className={btn("secondary", "sm")}>
                    Live tracking →
                  </Link>
                </div>
              ) : (
                view.routes.length > 0 && (
                  <div className="animate-rise rounded-xl bg-blue-600 p-4 text-white shadow-sm">
                    <p className="font-semibold">Routes are ready</p>
                    <p className="mt-0.5 text-sm text-blue-100">
                      {dirty
                        ? "Save your changes first, then send the routes."
                        : "Look them over (drag stops on the Dispatch board to change them), then send them to the drivers' phones."}
                    </p>
                    <button
                      className={btn("secondary", "md", "mt-3 w-full border-0")}
                      disabled={pending || dirty}
                      onClick={() => toggleDispatch(true)}
                    >
                      {busy === "dispatch" ? <Spinner /> : <Send className="size-4" />} {busy === "dispatch" ? "Sending…" : "Dispatch to drivers"}
                    </button>
                  </div>
                )
              )}
              <SummaryCard summary={plan.summary} matrixSource={plan.matrixSource} />
              <ComparisonCard before={plan.baseline} after={plan.summary} />

              {draft.unassigned.length > 0 && (
                <Card className="border-amber-200">
                  <CardHeader
                    title={
                      <span className="flex items-center gap-1.5 text-amber-800">
                        <AlertTriangle className="size-4" /> {draft.unassigned.length} not on any route
                      </span>
                    }
                  />
                  <ul className="divide-y divide-line">
                    {draft.unassigned.map((id) => {
                      const o = orderById.get(id);
                      if (!o) return null;
                      return (
                        <li key={id} className="flex items-center gap-2 px-4 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-800">
                              {o.orderNumber} <span className="font-normal text-slate-500">· {o.customerName}</span>
                            </p>
                            <p className="truncate text-[11px] text-amber-700">{UNASSIGNED_REASON[unassignedReasons.get(id) ?? ""] ?? "Added after the last optimisation"}</p>
                          </div>
                          <MoveSelect drivers={planDriverIds.map((d) => driverById.get(d)!).filter(Boolean)} value="" onChange={(to) => moveOrder(id, to)} />
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              )}

              {planDriverIds.map((driverId) => (
                <RouteCard
                  key={driverId}
                  driver={driverById.get(driverId)}
                  route={routeByDriver.get(driverId)}
                  pendingIds={draft.routes[driverId]}
                  orderById={orderById}
                  stopByOrder={stopByOrder}
                  dirty={dirty}
                  focused={focusRouteId === driverId}
                  single={planDriverIds.length === 1}
                  onFocus={() => setFocusRouteId(focusRouteId === driverId ? null : driverId)}
                  onHighlight={setHighlightStop}
                  highlight={highlightStop}
                  otherDrivers={planDriverIds.filter((d) => d !== driverId).map((d) => driverById.get(d)!).filter(Boolean)}
                  onShift={(i, delta) => shift(driverId, i, delta)}
                  onMove={moveOrder}
                />
              ))}

              {view.runs.length > 0 && (
                <Card>
                  <CardHeader title="Plan history" subtitle="Every optimisation and manual change is kept" />
                  <ul className="divide-y divide-line text-xs">
                    {view.runs.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2">
                        <span className="text-slate-700">
                          {r.kind === "optimise" ? "Optimised" : "Manual edit"}
                          <span className="text-slate-400"> · {r.userName ?? "—"}</span>
                        </span>
                        <span className="text-right text-slate-500 tabular-nums">
                          {formatKm(r.summary.distance)} · {formatDuration(r.summary.driveTime)} ·{" "}
                          {new Date(r.createdAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function MoveSelect({ drivers, value, onChange, label = "Assign…" }: { drivers: Driver[]; value: string; onChange: (to: string) => void; label?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      // inputCls is full-width; this compact select must not grow over the row text.
      className={cx(inputCls.replace("w-full", ""), "h-7 w-28 shrink-0 px-1.5 text-[11px]")}
      aria-label="Move to driver"
    >
      <option value="">{label}</option>
      {drivers.map((d) => (
        <option key={d.id} value={d.id}>
          → {d.name}
        </option>
      ))}
    </select>
  );
}

function RouteCard(props: {
  driver: Driver | undefined;
  route: RouteView | undefined;
  pendingIds: string[];
  orderById: Map<string, Order>;
  stopByOrder: Map<string, StopView>;
  dirty: boolean;
  focused: boolean;
  single: boolean;
  onFocus: () => void;
  onHighlight: (id: string) => void;
  highlight: string | null;
  otherDrivers: Driver[];
  onShift: (i: number, delta: number) => void;
  onMove: (orderId: string, to: string) => void;
}) {
  const { driver, route, pendingIds } = props;
  // Folded by default when there are several routes, so the summary of every driver fits on screen.
  const [open, setOpen] = useState(props.single);
  // Clicking a pin on the map opens the card it belongs to.
  const [prevHighlight, setPrevHighlight] = useState(props.highlight);
  if (prevHighlight !== props.highlight) {
    setPrevHighlight(props.highlight);
    if (props.highlight && pendingIds.includes(props.highlight)) setOpen(true);
  }
  if (!driver) return null;
  const completed = route?.stops.filter((s) => s.status !== "pending") ?? [];
  const total = completed.length + pendingIds.length;
  const late = route?.stops.filter((s) => s.lateS > 0 && s.status === "pending").length ?? 0;

  return (
    <Card className={cx(props.focused && "ring-2 ring-blue-500/40")}>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="mt-1 h-9 w-1.5 shrink-0 rounded-full" style={{ background: driver.color }} />
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => {
            props.onFocus();
            if (!props.focused) setOpen(true);
          }}
          title="Show this route on the map"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            {driver.name}
            {route?.status === "in_progress" && <Badge tone="blue">On the road</Badge>}
            {route?.status === "completed" && <Badge tone="green">Finished</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
            {total} {total === 1 ? "stop" : "stops"}
            {route && !props.dirty && (
              <>
                {" "}
                · {formatKm(route.distanceM)} · {formatClock(route.startS)} → {formatClock(route.endS)} ({formatDuration(route.endS - route.startS)})
              </>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {route && route.overtimeS > 0 && <Badge tone="red">Over shift by {formatDuration(route.overtimeS)}</Badge>}
            {route && route.overCapacity > 0 && <Badge tone="red">Over capacity by {route.overCapacity}</Badge>}
            {route && route.trips > 1 && !props.dirty && <Badge tone="violet">{route.trips} trips · reloads at depot</Badge>}
            {late > 0 && <Badge tone="amber">{late} late</Badge>}
          </div>
        </button>
        <button className={btn("ghost", "sm", "px-2 text-xs")} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide" : "Stops"}
          <ChevronDown className={cx("size-3.5 transition", open && "rotate-180")} />
        </button>
      </div>
      {/* Animates height by moving the grid row between 0fr and 1fr; inert keeps folded rows out of tab order. */}
      <div className={cx("grid transition-[grid-template-rows] duration-300 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")} inert={!open}>
        <ol className={cx("min-h-0 overflow-hidden border-line", open && "border-t")}>
          {completed.map((s) => (
            <li key={s.id} className="flex items-center gap-2.5 px-4 py-1.5 text-xs text-slate-500">
              <span className={cx("grid size-5 place-items-center rounded-full text-[10px] font-bold text-white", s.status === "delivered" ? "bg-emerald-500" : "bg-red-500")}>
                {s.status === "delivered" ? "✓" : "!"}
              </span>
              <span className="min-w-0 flex-1 truncate line-through decoration-slate-300">
                {s.order.orderNumber} · {s.order.customerName}
              </span>
              <span>{s.status === "delivered" ? "Delivered" : "Failed"}</span>
            </li>
          ))}
          {pendingIds.map((orderId, i) => {
            const o = props.orderById.get(orderId);
            if (!o) return null;
            const st = props.stopByOrder.get(orderId);
            const showTimes = st && !props.dirty && st.status === "pending";
            const w = windowLabel(o);
            const reload = showTimes ? route?.reloads.find((r) => r.afterSeq === st.seq && st.seq < route.stops.length) : undefined;
            return [
              <li
                key={orderId}
                className={cx("group relative flex items-center gap-2.5 px-4 py-2 hover:bg-slate-50", props.highlight === orderId && "bg-blue-50")}
                onMouseEnter={() => props.onHighlight(orderId)}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: driver.color }}>
                  {completed.length + i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-[13px] font-medium text-slate-800">
                    {o.priority > 0 && <Zap className="size-3 shrink-0 fill-amber-400 text-amber-500" />}
                    {o.customerName || o.orderNumber}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">{o.address}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={cx("text-xs font-semibold tabular-nums", showTimes && st.lateS > 0 ? "text-red-600" : "text-slate-800")}>
                    {showTimes ? formatClock(st.etaS) : "—"}
                  </p>
                  {w && <p className={cx("text-[10px]", showTimes && st.lateS > 0 ? "text-red-600" : "text-slate-400")}>{w}</p>}
                </div>
                {/* Phones: inline. Larger screens: float over the row on hover so names and times keep their space. */}
                <div className="flex shrink-0 items-center gap-0.5 sm:absolute sm:right-2 sm:top-1/2 sm:hidden sm:-translate-y-1/2 sm:rounded-lg sm:bg-white sm:p-0.5 sm:shadow-pop sm:ring-1 sm:ring-line sm:group-focus-within:flex sm:group-hover:flex">
                  <button className={btn("ghost", "icon-sm")} onClick={() => props.onShift(i, -1)} disabled={i === 0} aria-label="Move earlier">
                    <ArrowUp className="size-3" />
                  </button>
                  <button className={btn("ghost", "icon-sm")} onClick={() => props.onShift(i, 1)} disabled={i === pendingIds.length - 1} aria-label="Move later">
                    <ArrowDown className="size-3" />
                  </button>
                  <MoveSelect drivers={props.otherDrivers} value="" onChange={(to) => props.onMove(orderId, to)} label="Move…" />
                  <button className={btn("ghost", "icon-sm")} onClick={() => props.onMove(orderId, "unassigned")} aria-label="Remove from route">
                    <X className="size-3" />
                  </button>
                </div>
              </li>
            ].concat(
              reload ? (
                <li key={`reload-${orderId}`} className="flex items-center justify-between bg-violet-50/60 px-4 py-1.5 text-[11px] text-violet-800">
                  <span className="flex items-center gap-1.5">
                    <RefreshCcw className="size-3" /> Back to depot to reload
                  </span>
                  <span className="tabular-nums">
                    {formatClock(reload.arrivalS)}–{formatClock(reload.departureS)}
                  </span>
                </li>
              ) : [],
            );
          })}
          {route && !props.dirty && pendingIds.length > 0 && route.endS > 0 && (
            <li className="flex items-center justify-between px-4 py-2 text-[11px] text-slate-500">
              <span>Finish{route.stops.length ? " (back at depot if returning)" : ""}</span>
              <span className="font-semibold tabular-nums text-slate-700">{formatClock(route.endS)}</span>
            </li>
          )}
        </ol>
      </div>
    </Card>
  );
}

function Board(props: {
  draft: Draft;
  orderById: Map<string, Order>;
  driverById: Map<string, Driver>;
  routeByDriver: Map<string, RouteView>;
  stopByOrder: Map<string, StopView>;
  dirty: boolean;
  reasons: Map<string, string>;
  onMove: (orderId: string, to: string, index?: number) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const columns = [
    { id: "unassigned", title: "Unassigned", color: "#94a3b8", ids: props.draft.unassigned },
    ...Object.entries(props.draft.routes).map(([id, ids]) => ({
      id,
      title: props.driverById.get(id)?.name ?? "Driver",
      color: props.driverById.get(id)?.color ?? "#64748b",
      ids,
    })),
  ];

  const drop = (e: React.DragEvent, to: string, index?: number) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    const id = e.dataTransfer.getData("text/plain");
    if (id) props.onMove(id, to, index);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 xl:h-[calc(100dvh-11rem)] xl:min-h-[560px]">
      {columns.map((col) => {
        const completed = props.routeByDriver.get(col.id)?.stops.filter((s) => s.status !== "pending").length ?? 0;
        const load = col.ids.reduce((a, id) => a + (props.orderById.get(id)?.demand ?? 0), 0);
        const drv = props.driverById.get(col.id);
        const cap = drv?.capacity != null ? drv.capacity * Math.max(1, drv.maxTrips) : null;
        return (
          <div
            key={col.id}
            onDragOver={(e) => (e.preventDefault(), setOver(col.id))}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => drop(e, col.id)}
            className={cx(
              "flex w-64 shrink-0 flex-col rounded-xl border bg-slate-50/80",
              over === col.id ? "border-blue-400 bg-blue-50/60" : "border-line",
            )}
          >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <ColorDot color={col.color} />
              <span className="flex-1 truncate text-sm font-semibold text-slate-800">{col.title}</span>
              <span className="text-[11px] text-slate-500 tabular-nums">
                {col.ids.length}
                {completed ? ` +${completed} done` : ""}
                {cap !== null && col.id !== "unassigned" && (
                  <span className={cx(load > cap && "font-semibold text-red-600")}>
                    {" "}
                    · {load}/{cap}
                  </span>
                )}
              </span>
            </div>
            <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
              {col.ids.map((id, i) => {
                const o = props.orderById.get(id);
                if (!o) return null;
                const st = props.stopByOrder.get(id);
                return (
                  <div
                    key={id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => drop(e, col.id, i)}
                    className="flex cursor-grab items-start gap-2 rounded-lg border border-line bg-white px-2.5 py-2 shadow-card active:cursor-grabbing"
                  >
                    <GripVertical className="mt-0.5 size-3.5 shrink-0 text-slate-300" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1 truncate text-xs font-semibold text-slate-800">
                        {col.id !== "unassigned" && <span className="text-slate-400">{completed + i + 1}.</span>}
                        {o.priority > 0 && <Zap className="size-3 shrink-0 fill-amber-400 text-amber-500" />}
                        {o.customerName || o.orderNumber}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">{o.address}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-slate-400">
                        <span>{o.orderNumber}</span>
                        {windowLabel(o) && <span>{windowLabel(o)}</span>}
                        {st && !props.dirty && col.id !== "unassigned" && st.status === "pending" && (
                          <span className={st.lateS ? "font-semibold text-red-600" : "text-slate-600"}>ETA {formatClock(st.etaS)}</span>
                        )}
                        {col.id === "unassigned" && props.reasons.get(id) && (
                          <span className="text-amber-700">{UNASSIGNED_REASON[props.reasons.get(id)!]}</span>
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
              {col.ids.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">Drop orders here</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
