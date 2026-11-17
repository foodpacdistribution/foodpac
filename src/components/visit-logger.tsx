"use client";

import { Ban, Camera, Check, DoorClosed, Hourglass, LoaderCircle, MapPin, Package, Phone, ShoppingCart, Store, ThumbsUp, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { logVisit } from "@/app/actions/visits";
import { isOffline, queueVisit, visitForm } from "@/lib/visit-queue";
import { FormError, Modal } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { prettyDate, shiftDate } from "@/lib/dates";
import type { NotNowReason, SalesStage, StoreType, VisitOutcome } from "@/lib/db/schema";
import { StoreTypePicker } from "@/app/admin/customers/[id]/store-details";
import { resizeImage } from "@/lib/resize-image";
import {
  MAX_VISIT_PHOTOS,
  NOT_NOW_REASONS,
  OUTCOMES,
  stageAfter,
  suggestedFollowUp,
  VISIT_OUTCOMES,
  VISIT_REMIND_IN,
} from "@/lib/visits";

// "Log visit": one form for how a store visit (or call) went, used on the pipeline, the customer
// page and from the map. Built to feel instant at the counter: photos are shrunk the moment
// they're picked, the location is found in the background, and saving closes the form straight
// away while it's sent; if it can't be sent, the form comes back with everything still in it.

/** The store: its stage, and what's known about it (shown at the top; the kind is asked for until known). */
/** An icon for each result, so the right one is found at a glance. */
const OUTCOME_ICON: Record<VisitOutcome, typeof Check> = { ordered: ShoppingCart, interested: ThumbsUp, thinking: Hourglass, samples: Package, not_in: DoorClosed, not_now: Ban };

export type VisitTarget = {
  id: string;
  name: string;
  stage: SalesStage;
  storeType?: StoreType | null;
  contactName?: string | null;
  bestTime?: string | null;
};

/** What the form changed, for showing it before the server confirms. */
export type VisitSaved = {
  customerId: string;
  outcome: VisitOutcome;
  channel: "visit" | "call";
  note: string;
  stage: SalesStage;
  followUpOn: string | null;
  at: string;
};

type Photo = { key: number; url: string; ready: Promise<File> };
type Draft = {
  target: VisitTarget;
  channel: "visit" | "call";
  outcome: VisitOutcome | null;
  /** Only asked for while the store's kind isn't known. */
  storeType: StoreType | null;
  reason: NotNowReason | null;
  note: string;
  followUpOn: string | null;
  /** The reminder was picked by hand, so changing the result no longer changes it. */
  followPicked: boolean;
  photos: Photo[];
  where: { lat: number; lng: number } | "finding" | "none";
};

type Say = (
  r: { ok: true; message?: string } | { ok: false; error: string },
) => void;

let photoKey = 0;

/**
 * The visit form and what opens it. `open(customer)` shows it (optionally with a result already
 * picked); render `dialog` once. `onSaved` runs as soon as Save is tapped, `onFailed` if it then
 * didn't go through.
 */
export function useVisitLogger({
  today,
  say,
  onSaved,
  onFailed,
}: {
  today: string;
  say: Say;
  onSaved?: (v: VisitSaved) => void;
  onFailed?: (customerId: string) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const watch = useRef(0);
  // Whether a form is showing right now (for a save that fails after another one was opened).
  const showing = useRef(false);
  useEffect(() => {
    showing.current = draft !== null;
  }, [draft]);

  const locate = useCallback(() => {
    const ticket = ++watch.current;
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return setDraft((d) => d && { ...d, where: "none" });
    setDraft((d) => d && { ...d, where: "finding" });
    navigator.geolocation.getCurrentPosition(
      (p) =>
        ticket === watch.current &&
        setDraft(
          (d) =>
            d && {
              ...d,
              where: { lat: p.coords.latitude, lng: p.coords.longitude },
            },
        ),
      () =>
        ticket === watch.current &&
        setDraft((d) => d && { ...d, where: "none" }),
      // A fix from the last few minutes is fine: it's the same shop.
      { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 10_000 },
    );
  }, []);

  const open = useCallback(
    (target: VisitTarget, outcome: VisitOutcome | null = null) => {
      setError(null);
      setDraft({
        target,
        channel: "visit",
        outcome,
        reason: null,
        storeType: null,
        note: "",
        followUpOn: outcome ? suggestedFollowUp(outcome, today) : null,
        followPicked: false,
        photos: [],
        where: "finding",
      });
      locate();
    },
    [today, locate],
  );

  const close = useCallback(() => {
    setDraft((d) => {
      d?.photos.forEach((p) => URL.revokeObjectURL(p.url));
      return null;
    });
  }, []);

  const save = (d: Draft) => {
    if (!d.outcome) return setError("Choose how it went.");
    if (d.outcome === "not_now" && !d.reason) return setError("Choose why they said no.");
    const outcome = d.outcome;
    // Its own id (a resend is kept once) and when it happened (it may be sent later).
    const clientId = crypto.randomUUID();
    const at = new Date().toISOString();
    // Close straight away; the form comes back only if the server turns it down.
    setDraft(null);
    setError(null);
    onSaved?.({ customerId: d.target.id, outcome, channel: d.channel, note: d.note, stage: stageAfter(outcome, d.target.stage), followUpOn: d.followUpOn, at });
    start(async () => {
      const failed = (message: string) => {
        onFailed?.(d.target.id);
        // Another form opened since: say so instead of replacing it.
        if (showing.current) return say({ ok: false, error: message });
        // Bring the form back as it was.
        setError(message);
        setDraft(d);
      };
      const fields: Record<string, string> = { clientId, at, customerId: d.target.id, channel: d.channel, outcome, note: d.note };
      if (d.reason) fields.reason = d.reason;
      if (d.storeType) fields.storeType = d.storeType;
      if (d.followUpOn) fields.followUpOn = d.followUpOn;
      if (d.channel === "visit" && typeof d.where === "object") {
        fields.lat = String(d.where.lat);
        fields.lng = String(d.where.lng);
      }
      const photos = await Promise.all(d.photos.map((p) => p.ready));
      const done = () => d.photos.forEach((p) => URL.revokeObjectURL(p.url));
      // No signal: keep it on the phone; it sends itself when the signal is back.
      const keep = async () => {
        try {
          await queueVisit({ id: clientId, name: d.target.name, fields, photos });
          done();
          say({ ok: true, message: "No signal: saved on this phone. It sends itself when you're back online." });
        } catch {
          failed("Couldn't send it: no connection? Nothing is lost, tap Save again.");
        }
      };
      if (!navigator.onLine) return keep();
      try {
        const r = await logVisit(visitForm(fields, photos));
        if (!r.ok) return failed(r.error);
        done();
        say(r);
      } catch (err) {
        if (isOffline(err)) return keep();
        failed("Couldn't send it: no connection? Nothing is lost, tap Save again.");
      }
    });
  };

  const dialog = (
    <Modal
      open={draft !== null}
      onClose={close}
      title={draft ? draft.target.name : ""}
    >
      {draft && (
        <VisitForm
          draft={draft}
          setDraft={setDraft}
          today={today}
          error={error}
          onSave={() => save(draft)}
          onLocate={locate}
        />
      )}
    </Modal>
  );
  return { open, dialog };
}

function VisitForm({
  draft: d,
  setDraft,
  today,
  error,
  onSave,
  onLocate,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
  today: string;
  error: string | null;
  onSave: () => void;
  onLocate: () => void;
}) {
  const tr = useT();
  const file = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Draft>) =>
    setDraft((x) => x && { ...x, ...patch });
  const pickOutcome = (o: VisitOutcome) =>
    setDraft(
      (x) =>
        x && {
          ...x,
          outcome: o,
          reason: o === "not_now" ? x.reason : null,
          followUpOn: x.followPicked
            ? x.followUpOn
            : suggestedFollowUp(o, today),
        },
    );
  const addPhotos = (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_VISIT_PHOTOS - d.photos.length;
    // Shrink each one now, while the rest of the form is filled in, so Save has nothing to wait for.
    const added = [...files]
      .slice(0, Math.max(0, room))
      .map((f) => ({
        key: ++photoKey,
        url: URL.createObjectURL(f),
        ready: resizeImage(f, 1280, 0.8),
      }));
    setDraft((x) => x && { ...x, photos: [...x.photos, ...added] });
  };
  const removePhoto = (key: number) =>
    setDraft((x) => {
      if (!x) return x;
      const p = x.photos.find((q) => q.key === key);
      if (p) URL.revokeObjectURL(p.url);
      return { ...x, photos: x.photos.filter((q) => q.key !== key) };
    });
  const short = (day: string) =>
    tr(prettyDate(day, { weekday: "short", day: "numeric", month: "short" }));
  const remindLabel = (n: number) =>
    n === 7
      ? tr("1 week")
      : n === 14
        ? tr("2 weeks")
        : n === 30
          ? tr("1 month")
          : n === 90
            ? tr("3 months")
            : tr("{n} days", { n });

  return (
    <div className="space-y-4">
      {(d.target.contactName || d.target.bestTime) && (
        <p className="-mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {[d.target.contactName && tr("Talk to {name}", { name: d.target.contactName }), d.target.bestTime].filter(Boolean).join(" · ")}
        </p>
      )}
      {/* In the store or on the phone. */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium">
        {(["visit", "call"] as const).map((ch) => (
          <button
            key={ch}
            type="button"
            aria-pressed={d.channel === ch}
            onClick={() => set({ channel: ch })}
            className={cx(
              "flex h-9 items-center justify-center gap-1.5 rounded-md transition-colors",
              d.channel === ch
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500",
            )}
          >
            {ch === "visit" ? (
              <Store className="size-4" />
            ) : (
              <Phone className="size-4" />
            )}
            {ch === "visit" ? tr("In the store") : tr("On the phone")}
          </button>
        ))}
      </div>

      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-slate-600">
          {tr("How did it go?")}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {VISIT_OUTCOMES.map((o) => {
            const on = d.outcome === o;
            const Icon = OUTCOME_ICON[o];
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => pickOutcome(o)}
                className={cx(
                  "flex min-h-14 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors duration-150",
                  on ? "border-blue-600 bg-blue-50/60 ring-1 ring-blue-600" : "border-line bg-white hover:border-slate-300 hover:bg-slate-50/60",
                )}
              >
                <Icon className={cx("size-[18px] shrink-0", on ? "text-blue-700" : "text-slate-400")} />
                <span className="min-w-0">
                  <span className={cx("block text-sm leading-tight font-medium", on ? "text-blue-950" : "text-slate-900")}>{tr(OUTCOMES[o].label)}</span>
                  <span className="block text-[11px] leading-snug text-slate-500">{tr(OUTCOMES[o].hint)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Opens smoothly under the results when "not now" is picked (the space-y gap goes with it). */}
      <div
        className={cx("grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out", d.outcome === "not_now" ? "grid-rows-[1fr] opacity-100" : "-mt-4 grid-rows-[0fr] opacity-0")}
        inert={d.outcome !== "not_now"}
      >
        <fieldset className="min-h-0 overflow-hidden">
          <legend className="mb-1.5 text-xs font-medium text-slate-600">{tr("Why?")}</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(NOT_NOW_REASONS) as NotNowReason[]).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={d.reason === r}
                onClick={() => set({ reason: r })}
                className={cx(
                  "h-9 rounded-full border px-3.5 text-sm transition-colors duration-150",
                  d.reason === r ? "border-blue-600 bg-blue-50/60 font-medium text-blue-950 ring-1 ring-blue-600" : "border-line hover:border-slate-300",
                )}
              >
                {tr(NOT_NOW_REASONS[r])}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <Field label={tr("What was said (optional)")}>
        <textarea
          value={d.note}
          onChange={(e) => set({ note: e.target.value })}
          rows={3}
          maxLength={2000}
          placeholder={tr(
            "e.g. Boss is Linda, in after 2pm. Uses 500ml bowls from another supplier, pays $38 a carton.",
          )}
          className={cx(inputCls, "h-auto py-2")}
        />
      </Field>

      {!d.target.storeType && <StoreTypePicker value={d.storeType} onChange={(storeType) => set({ storeType })} />}
      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-600">
          {tr("Photos (optional)")}
        </p>
        <div className="flex flex-wrap gap-2">
          {d.photos.map((p) => (
            <div
              key={p.key}
              className="relative size-16 overflow-hidden rounded-lg border border-line bg-slate-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview, not a served image */}
              <img src={p.url} alt="" className="size-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(p.key)}
                aria-label={tr("Remove photo")}
                className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-slate-900/70 text-white"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {d.photos.length < MAX_VISIT_PHOTOS && (
            <button
              type="button"
              onClick={() => file.current?.click()}
              className="grid size-16 place-items-center rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700"
              aria-label={tr("Add photos")}
            >
              <Camera className="size-5" />
            </button>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addPhotos(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-slate-600">
          {tr("Next follow-up")}
        </legend>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={d.followUpOn === null}
            onClick={() => set({ followUpOn: null, followPicked: true })}
            className={cx(
              "h-9 rounded-full border px-3 text-sm transition-colors",
              d.followUpOn === null
                ? "border-blue-500 bg-blue-50 font-medium text-blue-800"
                : "border-line hover:border-slate-300",
            )}
          >
            {tr("None")}
          </button>
          {VISIT_REMIND_IN.map((n) => {
            const day = shiftDate(today, n);
            return (
              <button
                key={n}
                type="button"
                aria-pressed={d.followUpOn === day}
                onClick={() => set({ followUpOn: day, followPicked: true })}
                className={cx(
                  "h-9 rounded-full border px-3 text-sm transition-colors",
                  d.followUpOn === day
                    ? "border-blue-500 bg-blue-50 font-medium text-blue-800"
                    : "border-line hover:border-slate-300",
                )}
              >
                {remindLabel(n)}
              </button>
            );
          })}
          <input
            type="date"
            min={today}
            value={d.followUpOn ?? ""}
            onChange={(e) =>
              set({ followUpOn: e.target.value || null, followPicked: true })
            }
            aria-label={tr("Or pick a date")}
            className={cx(inputCls, "w-auto rounded-full")}
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {d.followUpOn
            ? tr("Reminder on {date}", { date: short(d.followUpOn) })
            : tr("No reminder")}
        </p>
      </fieldset>

      <FormError message={error} />
      {/* Always in reach: pick a result, tap Save, done. */}
      <div className="sticky -bottom-4 -mx-5 -mb-4 space-y-2 border-t border-line bg-white/95 px-5 pt-3 pb-4 backdrop-blur">
        <button
          type="button"
          className={btn("primary", "lg", "w-full")}
          onClick={onSave}
          disabled={!d.outcome}
        >
          <Check className="size-5" /> {tr("Save")}
        </button>
        {d.channel === "visit" && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
            {d.where === "finding" ? (
              <>
                <LoaderCircle className="size-3 animate-spin" />{" "}
                {tr("Finding where you are…")}
              </>
            ) : d.where === "none" ? (
              <button
                type="button"
                onClick={onLocate}
                className="inline-flex items-center gap-1 hover:text-slate-600"
              >
                <MapPin className="size-3" />{" "}
                {tr("No location: tap to try again")}
              </button>
            ) : (
              <>
                <MapPin className="size-3 text-emerald-500" />{" "}
                {tr("Location added")}
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
