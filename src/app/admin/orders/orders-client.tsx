"use client";

import {
  AlertTriangle,
  FileImage,
  MapPinCheck,
  Package,
  Pencil,
  Pin,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Send,
  Upload,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { addDemoOrders, deleteOrders, geocodeOrders, rescheduleOrders, saveOrder } from "@/app/actions/orders";
import { FormError, Modal, SubmitButton } from "@/components/client-ui";
import { DateNav } from "@/components/date-nav";
import { shiftDate } from "@/lib/dates";
import { Badge, btn, Card, ColorDot, cx, EmptyState, Field, GEOCODE_STATUS, inputCls, ORDER_STATUS, PageHeader, Spinner } from "@/components/ui";
import { DELIVERY_PLACE_WARN_M, describeDeliveryPlace, mapPinUrl } from "@/lib/orders";
import type { orders as ordersTable } from "@/lib/db/schema";
import { formatMinutesClock, minutesToInput } from "@/lib/time";

type Order = Omit<typeof ordersTable.$inferSelect, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
type Driver = { id: string; name: string; color: string };
type Depot = { id: string; name: string };

export function OrdersClient(props: {
  /** Admins can also delete delivered orders (test data). */
  isAdmin: boolean;
  date: string;
  today: string;
  status: string;
  q: string;
  demoMode: boolean;
  defaultServiceMin: number;
  counts: Record<string, number>;
  orders: Order[];
  drivers: Driver[];
  depots: Depot[];
}) {
  const { date, orders, drivers } = props;
  const [record, setRecord] = useState<Order | null>(null);
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Order | "new" | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [geo, setGeo] = useState<{ done: number; total: number } | null>(null);
  const [rescheduleTo, setRescheduleTo] = useState(shiftDate(date, 1));
  const [pending, startTransition] = useTransition();

  // Clear the selection whenever the visible list changes.
  const listKey = `${date}|${props.status}|${props.q}`;
  const [prevListKey, setPrevListKey] = useState(listKey);
  if (prevListKey !== listKey) {
    setPrevListKey(listKey);
    setSelected(new Set());
  }

  const needGeocode = orders.filter((o) => o.geocodeStatus === "pending" || o.geocodeStatus === "failed");
  // Orders for this day that drivers can't see yet (not planned, or planned but not dispatched).
  const notSent = props.counts.pending + props.counts.planned;
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const allSelected = orders.length > 0 && orders.every((o) => selected.has(o.id));

  function report(r: { ok: boolean; message?: string; error?: string }) {
    setNotice(r.ok ? { tone: "ok", text: r.message ?? "Done" } : { tone: "error", text: r.error ?? "Failed" });
  }

  async function runGeocode(ids: string[]) {
    setGeo({ done: 0, total: ids.length });
    let failed = 0;
    for (let i = 0; i < ids.length; i += 5) {
      const r = await geocodeOrders(ids.slice(i, i + 5));
      if (!r.ok) {
        report(r);
        break;
      }
      failed += (r.data ?? []).filter((x) => x && x.status === "failed").length;
      setGeo({ done: Math.min(ids.length, i + 5), total: ids.length });
    }
    setGeo(null);
    setNotice({ tone: failed ? "error" : "ok", text: failed ? `${failed} address(es) could not be found — edit them and try again.` : "All addresses checked." });
    router.refresh();
  }

  const tabs = [
    ["", "All", props.counts.all],
    ["attention", "Needs attention", props.counts.attention],
    ["pending", "Unplanned", props.counts.pending],
    ["planned", "Planned", props.counts.planned],
    ["dispatched", "Dispatched", props.counts.dispatched],
    ["delivered", "Delivered", props.counts.delivered],
    ["failed", "Failed", props.counts.failed],
  ] as const;

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ date, ...(props.status ? { status: props.status } : {}), ...(props.q ? { q: props.q } : {}), ...over });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/admin/orders?${p}`;
  };

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Everything that needs delivering on the selected day."
        actions={
          <>
            <DateNav date={date} today={props.today} basePath="/admin/orders" />
            <Link href={`/admin/orders/import?date=${date}`} className={btn("secondary")}>
              <Upload className="size-4" /> Import
            </Link>
            <button className={btn("primary")} onClick={() => setEditing("new")}>
              <Plus className="size-4" /> Add order
            </button>
          </>
        }
      />

      {notice && (
        <div
          key={notice.text}
          className={cx(
            "mb-4 flex animate-rise items-center justify-between rounded-lg px-3 py-2 text-sm ring-1",
            notice.tone === "ok" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200",
          )}
        >
          {notice.text}
          <button className="text-xs opacity-70 hover:opacity-100" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {needGeocode.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/60 px-4 py-3">
          <div className="flex items-center gap-2.5 text-sm text-amber-900">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              <strong>{needGeocode.length}</strong> address{needGeocode.length === 1 ? "" : "es"} not yet located. Orders without a verified
              location can&apos;t be routed.
            </span>
          </div>
          <button className={btn("primary", "sm")} disabled={!!geo} onClick={() => runGeocode(needGeocode.map((o) => o.id))}>
            {geo ? <Spinner /> : <MapPinCheck className="size-4" />}
            {geo ? `Checking ${geo.done}/${geo.total}…` : "Verify addresses"}
          </button>
        </Card>
      )}

      {notSent > 0 && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-blue-200 bg-blue-50/60 px-4 py-3">
          <div className="flex items-center gap-2.5 text-sm text-blue-950">
            <Send className="size-4 shrink-0 text-blue-600" />
            <span>
              <strong>{notSent}</strong> order{notSent === 1 ? " isn't" : "s aren't"} on a driver&apos;s phone yet. Drivers receive orders once they&apos;re on a shipment (or
              the day&apos;s plan) that has been sent to them{props.depots.length === 0 ? ", which needs a depot (where routes start)" : ""}.
            </span>
          </div>
          {props.depots.length === 0 ? (
            <Link href="/admin/settings" className={btn("primary", "sm")}>
              Add a depot
            </Link>
          ) : (
            <div className="flex gap-2">
              <Link href={`/admin/planner?date=${date}`} className={btn("secondary", "sm")}>
                Route Planner
              </Link>
              <Link href={`/admin/shipments?date=${date}`} className={btn("primary", "sm")}>
                <Send className="size-4" /> Create shipments
              </Link>
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map(([key, label, n]) => (
              <Link
                key={key}
                href={qs({ status: key })}
                className={cx(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap",
                  props.status === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {label}
                <span className={cx("tabular-nums", props.status === key ? "text-slate-300" : "text-slate-400")}>{n}</span>
              </Link>
            ))}
          </div>
          <form action="/admin/orders" className="relative w-full sm:w-64">
            <input type="hidden" name="date" value={date} />
            {props.status && <input type="hidden" name="status" value={props.status} />}
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" />
            <input name="q" defaultValue={props.q} placeholder="Search order, customer, address" className={cx(inputCls, "pl-8")} />
          </form>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-blue-50/60 px-3 py-2 text-sm">
            <span className="font-medium text-blue-900">{selected.size} selected</span>
            <button
              className={btn("secondary", "sm")}
              disabled={!!geo}
              onClick={() => runGeocode([...selected])}
            >
              <MapPinCheck className="size-3.5" /> Re-check address
            </button>
            <span className="flex items-center gap-1">
              <input type="date" value={rescheduleTo} onChange={(e) => setRescheduleTo(e.target.value)} className={cx(inputCls, "h-8 w-36 text-xs")} />
              <button
                className={btn("secondary", "sm")}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    report(await rescheduleOrders([...selected], rescheduleTo));
                    setSelected(new Set());
                    router.refresh();
                  })
                }
              >
                Move to date
              </button>
            </span>
            <button
              className={btn("danger", "sm")}
              disabled={pending}
              onClick={() => {
                const done = orders.filter((o) => selected.has(o.id) && (o.status === "delivered" || o.status === "failed")).length;
                const includeCompleted = done > 0 && props.isAdmin;
                const message = !done
                  ? `Delete ${selected.size} order(s)? This also removes them from any plan or shipment.`
                  : props.isAdmin
                    ? `Delete ${selected.size} order(s), including ${done} already delivered or failed?\n\nThis permanently removes their delivery records, photos and signatures. Use it for test data only.`
                    : `${done} of these are already delivered or failed and will be kept (only an admin can delete them). Delete the other ${selected.size - done}?`;
                if (!confirm(message)) return;
                startTransition(async () => {
                  report(await deleteOrders([...selected], { includeCompleted }));
                  setSelected(new Set());
                  router.refresh();
                });
              }}
            >
              <Trash2 className="size-3.5" /> Delete
            </button>
          </div>
        )}

        {orders.length === 0 ? (
          <EmptyState icon={Package} title={props.counts.all ? "No orders match this filter" : "No orders for this day yet"}>
            {!props.counts.all && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Link href={`/admin/orders/import?date=${date}`} className={btn("primary", "sm")}>
                  <Upload className="size-3.5" /> Import a spreadsheet
                </Link>
                <button className={btn("secondary", "sm")} onClick={() => setEditing("new")}>
                  <Plus className="size-3.5" /> Add manually
                </button>
                {props.demoMode && (
                  <button
                    className={btn("ghost", "sm")}
                    disabled={pending}
                    onClick={() => startTransition(async () => (report(await addDemoOrders(date)), router.refresh()))}
                  >
                    <Sparkles className="size-3.5" /> Load demo orders
                  </button>
                )}
              </div>
            )}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(orders.map((o) => o.id)))}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-2.5">Order</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5">Delivery address</th>
                  <th className="px-3 py-2.5">Window</th>
                  <th className="px-3 py-2.5 text-right">Unload</th>
                  <th className="px-3 py-2.5 text-right">Qty</th>
                  <th className="px-3 py-2.5">Driver</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="w-10 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((o) => {
                  const driver = o.driverId ? driverById.get(o.driverId) : null;
                  const pinned = o.pinnedDriverId ? driverById.get(o.pinnedDriverId) : null;
                  const geoS = GEOCODE_STATUS[o.geocodeStatus];
                  return (
                    <tr key={o.id} className={cx("hover:bg-slate-50/70", selected.has(o.id) && "bg-blue-50/40")}>
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(o.id)}
                          onChange={() => {
                            const next = new Set(selected);
                            if (next.has(o.id)) next.delete(o.id);
                            else next.add(o.id);
                            setSelected(next);
                          }}
                          aria-label={`Select ${o.orderNumber}`}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 font-medium text-slate-900">
                          {o.orderNumber}
                          {o.priority > 0 && (
                            <span title="High priority">
                              <Zap className="size-3.5 fill-amber-400 text-amber-500" />
                            </span>
                          )}
                        </div>
                        {o.source !== "manual" && o.source !== "import" && (
                          <span className="text-[10px] uppercase tracking-wide text-slate-400">{o.source.startsWith("feed:") ? o.source.slice(5) : o.source}</span>
                        )}
                      </td>
                      <td className="max-w-44 truncate px-3 py-2.5 text-slate-700">{o.customerName || "—"}</td>
                      <td className="px-3 py-2.5">
                        <div className="max-w-72 truncate text-slate-800" title={o.geocodeLabel ?? undefined}>
                          {[o.address, o.suburb, o.postcode].filter((x, i) => i === 0 || (x && !o.address.includes(x))).join(", ")}
                        </div>
                        {o.geocodeStatus !== "ok" && (
                          <Badge tone={geoS.tone} className="mt-1">
                            {geoS.label}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">
                        {o.windowStartMin === null && o.windowEndMin === null ? (
                          <span className="text-slate-400">Any time</span>
                        ) : (
                          `${o.windowStartMin !== null ? formatMinutesClock(o.windowStartMin) : "…"} – ${o.windowEndMin !== null ? formatMinutesClock(o.windowEndMin) : "…"}`
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {o.serviceMin ?? <span className="text-slate-400">{props.defaultServiceMin}</span>}m
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{o.demand}</td>
                      <td className="px-3 py-2.5">
                        {driver ? (
                          <span className="flex items-center gap-1.5 whitespace-nowrap text-slate-700">
                            <ColorDot color={driver.color} />
                            {driver.name}
                          </span>
                        ) : pinned ? (
                          <span className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-500" title="Pinned driver">
                            <Pin className="size-3" />
                            {pinned.name}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {o.status === "delivered" || o.status === "failed" ? (
                          <button onClick={() => setRecord(o)} title="View delivery record" className="flex items-center gap-1">
                            <Badge tone={ORDER_STATUS[o.status].tone}>
                              {ORDER_STATUS[o.status].label} <FileImage className="size-3" />
                            </Badge>
                          </button>
                        ) : (
                          <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <button className={btn("ghost", "icon")} onClick={() => setEditing(o)} aria-label={`Edit ${o.orderNumber}`}>
                          <Pencil className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add order" : "Edit order"} wide>
        {editing !== null && (
          <OrderForm
            key={editing === "new" ? "new" : editing.id}
            order={editing === "new" ? null : editing}
            date={date}
            drivers={drivers}
            depots={props.depots}
            defaultServiceMin={props.defaultServiceMin}
            onDone={(msg) => {
              setEditing(null);
              setNotice({ tone: "ok", text: msg });
              router.refresh();
            }}
          />
        )}
      </Modal>

      <Modal open={record !== null} onClose={() => setRecord(null)} title={record ? `Delivery record · ${record.orderNumber}` : ""}>
        {record && <DeliveryRecord key={record.id} orderId={record.id} />}
      </Modal>
    </>
  );
}

type RecordEvent = {
  id: string;
  type: string;
  at: string;
  driverName: string | null;
  recipient: string | null;
  reason: string | null;
  note: string | null;
  place: { lat: number; lng: number; accuracyM: number | null; distanceM: number | null } | null;
  proofs: { id: string; kind: "photo" | "signature" }[];
};

function DeliveryRecord({ orderId }: { orderId: string }) {
  const [events, setEvents] = useState<RecordEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/orders/${orderId}/record`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { events: RecordEvent[] }) => setEvents(d.events))
      .catch(() => setError("Couldn't load the delivery record."));
  }, [orderId]);
  if (error) return <FormError message={error} />;
  if (!events) return <p className="py-6 text-center text-sm text-slate-400">Loading…</p>;
  if (!events.length) return <p className="py-6 text-center text-sm text-slate-500">No driver activity recorded for this order.</p>;
  return (
    <ol className="space-y-4">
      {events.map((e) => (
        <li key={e.id} className="rounded-lg border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <Badge tone={e.type === "delivered" ? "green" : e.type === "failed" ? "red" : "blue"}>
              {e.type === "delivered" ? "Delivered" : e.type === "failed" ? "Delivery failed" : "Route started"}
            </Badge>
            <span className="text-xs text-slate-500">
              {new Date(e.at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
              {e.driverName && ` · ${e.driverName}`}
            </span>
          </div>
          <dl className="mt-2 space-y-0.5 text-sm">
            {e.recipient && (
              <p>
                <span className="text-slate-500">Received by:</span> {e.recipient}
              </p>
            )}
            {e.reason && (
              <p>
                <span className="text-slate-500">Reason:</span> {e.reason}
              </p>
            )}
            {e.note && (
              <p>
                <span className="text-slate-500">Note:</span> {e.note}
              </p>
            )}
            {e.place && (
              <p className={cx((e.place.distanceM ?? 0) > DELIVERY_PLACE_WARN_M && "text-amber-700")}>
                <span className="text-slate-500">Confirmed at:</span>{" "}
                <a href={mapPinUrl(e.place.lat, e.place.lng)} target="_blank" rel="noreferrer" className="underline">
                  {describeDeliveryPlace(e.place.distanceM, e.place.accuracyM) ?? "view on map"}
                </a>
              </p>
            )}
          </dl>
          {e.proofs.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {e.proofs.map((p) => (
                <a key={p.id} href={`/api/proofs/${p.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated private image */}
                  <img src={`/api/proofs/${p.id}`} alt={p.kind === "photo" ? "Delivery photo" : "Customer signature"} className={cx("w-full", p.kind === "photo" ? "h-40 object-cover" : "h-28 object-contain bg-white")} />
                  <span className="block px-2 py-1 text-[11px] text-slate-500">{p.kind === "photo" ? "Photo" : "Signature"}</span>
                </a>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function OrderForm({
  order,
  date,
  drivers,
  depots,
  defaultServiceMin,
  onDone,
}: {
  order: Order | null;
  date: string;
  drivers: Driver[];
  depots: Depot[];
  defaultServiceMin: number;
  onDone: (msg: string) => void;
}) {
  const [state, action] = useActionState(saveOrder, undefined);
  useEffect(() => {
    if (state?.ok) onDone(state.message ?? "Saved");
  }, [state, onDone]);

  return (
    <form action={action} className="space-y-4">
      {order && <input type="hidden" name="id" value={order.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Order number" hint={order ? undefined : "Leave blank to generate"}>
          <input name="orderNumber" defaultValue={order?.orderNumber} className={inputCls} />
        </Field>
        <Field label="Delivery date">
          <input name="deliveryDate" type="date" required defaultValue={order?.deliveryDate ?? date} className={inputCls} />
        </Field>
        <Field label="Priority">
          <select name="priority" defaultValue={String(order?.priority ?? 0)} className={inputCls}>
            <option value="0">Normal</option>
            <option value="1">High — serve early</option>
          </select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer">
          <input name="customerName" defaultValue={order?.customerName} className={inputCls} />
        </Field>
        <Field label="Phone">
          <input name="phone" type="tel" defaultValue={order?.phone ?? ""} className={inputCls} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_7rem]">
        <Field label="Street address *">
          <input name="address" required defaultValue={order?.address} placeholder="12 Example St" className={inputCls} />
        </Field>
        <Field label="Suburb">
          <input name="suburb" defaultValue={order?.suburb ?? ""} className={inputCls} />
        </Field>
        <Field label="Postcode">
          <input name="postcode" defaultValue={order?.postcode ?? ""} className={inputCls} />
        </Field>
      </div>
      {order?.geocodeLabel && (
        <p className="-mt-2 text-xs text-slate-500">
          Located as: <span className="text-slate-700">{order.geocodeLabel}</span>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Window from">
          <input name="windowStart" type="time" defaultValue={minutesToInput(order?.windowStartMin)} className={inputCls} />
        </Field>
        <Field label="Window until">
          <input name="windowEnd" type="time" defaultValue={minutesToInput(order?.windowEndMin)} className={inputCls} />
        </Field>
        <Field label="Unload (min)">
          <input name="serviceMin" type="number" min={0} placeholder={String(defaultServiceMin)} defaultValue={order?.serviceMin ?? ""} className={inputCls} />
        </Field>
        <Field label="Quantity (units)">
          <input name="demand" type="number" min={0} defaultValue={order?.demand ?? 1} className={inputCls} />
        </Field>
      </div>
      <Field label="Always deliver with" hint="The planner gives this order to this driver. It reaches their phone once the day's route is planned and dispatched.">
        <select name="pinnedDriverId" defaultValue={order?.pinnedDriverId ?? ""} className={inputCls}>
          <option value="">Any driver</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      {depots.length > 1 && (
        <Field label="Ship from depot" hint="Only drivers based at this depot will be given the order.">
          <select name="depotId" defaultValue={order?.depotId ?? ""} className={inputCls}>
            <option value="">Any depot</option>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Delivery notes">
        <textarea name="notes" rows={2} defaultValue={order?.notes ?? ""} className={cx(inputCls, "h-auto py-2")} />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <SubmitButton pendingText="Saving & locating…">{order ? "Save changes" : "Add order"}</SubmitButton>
      </div>
    </form>
  );
}
