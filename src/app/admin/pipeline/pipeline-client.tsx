"use client";

import { Bell, BellRing, Check, Clock, Mail, Pencil, Phone, Plus, Search, Target, UserRound } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { markFollowedUp, saveLead, setFollowUp, setQuietDays, setSalesStage } from "@/app/actions/pipeline";
import { AddressInput } from "@/components/address-input";
import { FormError, KeptForm, Modal, SubmitButton, Toast, type ToastMessage, useKeptForm } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { btn, Card, cx, EmptyState, Field, inputCls, PageHeader } from "@/components/ui";
import { prettyDate, shiftDate } from "@/lib/dates";
import type { Role, SalesStage } from "@/lib/db/schema";
import { daysBetween, type DueFollowUp, QUIET_CHOICES, REMIND_IN } from "@/lib/follow-up";
import { SALES_STAGES, STAGE_INFO } from "@/lib/sales-stage";

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  stage: SalesStage;
  stageAt: string;
  repId: string | null;
  repName: string | null;
  followUpOn: string | null;
  followUpNote: string | null;
  lastOrderOn: string | null;
  due: DueFollowUp | null;
  /** Due, and this person's to do (their own or an unassigned customer). */
  dueForMe: boolean;
};

type Tr = ReturnType<typeof useT>;
const shortDate = (d: string, tr: Tr) => tr(prettyDate(d, { weekday: "short", day: "numeric", month: "short" }));

/** "today", "yesterday", "3 days ago", or the date once it's more than a fortnight back. */
function ago(day: string, today: string, tr: Tr) {
  const n = daysBetween(day, today);
  if (n <= 0) return tr("Today");
  if (n === 1) return tr("Yesterday");
  if (n < 14) return tr("{n} days ago", { n });
  return shortDate(day, tr);
}

/** Why a customer is due, in a few words. */
function dueText(due: DueFollowUp, tr: Tr) {
  if (due.kind === "quiet") return tr("No order for {n} days", { n: due.days });
  if (due.late === 0) return tr("Reminder for today");
  return tr(due.late === 1 ? "Reminder was due yesterday" : "Reminder was due {n} days ago", { n: due.late });
}

export function PipelineClient({ customers, me, today, quietDays }: { customers: Lead[]; me: { id: string; role: Role }; today: string; quietDays: number }) {
  const tr = useT();
  const [editing, setEditing] = useState<Lead | "new" | null>(null);
  const [reminding, setReminding] = useState<Lead | null>(null);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<SalesStage | "all">("all");
  const [mine, setMine] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // Stage changes and finished follow-ups show straight away; fresh server data replaces them.
  const [moved, setMoved] = useState<Record<string, SalesStage>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState(customers);
  if (seen !== customers) {
    setSeen(customers);
    setMoved({});
    setDone(new Set());
  }
  const [, start] = useTransition();
  const deferredQ = useDeferredValue(q);
  const say = (r: { ok: true; message?: string } | { ok: false; error: string }) =>
    setToast((t) => ({ id: (t?.id ?? 0) + 1, text: r.ok ? (r.message ?? "Saved") : r.error, tone: r.ok ? "ok" : "warn" }));

  const rows = useMemo(
    () => customers.map((c) => ({ ...c, stage: moved[c.id] ?? c.stage, ...(done.has(c.id) ? { due: null, dueForMe: false, followUpOn: null, followUpNote: null } : {}) })),
    [customers, moved, done],
  );
  const counts = useMemo(() => {
    const n = { all: rows.length, new: 0, interested: 0, negotiating: 0, won: 0 };
    for (const c of rows) n[c.stage]++;
    return n;
  }, [rows]);
  const shown = useMemo(() => {
    const s = deferredQ.trim().toLowerCase();
    return rows.filter(
      (c) =>
        (stage === "all" || c.stage === stage) &&
        (!mine || c.repId === me.id) &&
        (!s || [c.name, c.phone, c.email, c.address, c.repName, c.followUpNote].some((v) => v?.toLowerCase().includes(s))),
    );
  }, [rows, stage, mine, deferredQ, me.id]);
  // Overdue reminders first, then the longest-quiet customers.
  const toFollow = useMemo(
    () =>
      rows
        .filter((c) => c.dueForMe && (!mine || c.repId === me.id))
        .sort((a, b) => weight(b.due!) - weight(a.due!) || a.name.localeCompare(b.name)),
    [rows, mine, me.id],
  );
  const hasMine = rows.some((c) => c.repId === me.id);

  const move = (c: Lead, to: SalesStage) => {
    const from = c.stage;
    setMoved((m) => ({ ...m, [c.id]: to }));
    start(async () => {
      const r = await setSalesStage(c.id, to);
      say(r);
      if (!r.ok) setMoved((m) => ({ ...m, [c.id]: from }));
    });
  };
  const followedUp = (c: Lead) => {
    setDone((d) => new Set(d).add(c.id));
    start(async () => {
      const r = await markFollowedUp(c.id);
      say(r);
      if (!r.ok)
        setDone((d) => {
          const n = new Set(d);
          n.delete(c.id);
          return n;
        });
    });
  };

  return (
    <>
      <PageHeader
        title={tr("Sales Pipeline")}
        subtitle={tr("Move each customer along as talks go: new customer, interested, in talks, won.")}
        actions={
          <button className={btn("primary")} onClick={() => setEditing("new")}>
            <Plus className="size-4" /> {tr("Add customer")}
          </button>
        }
      />

      <FollowUpList
        items={toFollow}
        today={today}
        quietDays={quietDays}
        canSetQuiet={me.role === "admin"}
        onDone={followedUp}
        onLater={setReminding}
        onQuietDays={(d) => start(async () => say(await setQuietDays(d)))}
      />

      {/* One tile per stage: how many are there, and a click shows just those. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StageTile label={tr("All")} n={counts.all} on={stage === "all"} onClick={() => setStage("all")} className="col-span-2 sm:col-span-1" />
        {SALES_STAGES.map((s) => (
          <StageTile key={s} label={tr(STAGE_INFO[s].label)} hint={tr(STAGE_INFO[s].hint)} dot={STAGE_INFO[s].dot} n={counts[s]} on={stage === s} onClick={() => setStage(stage === s ? "all" : s)} />
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search name, phone, email, address")} className={cx(inputCls, "pl-9")} />
        </div>
        {(me.role === "sales" || hasMine) && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {tr("Only my customers")}
          </label>
        )}
      </div>

      {customers.length === 0 ? (
        <Card>
          <EmptyState icon={Target} title={tr("No customers yet")}>
            {tr("Add the first business you're talking to and set where things are at.")}
          </EmptyState>
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState icon={Search} title={tr("No customers match")}>
            {tr("Try another search or stage.")}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_10.5rem_minmax(0,1fr)_minmax(0,0.9fr)_2.5rem] gap-4 border-b border-line bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500 md:grid">
            <span>{tr("Customer")}</span>
            <span>{tr("Stage")}</span>
            <span>{tr("Follow-up")}</span>
            <span>{tr("Salesperson")}</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {shown.map((c) => (
              <li
                key={c.id}
                className={cx(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1.5fr)_10.5rem_minmax(0,1fr)_minmax(0,0.9fr)_2.5rem]",
                  !c.active && "opacity-60",
                )}
              >
                <div className="min-w-0">
                  <button onClick={() => setEditing(c)} className="block max-w-full truncate text-left text-sm font-semibold text-slate-900 hover:underline">
                    {c.name}
                  </button>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    {c.phone && (
                      <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 hover:text-slate-800">
                        <Phone className="size-3" /> {c.phone}
                      </a>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="inline-flex min-w-0 items-center gap-1 hover:text-slate-800">
                        <Mail className="size-3 shrink-0" /> <span className="truncate">{c.email}</span>
                      </a>
                    )}
                    {!c.phone && !c.email && <span>{tr("No contact details")}</span>}
                  </p>
                </div>
                <StageSelect value={c.stage} onChange={(to) => move(c, to)} label={tr("Stage for {name}", { name: c.name })} />
                <FollowUpCell c={c} today={today} onClick={() => setReminding(c)} />
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500 max-md:justify-end md:text-sm">
                  <UserRound className="size-3.5 shrink-0 text-slate-400 md:hidden" />
                  <span className="truncate">{c.repName ? (c.repId === me.id ? tr("You") : c.repName) : <span className="text-slate-400">{tr("Unassigned")}</span>}</span>
                </p>
                {/* On phones the name itself opens the form. */}
                <div className="hidden md:block">
                  <button className={btn("ghost", "icon")} onClick={() => setEditing(c)} aria-label={tr("Edit {name}", { name: c.name })}>
                    <Pencil className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? tr("Add customer") : tr("Edit customer")}>
        {editing !== null && (
          <LeadForm
            lead={editing === "new" ? null : editing}
            defaultStage={stage === "all" ? "new" : stage}
            onDone={(message) => {
              setEditing(null);
              if (message) say({ ok: true, message });
            }}
          />
        )}
      </Modal>
      <Modal open={reminding !== null} onClose={() => setReminding(null)} title={reminding ? tr("Follow-up · {name}", { name: reminding.name }) : ""}>
        {reminding && (
          <FollowUpForm
            c={reminding}
            today={today}
            onDone={(r, wasFollowedUp) => {
              say(r);
              if (r.ok) {
                if (wasFollowedUp) setDone((d) => new Set(d).add(reminding.id));
                setReminding(null);
              }
            }}
          />
        )}
      </Modal>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

/** Sort key for the follow-up list: the longer it's been waiting, the higher it goes. */
const weight = (d: DueFollowUp) => (d.kind === "reminder" ? 1000 + d.late : d.days);

/** Today's follow-ups at the top of the page: who, why, and buttons to finish or put it off. */
function FollowUpList({
  items,
  today,
  quietDays,
  canSetQuiet,
  onDone,
  onLater,
  onQuietDays,
}: {
  items: Lead[];
  today: string;
  quietDays: number;
  canSetQuiet: boolean;
  onDone: (c: Lead) => void;
  onLater: (c: Lead) => void;
  onQuietDays: (days: number) => void;
}) {
  const tr = useT();
  const rule = canSetQuiet ? (
    <label className="inline-flex items-center gap-1.5">
      {tr("Remind when a customer hasn't ordered for")}
      <select value={quietDays} onChange={(e) => onQuietDays(Number(e.target.value))} className="h-7 rounded-md border border-line bg-white px-1.5 text-xs text-slate-800">
        {QUIET_CHOICES.map((d) => (
          <option key={d} value={d}>
            {tr("{n} days", { n: d })}
          </option>
        ))}
      </select>
    </label>
  ) : (
    <span>{tr("Customers who haven't ordered for {n} days show up here too.", { n: quietDays })}</span>
  );

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <BellRing className={cx("size-4", items.length ? "text-amber-600" : "text-slate-400")} />
          {tr("To follow up")}
          {items.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-px text-xs font-semibold text-amber-800 tabular-nums">{items.length}</span>}
        </p>
        <p className="text-xs text-slate-500">{rule}</p>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">{tr("Nothing due today. Set a reminder on any customer with the bell.")}</p>
      ) : (
        <ul className="max-h-[22rem] divide-y divide-line overflow-y-auto">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate text-sm font-semibold text-slate-900">{c.name}</p>
                <p className={cx("text-xs", c.due!.kind === "reminder" && c.due!.late > 0 ? "text-red-600" : "text-amber-700")}>
                  {dueText(c.due!, tr)}
                  {c.due!.kind === "quiet" && c.lastOrderOn && <span className="text-slate-500"> · {tr("last order {date}", { date: shortDate(c.lastOrderOn, tr) })}</span>}
                  {c.due!.kind === "reminder" && c.lastOrderOn && <span className="text-slate-500"> · {tr("last order {date}", { date: ago(c.lastOrderOn, today, tr) })}</span>}
                </p>
                {c.followUpNote && <p className="mt-0.5 truncate text-xs text-slate-600">“{c.followUpNote}”</p>}
              </div>
              <div className="flex items-center gap-1.5">
                {c.phone && (
                  <a href={`tel:${c.phone.replace(/\s/g, "")}`} className={btn("secondary", "sm")}>
                    <Phone className="size-3.5" /> <span className="max-sm:sr-only">{c.phone}</span>
                  </a>
                )}
                <button className={btn("secondary", "sm")} onClick={() => onLater(c)}>
                  <Clock className="size-3.5" /> {tr("Later")}
                </button>
                <button className={btn("success", "sm")} onClick={() => onDone(c)}>
                  <Check className="size-3.5" /> {tr("Followed up")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The follow-up column: the reminder date, a quiet-customer warning, or when they last ordered. */
function FollowUpCell({ c, today, onClick }: { c: Lead; today: string; onClick: () => void }) {
  const tr = useT();
  const late = c.due?.kind === "reminder" && c.due.late > 0;
  const content = c.followUpOn ? (
    <>
      <Bell className={cx("size-3.5 shrink-0", c.due ? (late ? "text-red-600" : "text-amber-600") : "text-blue-600")} />
      <span className={cx("truncate", c.due ? (late ? "font-medium text-red-700" : "font-medium text-amber-800") : "text-slate-700")}>
        {c.followUpOn === today ? tr("Today") : shortDate(c.followUpOn, tr)}
      </span>
    </>
  ) : c.due?.kind === "quiet" ? (
    <>
      <BellRing className="size-3.5 shrink-0 text-amber-600" />
      <span className="truncate font-medium text-amber-800">{dueText(c.due, tr)}</span>
    </>
  ) : (
    <>
      <Bell className="size-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
      <span className="truncate text-slate-400 group-hover:text-slate-600">
        {c.lastOrderOn ? tr("Ordered {when}", { when: ago(c.lastOrderOn, today, tr) }) : tr("Set reminder")}
      </span>
    </>
  );
  return (
    <button
      type="button"
      onClick={onClick}
      title={c.followUpNote ?? undefined}
      aria-label={tr("Follow-up reminder for {name}", { name: c.name })}
      className="group flex min-w-0 items-center gap-1.5 rounded-md py-1 text-left text-xs hover:bg-slate-50 md:-ml-1.5 md:px-1.5 md:text-sm"
    >
      {content}
    </button>
  );
}

/** Pick when to be reminded (1 day … 2 weeks, or a date), with a note; or mark it done. */
function FollowUpForm({
  c,
  today,
  onDone,
}: {
  c: Lead;
  today: string;
  onDone: (r: { ok: true; message?: string } | { ok: false; error: string }, followedUp?: boolean) => void;
}) {
  const tr = useT();
  // A reminder that has already come round starts blank: the next one has to be today or later.
  const [on, setOn] = useState(c.followUpOn && c.followUpOn >= today ? c.followUpOn : "");
  const [note, setNote] = useState(c.followUpNote ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, followedUp?: boolean) =>
    start(async () => {
      const r = await fn();
      if (r.ok) onDone(r, followedUp);
      else setError(r.error);
    });

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
        {c.lastOrderOn ? (
          <>
            {tr("Last order")}: <span className="font-medium text-slate-900">{shortDate(c.lastOrderOn, tr)}</span> ({ago(c.lastOrderOn, today, tr)})
          </>
        ) : (
          tr("No orders yet")
        )}
        {c.due && <span className="mt-0.5 block font-medium text-amber-800">{dueText(c.due, tr)}</span>}
      </p>

      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-slate-600">{tr("Remind me")}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {REMIND_IN.map(({ days, label }) => {
            const d = shiftDate(today, days);
            return (
              <button
                key={days}
                type="button"
                onClick={() => setOn(d)}
                aria-pressed={on === d}
                className={cx("rounded-lg border px-2 py-2 text-center text-sm transition-colors", on === d ? "border-blue-500 bg-blue-50 font-medium text-blue-800" : "border-line hover:border-slate-300")}
              >
                {tr(label)}
                <span className="block text-[11px] text-slate-500">{shortDate(d, tr)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <Field label={tr("Or pick a date")}>
        <input type="date" min={today} value={on} onChange={(e) => setOn(e.target.value)} className={inputCls} />
      </Field>
      <Field label={tr("Note (optional)")}>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={tr("e.g. Send samples of the 8 oz cups")} className={inputCls} />
      </Field>

      <FormError message={error} />
      <button className={btn("primary", "md", "w-full")} disabled={pending || !on} onClick={() => run(() => setFollowUp(c.id, on, note))}>
        <Bell className="size-4" /> {on ? tr("Remind me on {date}", { date: shortDate(on, tr) }) : tr("Choose when")}
      </button>
      <div className="flex flex-wrap gap-2">
        {(c.due || c.followUpOn) && (
          <button className={btn("secondary", "md", "flex-1")} disabled={pending} onClick={() => run(() => markFollowedUp(c.id), true)}>
            <Check className="size-4" /> {tr("Followed up")}
          </button>
        )}
        {c.followUpOn && (
          <button className={btn("ghost", "md", "flex-1 text-red-600")} disabled={pending} onClick={() => run(() => setFollowUp(c.id, null))}>
            {tr("Clear reminder")}
          </button>
        )}
      </div>
    </div>
  );
}

function StageTile({ label, hint, dot, n, on, onClick, className }: { label: string; hint?: string; dot?: string; n: number; on: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={hint}
      className={cx(
        "rounded-xl border bg-white px-3.5 py-3 text-left shadow-sm transition-colors",
        className,
        on ? "border-blue-500 ring-2 ring-blue-500/20" : "border-line hover:border-slate-300",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {dot && <span className={cx("size-2 rounded-full", dot)} />}
        {label}
      </span>
      <span className="mt-1 block text-2xl font-semibold tabular-nums text-slate-900">{n}</span>
    </button>
  );
}

/** The stage as a dropdown tinted in its colour; changing it saves straight away. */
function StageSelect({ value, onChange, label }: { value: SalesStage; onChange: (to: SalesStage) => void; label: string }) {
  const tr = useT();
  const tint = {
    new: "bg-slate-50 text-slate-700 border-slate-200",
    interested: "bg-blue-50 text-blue-800 border-blue-200",
    negotiating: "bg-amber-50 text-amber-900 border-amber-200",
    won: "bg-emerald-50 text-emerald-800 border-emerald-200",
  }[value];
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as SalesStage)}
      className={cx("h-8 w-36 cursor-pointer rounded-lg border px-2 text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:outline-none md:w-full", tint)}
    >
      {SALES_STAGES.map((s) => (
        <option key={s} value={s}>
          {tr(STAGE_INFO[s].label)}
        </option>
      ))}
    </select>
  );
}

function LeadForm({ lead, defaultStage, onDone }: { lead: Lead | null; defaultStage: SalesStage; onDone: (message?: string) => void }) {
  const tr = useT();
  const [state, form] = useKeptForm(saveLead);
  useEffect(() => {
    if (state?.ok) onDone(state.message);
  }, [state, onDone]);

  return (
    <KeptForm form={form} className="space-y-4">
      {lead && <input type="hidden" name="id" value={lead.id} />}
      <Field label={tr("Business name")}>
        <input name="name" required defaultValue={lead?.name} autoFocus={!lead} className={inputCls} />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-slate-600">{tr("Stage")}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SALES_STAGES.map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 has-[:checked]:font-medium">
              <input type="radio" name="stage" value={s} defaultChecked={(lead?.stage ?? defaultStage) === s} className="sr-only" />
              <span className={cx("size-2 shrink-0 rounded-full", STAGE_INFO[s].dot)} />
              {tr(STAGE_INFO[s].label)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("Phone")}>
          <input name="phone" type="tel" defaultValue={lead?.phone ?? ""} className={inputCls} />
        </Field>
        <Field label={tr("Contact email")}>
          <input name="email" type="email" defaultValue={lead?.email ?? ""} className={inputCls} />
        </Field>
      </div>
      <Field label={tr("Address")}>
        <AddressInput name="address" defaultValue={lead?.address ?? ""} inputClassName={inputCls} />
      </Field>
      <p className="text-xs text-slate-500">{tr("Prices, payment terms and portal logins are set by the office on the Customers page.")}</p>
      <FormError message={state && !state.ok ? state.error : null} />
      <SubmitButton className="w-full">{lead ? tr("Save changes") : tr("Add customer")}</SubmitButton>
    </KeptForm>
  );
}
