"use client";

import { AlertTriangle, ArrowRightLeft, CheckCircle2, MapPinOff, PackageCheck, Printer, RefreshCcw, Send, Split, Trash2, Truck, Undo2, X } from "lucide-react";
import Link from "@/components/link";
import { useMemo, useState, useTransition } from "react";
import { createShipment, deleteShipment, recallShipment, removeFromShipment, reoptimiseShipment, sendShipment, splitShipments, transferToDriver } from "@/app/actions/shipments";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { DateNav } from "@/components/date-nav";
import { DeliveryMap, type MapStop } from "@/components/map";
import { Badge, btn, Card, ColorDot, cx, EmptyState, inputCls, PageHeader, Spinner } from "@/components/ui";
import { FULFILMENT } from "@/lib/money";
import { formatClock, formatKm, formatMinutesClock } from "@/lib/time";
import { Tx, useT } from "@/components/i18n";

type Ready = {
  id: string;
  orderNumber: string;
  customerName: string;
  address: string;
  located: boolean;
  geocodeStatus: string;
  windowStartMin: number | null;
  windowEndMin: number | null;
  demand: number;
  pinnedDriverId: string | null;
  fulfilment: keyof typeof FULFILMENT | null;
  paymentStatus: string | null;
  lat: number | null;
  lng: number | null;
  /** For grouping the list; null when the address doesn't say. */
  suburb: string | null;
};
type Driver = { id: string; name: string; color: string; capacity: number | null };
type Shipment = {
  id: string;
  number: string;
  driverId: string;
  driverName: string;
  color: string;
  vehicle: string | null;
  capacity: number | null;
  status: "planned" | "in_progress" | "completed";
  dispatchedAt: string | null;
  matrixSource: "osrm" | "estimate" | null;
  geometry: [number, number][] | null;
  startS: number;
  endS: number;
  distanceM: number;
  overtimeS: number;
  overCapacity: number;
  stops: {
    orderId: string;
    seq: number;
    doneS: number | null;
    lateS: number;
    /** Expected arrival; follows the driver once they've set off. */
    etaS: number;
    windowStartMin: number | null;
    windowEndMin: number | null;
    status: string;
    orderNumber: string;
    customerName: string;
    address: string;
    demand: number;
    lat: number;
    lng: number;
  }[];
};

const window_ = (a: number | null, b: number | null) => (a === null && b === null ? null : `${a !== null ? formatMinutesClock(a) : "any"}–${b !== null ? formatMinutesClock(b) : "close"}`);

const OTHER_AREA = "Other";
const SECTORS = ["North", "North-east", "East", "South-east", "South", "South-west", "West", "North-west"];

/** Compass direction (one of 8) and straight-line km from the depot to a point. */
function fromDepot(depot: { lat: number; lng: number }, p: { lat: number; lng: number }) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLng = toRad(p.lng - depot.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(p.lat));
  const x = Math.cos(toRad(depot.lat)) * Math.sin(toRad(p.lat)) - Math.sin(toRad(depot.lat)) * Math.cos(toRad(p.lat)) * Math.cos(dLng);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  const sector = Math.round(((bearing + 360) % 360) / 45) % 8;
  const dLat = toRad(p.lat - depot.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(depot.lat)) * Math.cos(toRad(p.lat)) * Math.sin(dLng / 2) ** 2;
  return { sector, km: 2 * 6371 * Math.asin(Math.sqrt(h)) };
}

const countLabel = (n: number, u: number) =>
  `${n === 1 ? "{n} order" : "{n} orders"} · ${u === 1 ? "{u} unit" : "{u} units"}`;

export function ShipmentsClient(props: {
  date: string;
  today: string;
  hasDepot: boolean;
  depots: { id: string; name: string; lat: number; lng: number }[];
  ready: Ready[];
  drivers: Driver[];
  shipments: Shipment[];
}) {
  const tr = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const [showMap, setShowMap] = useState(true);
  const [groupBy, setGroupBy] = useState<"direction" | "suburb">("direction");
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitDrivers, setSplitDrivers] = useState<Set<string>>(new Set());
  const [driverId, setDriverId] = useState<string>("");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const locatable = props.ready.filter((o) => o.located);
  const chosen = props.ready.filter((o) => selected.has(o.id));
  // Suggest the driver the selected orders are pinned to, if they all agree.
  const pinned = [...new Set(chosen.map((o) => o.pinnedDriverId).filter(Boolean))];
  const effectiveDriver = driverId || (pinned.length === 1 ? pinned[0]! : "");
  const existing = props.shipments.find((s) => s.driverId === effectiveDriver);
  const units = chosen.reduce((t, o) => t + o.demand, 0);
  const driver = props.drivers.find((d) => d.id === effectiveDriver);

  const run = (key: string, fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, after?: () => void) => {
    setBusy(key);
    start(async () => {
      const r = await fn();
      setBusy(null);
      setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Done") : r.error, tone: r.ok ? "ok" : "warn" });
      if (r.ok) after?.();
    });
  };

  // The list by area, so a van's worth of nearby orders can be ticked together: by direction from
  // the depot (a van usually works one side of town), or by suburb.
  const depot = props.depots[0];
  const groups = useMemo(() => {
    const by = new Map<string, { label: string; detail: string; order: number; list: Ready[] }>();
    const add = (key: string, label: string, order: number, o: Ready) => {
      const g = by.get(key) ?? { label, detail: "", order, list: [] };
      g.list.push(o);
      by.set(key, g);
    };
    for (const o of props.ready) {
      if (groupBy === "direction" && depot && o.lat !== null && o.lng !== null) {
        const { sector } = fromDepot(depot, { lat: o.lat, lng: o.lng });
        add(`d${sector}`, SECTORS[sector], sector, o);
      } else if (groupBy === "direction") {
        add("other", OTHER_AREA, 99, o);
      } else {
        add(o.suburb ?? "other", o.suburb ?? OTHER_AREA, o.suburb ? 0 : 99, o);
      }
    }
    for (const g of by.values()) {
      if (groupBy !== "direction" || !depot) continue;
      const kms = g.list.filter((o) => o.lat !== null).map((o) => fromDepot(depot, { lat: o.lat!, lng: o.lng! }).km);
      const suburbs = [...new Set(g.list.map((o) => o.suburb).filter(Boolean))];
      if (kms.length) g.detail = `${Math.round(Math.min(...kms))}–${Math.round(Math.max(...kms))} km · ${suburbs.slice(0, 4).join(", ")}${suburbs.length > 4 ? "…" : ""}`;
      // Nearest first inside a direction, so the list reads outwards from the depot.
      g.list.sort((a, b) => (a.lat === null ? 1 : b.lat === null ? -1 : fromDepot(depot, { lat: a.lat, lng: a.lng! }).km - fromDepot(depot, { lat: b.lat, lng: b.lng! }).km));
    }
    return [...by.entries()].sort(([, a], [, b]) => a.order - b.order || a.label.localeCompare(b.label));
  }, [props.ready, groupBy, depot]);

  const mapStops: MapStop[] = [
    ...props.shipments.flatMap((sh) =>
      sh.stops.map((x) => ({
        id: `${sh.id}:${x.orderId}`,
        routeId: sh.id,
        lat: x.lat,
        lng: x.lng,
        label: String(x.seq),
        color: sh.color,
        status: x.status === "delivered" ? ("delivered" as const) : x.status === "failed" ? ("failed" as const) : ("pending" as const),
        title: `${sh.number} · ${x.seq}. ${x.customerName || x.orderNumber}`,
        lines: [x.address, sh.driverName],
      })),
    ),
    // Ready orders: grey, or blue with a tick once selected. Tapping one selects it.
    ...locatable.map((o) => ({
      id: o.id,
      routeId: null,
      lat: o.lat!,
      lng: o.lng!,
      label: selected.has(o.id) ? "✓" : "",
      color: "#2563eb",
      status: selected.has(o.id) ? ("pending" as const) : ("unrouted" as const),
      title: o.customerName || o.orderNumber,
      lines: [o.orderNumber, o.address, `${tr("Qty")} ${o.demand}`],
    })),
  ];
  const readyIds = new Set(locatable.map((o) => o.id));

  const totals = useMemo(
    () => ({
      ready: props.ready.length,
      shipments: props.shipments.length,
      sent: props.shipments.filter((s) => s.dispatchedAt).length,
      stops: props.shipments.reduce((t, s) => t + s.stops.length, 0),
    }),
    [props.ready, props.shipments],
  );

  return (
    <>
      <PageHeader
        title={tr("Shipments")}
        subtitle={tr("Confirmed orders show up here. Group them into a shipment for a driver, print the docket, and send it to their phone.")}
        actions={<DateNav date={props.date} today={props.today} basePath="/admin/shipments" />}
      />

      <p className="-mt-2 mb-4 text-xs text-slate-500">
        {tr("One driver at a time: tick orders (or a whole suburb), choose the driver. To plan the whole day for every driver at once, use the")}{" "}
        <Link href={`/admin/planner?date=${props.date}`} className="font-medium text-blue-700 hover:underline">
          {tr("Route Planner")} →
        </Link>{" "}
        {tr("Both work on the same routes.")}
      </p>

      {!props.hasDepot && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4" /> {" "}{tr("Shipments start from your depot. Add its address first.")}</span>
          <Link href="/admin/settings" className={btn("primary", "sm")}>
            {tr("Add a depot")}</Link>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Ready to ship", totals.ready],
          ["Shipments", totals.shipments],
          ["Sent to drivers", `${totals.sent}/${totals.shipments}`],
          ["Stops on shipments", totals.stops],
        ].map(([label, value]) => (
          <Card key={label} className="px-4 py-3">
            <p className="text-xs text-slate-500">{<Tx>{label}</Tx>}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
          </Card>
        ))}
      </div>

      {(locatable.length > 0 || props.shipments.length > 0) && (
        <Card className="mb-4 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span className="font-semibold text-slate-900">{tr("Map")}</span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-full bg-slate-400" /> {tr("Ready to ship (tap to select)")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-full bg-blue-600" /> {tr("Selected")}
              </span>
              <span>{tr("Numbered pins: stops on a shipment")}</span>
            </p>
            <button className={btn("ghost", "sm")} onClick={() => setShowMap(!showMap)}>
              {showMap ? tr("Hide map") : tr("Show map")}
            </button>
          </div>
          {showMap && (
            <div className="h-72 lg:h-96">
              <DeliveryMap
                depots={props.depots}
                stops={mapStops}
                routes={props.shipments.filter((sh) => sh.geometry).map((sh) => ({ id: sh.id, color: sh.color, path: sh.geometry! }))}
                onSelectStop={(id) => readyIds.has(id) && toggle(id)}
                fitOnce
              />
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ---------------------------------------------------------------- ready to ship */}
        <Card className="overflow-hidden xl:sticky xl:top-4">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{tr("Ready to ship")}</h2>
              <p className="text-xs text-slate-500">{tr("Orders for this day that aren't on a shipment yet.")}</p>
            </div>
            {props.ready.length > 0 && (
              <div className="flex items-center gap-3">
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as "direction" | "suburb")} className={cx(inputCls, "h-8 w-auto py-0 text-xs")} aria-label={tr("Group by")}>
                <option value="direction">{tr("By direction from the depot")}</option>
                <option value="suburb">{tr("By suburb")}</option>
              </select>
              {locatable.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={locatable.length > 0 && locatable.every((o) => selected.has(o.id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(locatable.map((o) => o.id)) : new Set())}
                />
                {tr("Select all")}</label>
              )}
              </div>
            )}
          </div>
          {props.ready.length === 0 ? (
            <EmptyState icon={PackageCheck} title={tr("Everything is on a shipment")}>
              {tr("New confirmed orders for this day appear here automatically.")}</EmptyState>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {groups.map(([area, { label, detail, list }]) => {
                const pickable = list.filter((o) => o.located);
                const all = pickable.length > 0 && pickable.every((o) => selected.has(o.id));
                const units = list.reduce((t, o) => t + o.demand, 0);
                return (
                  <li key={area}>
                    <label className="sticky top-0 z-10 flex cursor-pointer items-center gap-3 border-y border-line bg-slate-50/95 px-4 py-1.5 text-xs font-semibold text-slate-700 backdrop-blur">
                      <input
                        type="checkbox"
                        disabled={!pickable.length}
                        checked={all}
                        onChange={() =>
                          setSelected((sel) => {
                            const next = new Set(sel);
                            for (const o of pickable) {
                              if (all) next.delete(o.id);
                              else next.add(o.id);
                            }
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        {area === "other" ? tr("Other") : groupBy === "direction" ? tr(label) : label}
                        {detail && <span className="block truncate text-[11px] font-normal text-slate-500">{detail}</span>}
                      </span>
                      <span className="shrink-0 font-normal text-slate-500">{tr(countLabel(list.length, units), { n: list.length, u: units })}</span>
                    </label>
                    <ul className="divide-y divide-line">
                      {list.map((o) => {
                const w = window_(o.windowStartMin, o.windowEndMin);
                        return (
                          <li key={o.id}>
                            <label className={cx("flex cursor-pointer items-start gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50", selected.has(o.id) && "bg-blue-50/60", !o.located && "cursor-not-allowed opacity-60")}>
                              <input
                                type="checkbox"
                                className="mt-1"
                                disabled={!o.located}
                                checked={selected.has(o.id)}
                                onChange={() => toggle(o.id)}
                              />
                              <span className="min-w-0 flex-1 text-sm">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-semibold text-slate-900">{o.orderNumber}</span>
                                  <span className="truncate text-slate-600">{o.customerName}</span>
                                  {o.fulfilment && <Badge tone={FULFILMENT[o.fulfilment].tone}>{<Tx>{FULFILMENT[o.fulfilment].label}</Tx>}</Badge>}
                                  {o.pinnedDriverId && <Badge tone="violet">{tr("For")}{" "}{props.drivers.find((d) => d.id === o.pinnedDriverId)?.name ?? tr("a driver")}</Badge>}
                                </span>
                                <span className="block truncate text-xs text-slate-500">{o.address}</span>
                                <span className="mt-0.5 flex gap-3 text-[11px] text-slate-500">
                                  <span>{tr("Qty")}{" "}{o.demand}</span>
                                  {w && <span>{tr("Window")}{" "}{w}</span>}
                                  {!o.located && (
                                    <span className="flex items-center gap-1 text-red-600">
                                      <MapPinOff className="size-3" /> {" "}{tr("Address not located")}</span>
                                  )}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
          {props.ready.some((o) => !o.located) && (
            <p className="border-t border-line px-4 py-2 text-xs text-slate-500">
              {tr("Orders with an address that isn't located can't be routed.")}{" "}
              <Link href={`/admin/orders?date=${props.date}&status=attention`} className="text-blue-700 hover:underline">
                {tr("Verify addresses")}</Link>
            </p>
          )}
          {props.ready.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-slate-50 px-4 py-3">
              <select value={effectiveDriver} onChange={(e) => setDriverId(e.target.value)} className={cx(inputCls, "w-auto min-w-44")} aria-label={tr("Driver")}>
                <option value="">{tr("Choose a driver…")}</option>
                {props.drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {props.shipments.some((s) => s.driverId === d.id) ? " (has a shipment)" : ""}
                  </option>
                ))}
              </select>
              <button
                className={btn("primary")}
                disabled={!selected.size || !effectiveDriver || !props.hasDepot || pending}
                onClick={() => run("create", () => createShipment(props.date, effectiveDriver, [...selected]), () => setSelected(new Set()))}
              >
                {busy === "create" ? <Spinner /> : <Truck className="size-4" />}
                {existing ? `Add ${selected.size || ""} to ${existing.number}` : `Create shipment${selected.size ? ` (${selected.size})` : ""}`}
              </button>
              {/* Skips the separate "Send" step when the docket isn't needed first. */}
              <button
                className={btn("success")}
                disabled={!selected.size || !effectiveDriver || !props.hasDepot || pending}
                onClick={() => run("create-send", () => createShipment(props.date, effectiveDriver, [...selected], { send: true }), () => setSelected(new Set()))}
              >
                {busy === "create-send" ? <Spinner /> : <Send className="size-4" />}
                {tr(existing ? "Add & send to driver" : "Create & send to driver")}
              </button>
              <button
                className={btn("secondary")}
                disabled={selected.size < 2 || props.drivers.length < 2 || !props.hasDepot || pending}
                onClick={() => setSplitOpen(!splitOpen)}
                title={tr("Share the selected orders between several drivers")}
              >
                <Split className="size-4" /> {tr("Split between drivers")}
              </button>
              {selected.size > 0 && (
                <span className="text-xs text-slate-500">
                  {units} {" "}{tr("units")}{driver?.capacity != null && units > driver.capacity && <span className="text-amber-700"> {" "}{tr("· over")}{" "}{driver.name}{tr("'s capacity (")}{driver.capacity})</span>}
                </span>
              )}
              {splitOpen && selected.size >= 2 && (
                <div className="w-full rounded-lg border border-line bg-white p-3">
                  <p className="text-xs text-slate-600">
                    {tr("Tick the drivers to share the {n} selected orders between. Each gets the orders that suit their area, van and shift; what they already carry counts.", { n: selected.size })}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {props.drivers.map((d) => (
                      <label key={d.id} className={cx("flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ring-1", splitDrivers.has(d.id) ? "bg-blue-50 ring-blue-300" : "ring-line")}>
                        <input
                          type="checkbox"
                          checked={splitDrivers.has(d.id)}
                          onChange={() =>
                            setSplitDrivers((cur) => {
                              const next = new Set(cur);
                              if (next.has(d.id)) next.delete(d.id);
                              else next.add(d.id);
                              return next;
                            })
                          }
                        />
                        <ColorDot color={d.color} /> {d.name}
                        {props.shipments.some((sh) => sh.driverId === d.id) && <span className="text-[11px] text-slate-400">{tr("(has a shipment)")}</span>}
                      </label>
                    ))}
                  </div>
                  <button
                    className={btn("primary", "sm", "mt-3")}
                    disabled={splitDrivers.size < 2 || pending}
                    onClick={() =>
                      run("split", () => splitShipments(props.date, [...splitDrivers], [...selected]), () => {
                        setSelected(new Set());
                        setSplitOpen(false);
                      })
                    }
                  >
                    {busy === "split" ? <Spinner className="size-3" /> : <Split className="size-3.5" />} {tr("Share between {n} drivers", { n: splitDrivers.size })}
                  </button>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* ---------------------------------------------------------------- shipments */}
        <div className="space-y-3">
          {props.shipments.length === 0 ? (
            <Card>
              <EmptyState icon={Truck} title={tr("No shipments for this day yet")}>
                {tr("Tick orders on the left, choose a driver and create a shipment.")}</EmptyState>
            </Card>
          ) : (
            props.shipments.map((s) => <ShipmentCard key={s.id} s={s} drivers={props.drivers} shipments={props.shipments} busy={busy} pending={pending} run={run} />)
          )}
        </div>
      </div>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

function ShipmentCard({
  s,
  drivers,
  shipments,
  busy,
  pending,
  run,
}: {
  s: Shipment;
  drivers: Driver[];
  shipments: Shipment[];
  busy: string | null;
  pending: boolean;
  run: (key: string, fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) => void;
}) {
  const tr = useT();
  const units = s.stops.reduce((t, x) => t + x.demand, 0);
  const late = s.stops.filter((x) => x.lateS > 0).length;
  const done = s.stops.filter((x) => x.status !== "pending").length;
  const state =
    s.status === "completed"
      ? { label: "Completed", tone: "green" as const }
      : s.status === "in_progress"
        ? { label: `On the road · ${done}/${s.stops.length}`, tone: "amber" as const }
        : s.dispatchedAt
          ? { label: "Sent to driver", tone: "blue" as const }
          : { label: "Draft", tone: "slate" as const };
  const editable = s.status === "planned";
  const otherDrivers = drivers.filter((d) => d.id !== s.driverId);

  return (
    <Card className="animate-rise overflow-hidden">
      <div className="h-1" style={{ background: s.color }} />
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3">
        <div>
          <p className="flex items-center gap-2 font-semibold text-slate-900">
            {s.number} <Badge tone={state.tone}>{<Tx>{state.label}</Tx>}</Badge>
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600">
            <ColorDot color={s.color} /> {s.driverName}
            {s.vehicle && <span className="text-slate-400">· {s.vehicle}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link href={`/admin/shipments/${s.id}/docket`} className={btn("secondary", "sm")}>
            <Printer className="size-3.5" /> {" "}{tr("Docket")}</Link>
          {!s.dispatchedAt ? (
            <button className={btn("primary", "sm")} disabled={pending || !s.stops.length} onClick={() => run(`send-${s.id}`, () => sendShipment(s.id))}>
              {busy === `send-${s.id}` ? <Spinner className="size-3" /> : <Send className="size-3.5" />} {" "}{tr("Send to driver")}</button>
          ) : (
            editable && (
              <button className={btn("secondary", "sm")} disabled={pending} onClick={() => run(`recall-${s.id}`, () => recallShipment(s.id))}>
                <Undo2 className="size-3.5" /> {" "}{tr("Recall")}</button>
            )
          )}
          {editable && !s.dispatchedAt && (
            <button
              className={btn("ghost", "icon", "text-red-600")}
              disabled={pending}
              aria-label={`Delete ${s.number}`}
              onClick={() => confirm(`Delete ${s.number}? Its orders go back to “Ready to ship”.`) && run(`del-${s.id}`, () => deleteShipment(s.id))}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 px-4 text-center text-xs">
        {[
          ["Stops", s.stops.length],
          ["Units", s.capacity !== null ? `${units}/${s.capacity}` : units],
          ["Distance", formatKm(s.distanceM)],
          ["Leaves → back", `${formatClock(s.startS)}–${formatClock(s.endS)}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-50 px-2 py-1.5">
            <dt className="text-slate-500">{tr(k as string)}</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
      {s.matrixSource === "estimate" && done < s.stops.length && (
        <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-red-200">
          <p className="flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" />
            {tr("Road data didn't load, so this stop order is from straight-line distances and may not be the best.")}
          </p>
          <button
            className={btn("secondary", "sm")}
            disabled={pending}
            onClick={() =>
              (!s.dispatchedAt || confirm(tr("{number} is already on the driver's phone. Re-optimising may change the order of the stops left. Continue?", { number: s.number }))) &&
              run(`reopt-${s.id}`, () => reoptimiseShipment(s.id))
            }
          >
            {busy === `reopt-${s.id}` ? <Spinner className="size-3" /> : <RefreshCcw className="size-3.5" />} {" "}{tr("Re-optimise")}
          </button>
        </div>
      )}
      {(late > 0 || s.overCapacity > 0 || s.overtimeS > 0) && (
        <p className="mx-4 mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          <AlertTriangle className="size-3.5" />
          {[
            late > 0 && tr(late === 1 ? "{n} stop after the delivery window" : "{n} stops after the delivery window", { n: late }),
            s.overCapacity > 0 && tr("{n} units over capacity", { n: s.overCapacity }),
            s.overtimeS > 0 && tr("runs past the driver's shift"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <ol className="mt-3 divide-y divide-line border-t border-line text-sm">
        {s.stops.map((x) => (
          <li key={x.orderId} className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
            <span
              className={cx(
                "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                x.status === "delivered" ? "bg-emerald-600 text-white" : x.status === "failed" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-700",
              )}
            >
              {x.status === "delivered" ? <CheckCircle2 className="size-3.5" /> : x.seq}
            </span>
            {/* Who first: on a phone the order number is what gets cut off, not the customer. */}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-slate-900">{x.customerName || x.orderNumber}</span>
              <span className="block truncate text-xs text-slate-500">
                {x.customerName && <span className="font-mono text-[11px]">{x.orderNumber} · </span>}
                {x.address}
              </span>
            </span>
            {/* Done: when it really happened. Still to come: when the van is expected, and the customer's window. */}
            <span className="shrink-0 text-right text-xs tabular-nums sm:w-20">
              {x.doneS !== null ? (
                <span className={cx("font-medium", x.status === "failed" ? "text-red-600" : "text-emerald-700")}>{formatClock(x.doneS)}</span>
              ) : (
                <>
                  <span className={cx("block font-medium", x.lateS > 0 ? "text-red-600" : "text-slate-700")} title={x.lateS > 0 ? tr("After the delivery window") : tr("Expected arrival")}>
                    {formatClock(x.etaS)}
                  </span>
                  {window_(x.windowStartMin, x.windowEndMin) && <span className="block text-[10px] text-slate-400">{window_(x.windowStartMin, x.windowEndMin)}</span>}
                </>
              )}
            </span>
            <span className="hidden w-10 text-right text-xs tabular-nums text-slate-500 sm:block">×{x.demand}</span>
            {x.status === "pending" && otherDrivers.length > 0 && (
              <MoveToDriver
                label={tr("Move {order} to another driver", { order: x.orderNumber })}
                busy={busy === `mv-${x.orderId}`}
                disabled={pending}
                drivers={otherDrivers}
                shipments={shipments}
                onPick={(d) =>
                  (!s.dispatchedAt ||
                    confirm(tr("Move {order} to {driver}? It comes off {from}'s phone.", { order: x.orderNumber, driver: d.name, from: s.driverName }))) &&
                  run(`mv-${x.orderId}`, () => transferToDriver(s.id, x.orderId, d.id))
                }
              />
            )}
            {editable && (
              <button
                className={btn("ghost", "icon-sm", "text-slate-400 hover:text-red-600")}
                disabled={pending}
                aria-label={`Take ${x.orderNumber} off ${s.number}`}
                onClick={() => run(`rm-${x.orderId}`, () => removeFromShipment(s.id, x.orderId))}
              >
                {busy === `rm-${x.orderId}` ? <Spinner className="size-3" /> : <X className="size-3.5" />}
              </button>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** An icon that opens the list of other drivers; picking one moves the stop to them. */
function MoveToDriver(props: { label: string; busy: boolean; disabled: boolean; drivers: Driver[]; shipments: Shipment[]; onPick: (d: Driver) => void }) {
  const tr = useT();
  return (
    <label
      className={cx(btn("ghost", "icon-sm", "relative text-slate-400 hover:text-blue-600"), props.disabled && "pointer-events-none opacity-50")}
      title={props.label}
    >
      {props.busy ? <Spinner className="size-3" /> : <ArrowRightLeft className="size-3.5" />}
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={props.label}
        disabled={props.disabled}
        value=""
        onChange={(e) => {
          const d = props.drivers.find((x) => x.id === e.target.value);
          if (d) props.onPick(d);
        }}
      >
        <option value="" disabled>
          {tr("Move to driver…")}
        </option>
        {props.drivers.map((d) => {
          const sh = props.shipments.find((x) => x.driverId === d.id);
          return (
            <option key={d.id} value={d.id}>
              {d.name}
              {sh ? ` (${sh.number}${sh.dispatchedAt ? "" : `, ${tr("not sent")}`})` : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}
