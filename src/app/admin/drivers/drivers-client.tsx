"use client";

import { Clock, KeyRound, MapPin, Package, Pencil, Phone, Plus, Truck } from "lucide-react";
import { useEffect, useState } from "react";
import { saveDriver } from "@/app/actions/drivers";
import { FormError, Modal, SubmitButton, KeptForm, useKeptForm } from "@/components/client-ui";
import { Badge, btn, Card, cx, EmptyState, Field, inputCls, PageHeader } from "@/components/ui";
import { formatClock, formatMinutesClock, minutesToInput } from "@/lib/time";
import { useT } from "@/components/i18n";

type Driver = {
  id: string;
  name: string;
  phone: string | null;
  vehicle: string | null;
  capacity: number | null;
  shiftStartMin: number | null;
  maxShiftMin: number | null;
  color: string;
  active: boolean;
  depotId: string | null;
  maxTrips: number;
  email: string | null;
  today: { stops: number; done: number; endS: number; status: string; dispatched: boolean } | null;
};

const COLORS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4d7c0f", "#c026d3", "#475569"];

type Depot = { id: string; name: string };

export function DriversClient({
  drivers,
  depots,
  canEdit,
  defaults,
}: {
  drivers: Driver[];
  depots: Depot[];
  canEdit: boolean;
  defaults: { startMin: number; maxShiftMin: number };
}) {
  const tr = useT();
  const [editing, setEditing] = useState<Driver | "new" | null>(null);

  return (
    <>
      <PageHeader
        title={tr("Drivers")}
        subtitle={tr("Each driver gets their own login and only sees their own route.")}
        actions={
          canEdit && (
            <button className={btn("primary")} onClick={() => setEditing("new")}>
              <Plus className="size-4" /> {" "}{tr("Add driver")}</button>
          )
        }
      />
      {drivers.length === 0 ? (
        <Card>
          <EmptyState icon={Truck} title={tr("No drivers yet")}>
            {tr("Add the people who deliver so the planner can split orders between them.")}</EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {drivers.map((d) => (
            <Card key={d.id} className={cx("overflow-hidden", !d.active && "opacity-60")}>
              <div className="h-1.5" style={{ background: d.color }} />
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: d.color }}>
                      {d.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                    </span>
                    <div>
                      <p className="font-semibold text-slate-900">{d.name}</p>
                      <p className="text-xs text-slate-500">{d.vehicle ?? tr("No vehicle set")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!d.active && <Badge>{tr("Inactive")}</Badge>}
                    {canEdit && (
                      <button className={btn("ghost", "icon")} onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}>
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
                  <dt className="flex items-center gap-1.5 text-slate-500">
                    <Clock className="size-3.5" /> {" "}{tr("Shift")}</dt>
                  <dd className="text-right text-slate-800">
                    {formatMinutesClock(d.shiftStartMin ?? defaults.startMin)} · {((d.maxShiftMin ?? defaults.maxShiftMin) / 60).toFixed(1).replace(".0", "")}{tr("h max")}</dd>
                  <dt className="flex items-center gap-1.5 text-slate-500">
                    <Package className="size-3.5" /> {" "}{tr("Capacity")}</dt>
                  <dd className="text-right text-slate-800">
                    {d.capacity !== null ? tr(`${d.capacity} units`) : tr("Unlimited")}
                    {d.maxTrips > 1 && <> {tr(`× ${d.maxTrips} trips`)}</>}
                  </dd>
                  <dt className="flex items-center gap-1.5 text-slate-500">
                    <MapPin className="size-3.5" /> {" "}{tr("Depot")}</dt>
                  <dd className="truncate text-right text-slate-800">{(depots.find((x) => x.id === d.depotId) ?? depots[0])?.name ?? "—"}</dd>
                  <dt className="flex items-center gap-1.5 text-slate-500">
                    <Phone className="size-3.5" /> {" "}{tr("Phone")}</dt>
                  <dd className="text-right text-slate-800">{d.phone ?? "—"}</dd>
                  <dt className="flex items-center gap-1.5 text-slate-500">
                    <KeyRound className="size-3.5" /> {" "}{tr("Login")}</dt>
                  <dd className="truncate text-right text-slate-800">{d.email ?? <span className="text-amber-600">{tr("No login")}</span>}</dd>
                </dl>
                <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs">
                  {d.today ? (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">
                        {tr("Today:")}{" "}<strong className="text-slate-900">{d.today.done}/{d.today.stops}</strong> {" "}{tr("stops")}</span>
                      <span className="text-slate-600">
                        {d.today.status === "completed" ? tr("Finished") : tr(`Est. finish ${formatClock(d.today.endS)}`)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-slate-400">{tr("Not on today's plan")}</span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add driver" : "Edit driver"}>
        {editing !== null && (
          <DriverForm
            key={editing === "new" ? "new" : editing.id}
            driver={editing === "new" ? null : editing}
            depots={depots}
            defaults={defaults}
            usedColors={drivers.map((d) => d.color)}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}

function DriverForm({
  driver,
  depots,
  defaults,
  usedColors,
  onDone,
}: {
  driver: Driver | null;
  depots: Depot[];
  defaults: { startMin: number; maxShiftMin: number };
  usedColors: string[];
  onDone: () => void;
}) {
  const tr = useT();
  const [state, form] = useKeptForm(saveDriver);
  const [color, setColor] = useState(driver?.color ?? COLORS.find((c) => !usedColors.includes(c)) ?? COLORS[0]);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <KeptForm form={form} className="space-y-4">
      {driver && <input type="hidden" name="id" value={driver.id} />}
      <input type="hidden" name="color" value={color} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("Name *")}>
          <input name="name" required defaultValue={driver?.name} className={inputCls} />
        </Field>
        <Field label={tr("Phone")}>
          <input name="phone" type="tel" defaultValue={driver?.phone ?? ""} className={inputCls} />
        </Field>
        <Field label={tr("Vehicle")}>
          <input name="vehicle" defaultValue={driver?.vehicle ?? ""} placeholder={tr("Van 1")} className={inputCls} />
        </Field>
        <Field label={tr("Capacity (units)")} hint={tr("Blank = unlimited")}>
          <input name="capacity" type="number" min={0} defaultValue={driver?.capacity ?? ""} className={inputCls} />
        </Field>
        <Field label={tr("Shift start")} hint={`Blank = planner default (${formatMinutesClock(defaults.startMin)})`}>
          <input name="shiftStart" type="time" defaultValue={minutesToInput(driver?.shiftStartMin)} className={inputCls} />
        </Field>
        <Field label={tr("Max shift (hours)")} hint={`Blank = ${defaults.maxShiftMin / 60}h`}>
          <input name="maxShiftHours" type="number" min={1} max={16} step={0.5} defaultValue={driver?.maxShiftMin ? driver.maxShiftMin / 60 : ""} className={inputCls} />
        </Field>
        <Field label={tr("Home depot")} hint={tr("Starts, reloads and finishes here")}>
          <select name="depotId" defaultValue={driver?.depotId ?? ""} className={inputCls}>
            <option value="">{tr("Default depot")}{depots[0] ? ` (${depots[0].name})` : ""}</option>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("Trips per day")} hint={tr("More than 1 allows returning to reload")}>
          <select name="maxTrips" defaultValue={driver?.maxTrips ?? 1} className={inputCls}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 (single load)" : `Up to ${n}`}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-600">{tr("Route colour")}</p>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cx("size-7 rounded-full ring-offset-2", color === c && "ring-2 ring-slate-900")}
              style={{ background: c }}
              aria-label={`Colour ${c}`}
            />
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-line p-3">
        <p className="mb-2 text-xs font-semibold text-slate-700">{tr("Driver app login")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("Email")}>
            <input name="email" type="email" defaultValue={driver?.email ?? ""} autoComplete="off" className={inputCls} />
          </Field>
          <Field label={driver?.email ? "New password" : "Password"} hint={driver?.email ? "Leave blank to keep" : "At least 8 characters"}>
            <input name="password" type="password" autoComplete="new-password" className={inputCls} />
          </Field>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="active" defaultChecked={driver?.active ?? true} /> {" "}{tr("Active (available for planning)")}</label>
      <FormError message={state && !state.ok ? state.error : null} />
      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton>{driver ? tr("Save driver") : tr("Add driver")}</SubmitButton>
      </div>
    </KeptForm>
  );
}
