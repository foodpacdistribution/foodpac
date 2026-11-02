"use client";

import { Building2, Camera, MapPin, Pencil, Plug, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createStaffUser, deleteUser, saveDepot, saveSettings } from "@/app/actions/settings";
import { FormError, Modal, SubmitButton } from "@/components/client-ui";
import { Badge, btn, Card, CardHeader, cx, Field, inputCls, PageHeader } from "@/components/ui";
import type { settings as settingsTable } from "@/lib/db/schema";
import { minutesToInput } from "@/lib/time";
import { useT } from "@/components/i18n";

type Settings = typeof settingsTable.$inferSelect;
type U = { id: string; name: string; email: string; role: string };
type Depot = { id: string; name: string; address: string; located: boolean; active: boolean };

const TIMEZONES = [
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Darwin",
  "Australia/Hobart",
  "Pacific/Auckland",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
];

export function SettingsClient({
  settings: s,
  users,
  depots,
  meId,
  services,
  children,
}: {
  settings: Settings;
  users: U[];
  depots: Depot[];
  meId: string;
  services: Record<string, string>;
  children?: React.ReactNode;
}) {
  const tr = useT();
  const router = useRouter();
  const [state, action] = useActionState(saveSettings, undefined);
  const [userState, userAction] = useActionState(createStaffUser, undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const userForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (userState?.ok) userForm.current?.reset();
  }, [userState]);

  return (
    <>
      <PageHeader title={tr("Settings")} subtitle={tr("Company, depots, planning defaults, delivery proof and integrations.")} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-4">
        <DepotsCard depots={depots} />
        <form action={action}>
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Building2 className="size-4 text-slate-400" /> {" "}{tr("Company & planning")}</span>} />
            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tr("Company name")}>
                  <input name="companyName" defaultValue={s.companyName} className={inputCls} />
                </Field>
                <Field label={tr("Timezone")} hint={tr("All delivery times use this zone")}>
                  <select name="timezone" defaultValue={s.timezone} className={inputCls}>
                    {[...new Set([s.timezone, ...TIMEZONES])].map((tz) => (
                      <option key={tz}>{tz}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="h-px bg-line" />
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tr("Planning defaults")}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={tr("Drivers start at")}>
                  <input name="defaultStart" type="time" defaultValue={minutesToInput(s.defaultStartMin)} className={inputCls} />
                </Field>
                <Field label={tr("Max shift (hours)")}>
                  <input name="defaultMaxShiftHours" type="number" step={0.5} min={1} max={16} defaultValue={s.defaultMaxShiftMin / 60} className={inputCls} />
                </Field>
                <Field label={tr("Unload per stop (min)")}>
                  <input name="defaultServiceMin" type="number" min={0} max={240} defaultValue={s.defaultServiceMin} className={inputCls} />
                </Field>
                <Field label={tr("Traffic buffer")}>
                  <select name="trafficFactor" defaultValue={s.trafficFactor} className={inputCls}>
                    {[1, 1.1, 1.15, 1.25, 1.35, 1.5].map((f) => (
                      <option key={f} value={f}>
                        {f === 1 ? tr("None") : `+${Math.round((f - 1) * 100)}%`}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr("Reload at depot (min)")} hint={tr("For drivers allowed more than one trip")}>
                  <input name="reloadMin" type="number" min={0} max={120} defaultValue={s.reloadMin} className={inputCls} />
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                  <input type="checkbox" name="returnToDepot" defaultChecked={s.returnToDepot} /> {" "}{tr("Drivers return to depot at end of route")}</label>
              </div>
              <div className="h-px bg-line" />
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Camera className="size-3.5" /> {" "}{tr("Proof of delivery")}</p>
              <div className="space-y-2 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="requirePhoto" defaultChecked={s.requirePhoto} /> {" "}{tr("Require a photo for every delivery")}</label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="requireSignature" defaultChecked={s.requireSignature} /> {" "}{tr("Require the customer's signature")}</label>
                <p className="text-xs text-slate-500">{tr("Drivers can always add a photo or signature; these make them mandatory before a stop can be marked delivered.")}</p>
              </div>
              <FormError message={state && !state.ok ? state.error : null} />
              {state?.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">{state.message}</p>}
              <div className="flex justify-end">
                <SubmitButton pendingText={tr("Saving…")}>{tr("Save settings")}</SubmitButton>
              </div>
            </div>
          </Card>
        </form>
        {children}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Users className="size-4 text-slate-400" /> {" "}{tr("Staff logins")}</span>} subtitle={tr("Driver logins are managed on the Drivers page.")} />
            {notice && <p className="border-b border-line bg-slate-50 px-4 py-2 text-xs text-slate-600">{notice}</p>}
            <ul className="divide-y divide-line">
              {users.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{u.name}</p>
                    <p className="truncate text-xs text-slate-500">{u.email}</p>
                  </div>
                  <Badge tone={u.role === "admin" ? "violet" : u.role === "dispatcher" ? "blue" : "slate"}>{tr(u.role)}</Badge>
                  {u.id !== meId && u.role !== "driver" && (
                    <button
                      className={btn("ghost", "icon", "text-slate-400 hover:text-red-600")}
                      disabled={pending}
                      aria-label={`Remove ${u.name}`}
                      onClick={() => {
                        if (!confirm(`Remove ${u.name}'s login?`)) return;
                        startTransition(async () => {
                          const r = await deleteUser(u.id);
                          setNotice(r.ok ? (r.message ?? null) : r.error);
                          router.refresh();
                        });
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <form ref={userForm} action={userAction} className="space-y-3 border-t border-line p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <UserPlus className="size-3.5" /> {" "}{tr("Add staff login")}</p>
              <div className="grid grid-cols-2 gap-2">
                <input name="name" placeholder={tr("Name")} className={inputCls} />
                <select name="role" defaultValue="dispatcher" className={inputCls}>
                  <option value="dispatcher">{tr("Dispatcher")}</option>
                  <option value="admin">{tr("Admin")}</option>
                </select>
                <input name="email" type="email" placeholder={tr("Email")} className={cx(inputCls, "col-span-2")} />
                <input name="password" type="password" placeholder={tr("Password (8+ characters)")} autoComplete="new-password" className={cx(inputCls, "col-span-2")} />
              </div>
              <FormError message={userState && !userState.ok ? userState.error : null} />
              {userState?.ok && <p className="text-xs text-emerald-700">{userState.message}</p>}
              <SubmitButton size="sm" variant="secondary">
                {tr("Create login")}</SubmitButton>
            </form>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Plug className="size-4 text-slate-400" /> {" "}{tr("Services")}</span>} />
            <dl className="space-y-2.5 p-4 text-xs">
              {Object.entries(services).map(([k, v]) => (
                <div key={k}>
                  <dt className="font-medium capitalize text-slate-700">{tr(k)}</dt>
                  <dd className="text-slate-500">{tr(v)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}

function DepotsCard({ depots }: { depots: Depot[] }) {
  const tr = useT();
  const [editing, setEditing] = useState<Depot | "new" | null>(null);
  const router = useRouter();
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <MapPin className="size-4 text-slate-400" /> {" "}{tr("Depots")}</span>
        }
        subtitle={tr("Each driver starts, reloads and finishes at their home depot. Orders can be tied to a depot on the order form.")}
        action={
          <button className={btn("secondary", "sm")} onClick={() => setEditing("new")}>
            <Plus className="size-3.5" /> {" "}{tr("Add depot")}</button>
        }
      />
      {depots.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-amber-700">{tr("Add your warehouse address. Routes can't be planned without a depot.")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {depots.map((d, i) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  {d.name}
                  {i === 0 && d.active && <Badge tone="blue">{tr("Default")}</Badge>}
                  {!d.active && <Badge>{tr("Inactive")}</Badge>}
                  {!d.located && <Badge tone="red">{tr("Not located")}</Badge>}
                </p>
                <p className="truncate text-xs text-slate-500">{d.address}</p>
              </div>
              <button className={btn("ghost", "icon")} onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}>
                <Pencil className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add depot" : "Edit depot"}>
        {editing !== null && (
          <DepotForm key={editing === "new" ? "new" : editing.id} depot={editing === "new" ? null : editing} onDone={() => (setEditing(null), router.refresh())} />
        )}
      </Modal>
    </Card>
  );
}

function DepotForm({ depot, onDone }: { depot: Depot | null; onDone: () => void }) {
  const tr = useT();
  const [state, action] = useActionState(saveDepot, undefined);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="space-y-4">
      {depot && <input type="hidden" name="id" value={depot.id} />}
      <Field label={tr("Name")}>
        <input name="name" required defaultValue={depot?.name} placeholder={tr("Northside warehouse")} className={inputCls} />
      </Field>
      <Field label={tr("Address")} hint={tr("Checked on the map when you save")}>
        <input name="address" required defaultValue={depot?.address} placeholder={tr("1 Example Rd, Eagle Farm QLD 4009")} className={inputCls} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="active" defaultChecked={depot?.active ?? true} /> {" "}{tr("Active")}</label>
      <FormError message={state && !state.ok ? state.error : null} />
      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton pendingText={tr("Locating…")}>{depot ? tr("Save depot") : tr("Add depot")}</SubmitButton>
      </div>
    </form>
  );
}
