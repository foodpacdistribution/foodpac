"use client";

import { AlertTriangle, CheckCircle2, MapPinOff, PackageCheck, Printer, Send, Trash2, Truck, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createShipment, deleteShipment, recallShipment, removeFromShipment, sendShipment } from "@/app/actions/shipments";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { DateNav } from "@/components/date-nav";
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
  startS: number;
  endS: number;
  distanceM: number;
  overtimeS: number;
  overCapacity: number;
  stops: { orderId: string; seq: number; etaS: number; lateS: number; status: string; orderNumber: string; customerName: string; address: string; demand: number }[];
};

const window_ = (a: number | null, b: number | null) => (a === null && b === null ? null : `${a !== null ? formatMinutesClock(a) : "any"}–${b !== null ? formatMinutesClock(b) : "close"}`);

export function ShipmentsClient(props: { date: string; today: string; hasDepot: boolean; ready: Ready[]; drivers: Driver[]; shipments: Shipment[] }) {
  const tr = useT();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  };

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

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ---------------------------------------------------------------- ready to ship */}
        <Card className="overflow-hidden xl:sticky xl:top-4">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{tr("Ready to ship")}</h2>
              <p className="text-xs text-slate-500">{tr("Orders for this day that aren't on a shipment yet.")}</p>
            </div>
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
          {props.ready.length === 0 ? (
            <EmptyState icon={PackageCheck} title={tr("Everything is on a shipment")}>
              {tr("New confirmed orders for this day appear here automatically.")}</EmptyState>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {props.ready.map((o) => {
                const w = window_(o.windowStartMin, o.windowEndMin);
                return (
                  <li key={o.id}>
                    <label className={cx("flex cursor-pointer items-start gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50", selected.has(o.id) && "bg-blue-50/60", !o.located && "cursor-not-allowed opacity-60")}>
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={!o.located}
                        checked={selected.has(o.id)}
                        onChange={() => setSelected((s) => (s.has(o.id) ? (s.delete(o.id), new Set(s)) : new Set(s.add(o.id))))}
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
              {selected.size > 0 && (
                <span className="text-xs text-slate-500">
                  {units} {" "}{tr("units")}{driver?.capacity != null && units > driver.capacity && <span className="text-amber-700"> {" "}{tr("· over")}{" "}{driver.name}{tr("'s capacity (")}{driver.capacity})</span>}
                </span>
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
            props.shipments.map((s) => <ShipmentCard key={s.id} s={s} busy={busy} pending={pending} run={run} />)
          )}
        </div>
      </div>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

function ShipmentCard({
  s,
  busy,
  pending,
  run,
}: {
  s: Shipment;
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

      <dl className="mt-3 grid grid-cols-4 gap-2 px-4 text-center text-xs">
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
          <li key={x.orderId} className="flex items-center gap-3 px-4 py-2">
            <span
              className={cx(
                "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                x.status === "delivered" ? "bg-emerald-600 text-white" : x.status === "failed" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-700",
              )}
            >
              {x.status === "delivered" ? <CheckCircle2 className="size-3.5" /> : x.seq}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                <span className="font-medium text-slate-900">{x.orderNumber}</span> <span className="text-slate-600">{x.customerName}</span>
              </span>
              <span className="block truncate text-xs text-slate-500">{x.address}</span>
            </span>
            <span className={cx("text-xs tabular-nums", x.lateS > 0 ? "font-semibold text-amber-700" : "text-slate-500")}>{formatClock(x.etaS)}</span>
            <span className="w-10 text-right text-xs tabular-nums text-slate-500">×{x.demand}</span>
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
