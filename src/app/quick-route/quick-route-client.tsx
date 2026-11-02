"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Flag,
  LocateFixed,
  MapPin,
  MapPinned,
  Navigation,
  Pencil,
  RotateCcw,
  Route,
  Search,
  Trash2,
  TriangleAlert,
  Warehouse,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { describeLocation, locateAddress, planQuickRoute, type QuickEnd, type QuickRouteRequest, type QuickRouteResult } from "@/app/actions/quick-route";
import { FormError, Toast, type ToastMessage } from "@/components/client-ui";
import { DeliveryMap, type MapStop } from "@/components/map";
import { btn, cx, Field, inputCls, Spinner } from "@/components/ui";
import { multiStopNavigation, navigationUrls } from "@/lib/orders";
import { parseAddressList, projectRemaining } from "@/lib/quick-route";
import { describeAccuracy, GOOD_FIX_M, locateBest, LocationError, ROUGH_FIX_M } from "@/lib/locate";
import { formatClock, formatDuration, formatKm } from "@/lib/time";

type StartKind = "gps" | "depot" | "address";
type Form = { startKind: StartKind; startAddress: string; addresses: string; end: QuickEnd; serviceMin: number };
/** An address as located for the driver to confirm. "manual" = the driver placed or moved the pin. */
type Check = { address: string; status: "ok" | "approximate" | "failed" | "manual"; lat: number | null; lng: number | null; label: string | null };
type Done = { address: string; status: "delivered" | "failed" };
type Saved = {
  form: Form;
  step: "enter" | "review";
  checks: Check[];
  result: QuickRouteResult | null;
  /** Browser clock when `result` was planned; maps real time onto the plan's clock (result.startS). */
  plannedAtMs: number;
  /** When the driver finished the last stop (and so left it). */
  leftAtMs: number | null;
  driving: boolean;
  next: number;
  done: Done[];
};

const STORAGE_KEY = "quick-route:v2";
const COLOR = "#2563eb";
const PIN_COLOR: Record<Check["status"], string> = { ok: COLOR, approximate: "#d97706", manual: "#059669", failed: "#94a3b8" };
const BRISBANE = { lat: -27.4698, lng: 153.0251 };
/** ETAs this much later than planned are flagged. */
const LATE_S = 180;

function load(defaults: Form): Saved {
  const empty: Saved = { form: defaults, step: "enter", checks: [], result: null, plannedAtMs: 0, leftAtMs: null, driving: false, next: 0, done: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...empty, ...(JSON.parse(raw) as Saved) } : empty;
  } catch {
    return empty;
  }
}

function save(state: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Convenience only: the route still works without storage.
  }
}

/** The confirmed GPS start: measured, or a pin the driver dragged into place. */
type Here = { lat: number; lng: number; accuracy: number; at: number; manual: boolean; label: string | null };

const END_OPTIONS: { value: QuickEnd; label: string; needsDepot?: boolean }[] = [
  { value: "last_stop", label: "Finish at the last stop" },
  { value: "start", label: "Return to where I started" },
  { value: "depot", label: "Return to the depot", needsDepot: true },
];

type Props = { backHref: string; depotName: string | null; defaultServiceMin: number };

export function QuickRouteClient({ backHref, depotName, defaultServiceMin }: Props) {
  const [state, setState] = useState(() =>
    load({ startKind: "gps", startAddress: "", addresses: "", end: "last_stop", serviceMin: defaultServiceMin }),
  );
  const [error, setError] = useState<string | null>(null);
  const [locationFailed, setLocationFailed] = useState(false);
  const [here, setHere] = useState<Here | null>(null);
  /** While measuring: the best accuracy so far (null until the first fix). */
  const [locating, setLocating] = useState<{ accuracy: number | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const update = (patch: Partial<Saved>) =>
    setState((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  const setForm = (patch: Partial<Form>) => update({ form: { ...state.form, ...patch } });

  const { form, step, checks, result, plannedAtMs, leftAtMs, driving, next, done } = state;
  const { addresses: addressList, duplicates } = parseAddressList(form.addresses);

  // Keep projected ETAs current while driving.
  useEffect(() => {
    if (!driving) return;
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [driving]);

  // ---------------------------------------------------------------- start position

  /** Measures the position carefully (see lib/locate) and looks up the nearest street to show the driver. */
  const findMe = async () => {
    setLocating({ accuracy: null });
    setLocationFailed(false);
    try {
      const fix = await locateBest({ onProgress: (f) => setLocating({ accuracy: f.accuracy }) });
      setHere({ ...fix, manual: false, label: null });
      setLocating(null);
      const res = await describeLocation(fix.lat, fix.lng);
      if (res.ok && res.data) setHere((h) => (h && h.at === fix.at ? { ...h, label: res.data! } : h));
      return fix;
    } catch (err) {
      setLocating(null);
      setError((err as Error).message);
      setLocationFailed(err instanceof LocationError);
      throw err;
    }
  };

  /** The start for planning: the confirmed position if it's recent (or placed by hand), otherwise a fresh measurement. */
  const startPosition = async () => {
    if (here && (here.manual || Date.now() - here.at < 3 * 60_000)) return { lat: here.lat, lng: here.lng };
    const fix = await findMe();
    return { lat: fix.lat, lng: fix.lng };
  };

  // ---------------------------------------------------------------- address checking

  /** Looks each address up one by one (showing progress), reusing ones already checked or pinned by hand. */
  const checkAddresses = () => {
    setError(null);
    startTransition(async () => {
      const known = new Map(checks.map((c) => [c.address, c]));
      const out: Check[] = [];
      setProgress({ done: 0, total: addressList.length });
      for (const address of addressList) {
        let c = known.get(address);
        if (!c || c.status === "failed") {
          const res = await locateAddress(address);
          if (!res.ok) {
            setProgress(null);
            return setError(res.error);
          }
          c = { address, ...res.data! };
        }
        out.push(c);
        setProgress({ done: out.length, total: addressList.length });
      }
      setProgress(null);
      // Show the cleaned-up list if the driver goes back to edit it.
      update({ checks: out, step: "review", form: { ...form, addresses: addressList.join("\n") } });
      // Measure the start now, so the driver can check it on the map before planning.
      if (form.startKind === "gps") findMe().catch(() => {});
    });
  };

  const setChecks = (list: Check[]) => update({ checks: list, form: { ...form, addresses: list.map((c) => c.address).join("\n") } });

  const researchAddress = (index: number, address: string) => {
    const q = address.trim();
    if (!q) return;
    setError(null);
    startTransition(async () => {
      const res = await locateAddress(q);
      if (!res.ok) return setError(res.error);
      setChecks(checks.map((c, i) => (i === index ? { address: q, ...res.data! } : c)));
      setEditing(null);
    });
  };

  const placePin = (index: number) => {
    const located = checks.filter((c) => c.lat !== null && c.lng !== null);
    const at = located.length
      ? { lat: located.reduce((a, c) => a + c.lat!, 0) / located.length, lng: located.reduce((a, c) => a + c.lng!, 0) / located.length }
      : BRISBANE;
    setChecks(checks.map((c, i) => (i === index ? { ...c, ...at, status: "manual", label: "Pin placed by hand" } : c)));
  };

  // ---------------------------------------------------------------- planning

  const run = (build: () => Promise<QuickRouteRequest>, after: Partial<Saved>) => {
    setError(null);
    setLocationFailed(false);
    startTransition(async () => {
      try {
        const res = await planQuickRoute(await build());
        if (!res.ok) return setError(res.error);
        const now = Date.now();
        setNowMs(now);
        update({ result: res.data!, plannedAtMs: now, leftAtMs: null, ...after });
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err) {
        setError((err as Error).message);
        setLocationFailed(err instanceof LocationError);
      }
    });
  };

  const optimise = (startKind: StartKind = form.startKind) =>
    run(
      async () => ({
        start:
          startKind === "gps"
            ? { kind: "gps", ...(await startPosition()) }
            : startKind === "depot"
              ? { kind: "depot" }
              : { kind: "address", address: form.startAddress },
        stops: checks.map((c) => ({ address: c.address, lat: c.lat ?? undefined, lng: c.lng ?? undefined })),
        end: form.end,
        serviceMin: form.serviceMin,
      }),
      { driving: false, next: 0, done: [] },
    );

  // Re-plan what's left from where the driver is now, keeping the original finish point.
  const replanRemaining = () =>
    run(
      async () => ({
        start: { kind: "gps", ...(await locateBest({ maxWaitMs: 10_000 }).then((f) => ({ lat: f.lat, lng: f.lng }))) },
        stops: result!.stops.slice(next).map((s) => ({ address: s.address, lat: s.lat, lng: s.lng })),
        end: form.end,
        returnTo: form.end === "start" ? result!.start : undefined,
        serviceMin: form.serviceMin,
      }),
      { next: 0 },
    );

  const finishStop = (status: Done["status"]) => {
    if (!result) return;
    const now = Date.now();
    setNowMs(now);
    update({ next: next + 1, leftAtMs: now, done: [...done, { address: result.stops[next].address, status }] });
    setToast({ id: now, tone: status === "delivered" ? "ok" : "warn", text: `${status === "delivered" ? "Delivered" : "Not delivered"} · ${result.stops[next].address}` });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reset = () => update({ result: null, step: "review", driving: false, next: 0, done: [] });
  const startOver = () => update({ result: null, step: "enter", checks: [], form: { ...form, addresses: "" }, driving: false, next: 0, done: [] });

  const header = (
    <header className="bg-navy-900 px-4 pb-16 pt-5 text-white">
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <Link href={backHref} className="grid size-9 place-items-center rounded-full bg-white/10 text-slate-300" aria-label="Back">
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Quick route</h1>
          <p className="text-xs text-slate-400">Enter your drops, get the fastest order, then drive it stop by stop.</p>
        </div>
      </div>
    </header>
  );

  // ---------------------------------------------------------------- step 1: enter addresses
  if (!result && step === "enter") {
    return (
      <div className="min-h-dvh pb-10">
        {header}
        <main key="enter" className="mx-auto -mt-12 max-w-lg animate-rise space-y-4 px-4">
          <section className="space-y-4 rounded-2xl bg-white p-4 shadow-card">
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Start from</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ["gps", "My location", LocateFixed],
                    ["depot", "Depot", Warehouse],
                    ["address", "An address", MapPin],
                  ] as const
                )
                  .filter(([k]) => k !== "depot" || depotName)
                  .map(([k, label, Icon]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setForm({ startKind: k })}
                      className={cx(
                        "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-medium",
                        form.startKind === k ? "border-blue-500 bg-blue-50 text-blue-700" : "border-line text-slate-600",
                      )}
                    >
                      <Icon className="size-4" />
                      {label}
                    </button>
                  ))}
              </div>
              {form.startKind === "depot" && <p className="mt-1.5 text-xs text-slate-500">{depotName}</p>}
              {form.startKind === "address" && (
                <input
                  className={cx(inputCls, "mt-2 h-11 text-base")}
                  placeholder="e.g. 100 Queen St, Brisbane City"
                  value={form.startAddress}
                  onChange={(e) => setForm({ startAddress: e.target.value })}
                />
              )}
            </div>

            <Field
              label={`Delivery addresses (${addressList.length})`}
              hint={
                duplicates
                  ? `One per line. ${duplicates} repeated ${duplicates === 1 ? "address" : "addresses"} will only be visited once.`
                  : "One per line, or paste a list or spreadsheet column. Include the suburb for the best match."
              }
            >
              <textarea
                className={cx(inputCls, "h-auto min-h-40 py-2 text-base leading-relaxed")}
                placeholder={"12 Mains Rd, Sunnybank\n2 Clunies Ross Ct, Eight Mile Plains\nLogan Central Plaza, Logan Central\n…"}
                value={form.addresses}
                onChange={(e) => setForm({ addresses: e.target.value })}
              />
            </Field>

            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">After the last delivery</p>
              <div className="space-y-1.5">
                {END_OPTIONS.filter((o) => !o.needsDepot || depotName).map((o) => (
                  <label key={o.value} className="flex items-center gap-2.5 text-sm text-slate-700">
                    <input type="radio" name="end" checked={form.end === o.value} onChange={() => setForm({ end: o.value })} className="size-4 accent-blue-600" />
                    {o.label}
                    {o.value === "depot" && <span className="text-xs text-slate-400">({depotName})</span>}
                  </label>
                ))}
              </div>
            </div>

            <Field label="Minutes spent at each stop" hint="Parking, walking to the door and handing over.">
              <input
                type="number"
                min={0}
                max={120}
                className={cx(inputCls, "w-24")}
                value={form.serviceMin}
                onChange={(e) => setForm({ serviceMin: Number(e.target.value) })}
              />
            </Field>

            <FormError message={error} />
            <button className={btn("primary", "lg", "w-full rounded-xl")} disabled={pending || !addressList.length} onClick={checkAddresses}>
              {progress ? <Spinner className="size-5" /> : <Search className="size-5" />}
              {progress ? `Finding address ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : "Check addresses"}
            </button>
            {progress && (
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-blue-600 transition-[width] duration-500 ease-out" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            )}
          </section>
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------- step 2: confirm pins
  if (!result) {
    const failed = checks.filter((c) => c.lat === null).length;
    const approx = checks.filter((c) => c.status === "approximate").length;
    const pins: MapStop[] = checks.flatMap((c, i) =>
      c.lat !== null && c.lng !== null
        ? [{ id: String(i), routeId: null, lat: c.lat, lng: c.lng, label: String(i + 1), color: PIN_COLOR[c.status], status: "pending" as const, title: `${i + 1}. ${c.address}`, lines: [c.label ?? ""] }]
        : [],
    );
    // The measured start, draggable like the stops so a rough fix can be corrected by hand.
    if (form.startKind === "gps" && here) {
      pins.unshift({
        id: START_PIN,
        routeId: null,
        lat: here.lat,
        lng: here.lng,
        label: "S",
        color: "#0d1b30",
        status: "pending",
        title: "Your start",
        lines: [here.manual ? "Placed by hand" : `GPS ${describeAccuracy(here.accuracy)}`],
      });
    }
    return (
      <div className="min-h-dvh pb-10">
        {header}
        <main key="review" className="mx-auto -mt-12 max-w-lg animate-rise space-y-4 px-4">
          <section className="rounded-2xl bg-white p-4 shadow-card">
            <h2 className="font-semibold text-slate-900">Check the pins</h2>
            <p className="mt-1 text-sm text-slate-500">
              A wrong pin means a wrong route. Drag any pin that isn&apos;t on the right building.
              {approx > 0 && <span className="text-amber-700"> {approx} {approx === 1 ? "address is" : "addresses are"} only approximate (amber).</span>}
            </p>
          </section>

          {form.startKind === "gps" && <StartCard here={here} locating={locating} onRefresh={() => findMe().catch(() => {})} onChange={() => update({ step: "enter" })} />}
          <div className="h-80 overflow-hidden rounded-2xl shadow-card">
            <DeliveryMap
              stops={pins}
              routes={[]}
              onMoveStop={(id, lat, lng) => {
                if (id === START_PIN) {
                  setHere({ lat, lng, accuracy: 0, at: Date.now(), manual: true, label: null });
                  describeLocation(lat, lng).then((res) => res.ok && res.data && setHere((h) => (h?.manual && h.lat === lat ? { ...h, label: res.data! } : h)));
                  return;
                }
                setChecks(checks.map((c, i) => (String(i) === id ? { ...c, lat, lng, status: "manual", label: "Pin moved by hand" } : c)));
              }}
            />
          </div>

          <section className="overflow-hidden rounded-2xl bg-white shadow-card">
            <ol className="divide-y divide-line text-sm">
              {checks.map((c, i) => (
                <li key={i} className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: PIN_COLOR[c.status] }}>
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-900">{c.address}</span>
                      <span
                        className={cx(
                          "block truncate text-xs",
                          c.status === "failed" ? "text-red-600" : c.status === "approximate" ? "text-amber-700" : c.status === "manual" ? "text-emerald-700" : "text-slate-500",
                        )}
                      >
                        {c.status === "failed" ? "Not found" : c.status === "approximate" ? `Approximate: ${c.label}` : c.label}
                      </span>
                    </span>
                    <button className={btn("ghost", "icon")} onClick={() => setEditing({ index: i, text: c.address })} aria-label={`Edit ${c.address}`}>
                      <Pencil className="size-4" />
                    </button>
                    <button
                      className={btn("ghost", "icon", "text-red-600")}
                      onClick={() => setChecks(checks.filter((_, k) => k !== i))}
                      aria-label={`Remove ${c.address}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  {editing?.index === i && (
                    <form
                      className="mt-2 flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        researchAddress(i, editing.text);
                      }}
                    >
                      <input autoFocus className={cx(inputCls, "h-10 flex-1 text-base")} value={editing.text} onChange={(e) => setEditing({ index: i, text: e.target.value })} />
                      <button className={btn("primary", "md", "h-10")} disabled={pending}>
                        Search
                      </button>
                    </form>
                  )}
                  {c.status === "failed" && editing?.index !== i && (
                    <button className={btn("secondary", "sm", "mt-2")} onClick={() => placePin(i)}>
                      <MapPinned className="size-3.5" /> Place a pin on the map instead
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <p className={cx("flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm shadow-card", form.startKind === "gps" && "hidden")}>
            <span className="text-slate-500">
              Starting from{" "}
              <span className="font-medium text-slate-900">
                {form.startKind === "gps" ? "my location" : form.startKind === "depot" ? depotName : form.startAddress || "an address"}
              </span>
            </span>
            <button className="text-xs font-medium text-blue-600" onClick={() => update({ step: "enter" })}>
              Change
            </button>
          </p>

          <FormError message={error} />
          {locationFailed && (
            <div className="grid grid-cols-2 gap-2">
              {depotName && (
                <button
                  className={btn("secondary", "md", "rounded-xl")}
                  disabled={pending}
                  onClick={() => {
                    setForm({ startKind: "depot" });
                    optimise("depot");
                  }}
                >
                  <Warehouse className="size-4" /> Start from depot
                </button>
              )}
              <button
                className={btn("secondary", "md", cx("rounded-xl", !depotName && "col-span-2"))}
                onClick={() => {
                  setLocationFailed(false);
                  setError(null);
                  update({ step: "enter", form: { ...form, startKind: "address" } });
                }}
              >
                <MapPin className="size-4" /> Type a start address
              </button>
            </div>
          )}
          {failed > 0 && (
            <p className="text-center text-sm text-red-600">
              Fix, pin or remove the {failed} {failed === 1 ? "address" : "addresses"} not found to continue.
            </p>
          )}
          <button className={btn("primary", "lg", "w-full rounded-xl")} disabled={pending || !!locating || failed > 0 || !checks.length} onClick={() => optimise()}>
            {pending || locating ? <Spinner className="size-5" /> : <Zap className="size-5" />} {pending ? "Calculating…" : locating ? "Finding your location…" : "Find the fastest route"}
          </button>
          <button className={btn("secondary", "md", "w-full rounded-xl")} onClick={() => update({ step: "enter" })}>
            Back to the address list
          </button>
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------- step 3: plan / drive
  const remaining = result.stops.slice(next);
  const current = remaining[0];
  // Stops completed under an earlier plan (before a re-plan), so numbering carries on across re-plans.
  const offset = done.length - next;
  const total = offset + result.stops.length;
  const saved = result.entered.driveS - result.driveS;
  const goingHome = driving && !current && result.end;

  // Real time on the plan's clock (seconds after local midnight), then ETAs re-timed from what actually happened.
  const toPlanS = (ms: number) => result.startS + Math.round((ms - plannedAtMs) / 1000);
  const leftS = toPlanS(leftAtMs ?? plannedAtMs);
  const projected = driving ? projectRemaining(remaining, leftS, toPlanS(nowMs)) : remaining;
  const lastDeparture = projected.length ? projected[projected.length - 1].departureS : leftS;
  const finishS = driving ? lastDeparture + (result.returnLeg?.durationS ?? 0) : result.finishS;
  const lateBy = (k: number) => projected[k].arrivalS - remaining[k].arrivalS;

  const mapStops: MapStop[] = result.stops.map((s, i) => ({
    id: String(i),
    routeId: "quick",
    lat: s.lat,
    lng: s.lng,
    label: String(offset + i + 1),
    color: COLOR,
    status: i < next ? done[offset + i].status : "pending",
    title: `${offset + i + 1}. ${s.address}`,
    lines: [`${formatDuration(s.legDurationS)} drive · ETA ${formatClock(i < next ? s.arrivalS : projected[i - next].arrivalS)}`],
    navigateUrl: navigationUrls(s.lat, s.lng).google,
  }));
  const map = (
    <div className="h-72 overflow-hidden rounded-2xl shadow-card">
      <DeliveryMap
        stops={mapStops}
        routes={[{ id: "quick", color: COLOR, path: result.path }]}
        vehicles={[{ id: "start", lat: result.start.lat, lng: result.start.lng, color: "#0d1b30", initials: "S", stale: false, heading: null, title: "Start", lines: [result.start.label] }]}
        depots={result.end && form.end === "depot" ? [{ id: "end", ...result.end, name: result.end.label }] : []}
        highlightStopId={current ? String(next) : null}
      />
    </div>
  );
  const multiNav = multiStopNavigation([...remaining, ...(result.end ? [result.end] : [])]);

  return (
    <div className="min-h-dvh pb-10">
      {header}
      <main key="route" className="mx-auto -mt-12 max-w-lg animate-rise space-y-4 px-4">
        {/* Summary */}
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <div className="grid grid-cols-3 text-center">
            {[
              ["Stops", result.stops.length],
              ["Driving", formatDuration(result.driveS)],
              ["Distance", formatKm(result.distanceM)],
            ].map(([l, v]) => (
              <div key={l}>
                <p className="text-xl font-semibold tabular-nums text-slate-900">{v}</p>
                <p className="text-xs text-slate-500">{l}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm">
            <span className="text-slate-500">{driving ? "Expected to finish" : "All done by"}</span>
            <span className="font-semibold text-slate-900">
              {formatClock(finishS)}
              {finishS - result.finishS >= LATE_S && (
                <span className="ml-1.5 text-xs font-normal text-amber-600">{formatDuration(finishS - result.finishS)} behind plan</span>
              )}
            </span>
          </p>
          {saved >= 60 && (
            <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {formatDuration(saved)} less driving than going in the order you typed ({formatDuration(result.entered.driveS)}).
            </p>
          )}
          <p className="mt-2 text-[11px] leading-snug text-slate-400">
            {result.exact ? "Every possible order was compared." : "Optimised order (best found)."} Drive times{" "}
            {result.matrixSource === "osrm" ? "from road data" : "are straight-line estimates (road data unavailable)"}, plus a{" "}
            {Math.round((result.trafficFactor - 1) * 100)}% traffic buffer. Planned at {formatClock(result.startS)}.
          </p>
        </section>

        {result.notFound.length > 0 && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="flex items-center gap-2 font-semibold">
              <TriangleAlert className="size-4" /> Not found, so left out of the route
            </p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {result.notFound.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>
        )}

        <FormError message={error} />

        {!driving ? (
          <>
            {map}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button
                className={btn("primary", "lg", "rounded-xl")}
                onClick={() => {
                  // The clock starts when the driver actually sets off, not when the route was calculated.
                  const now = Date.now();
                  setNowMs(now);
                  update({ driving: true, leftAtMs: now });
                }}
              >
                <Navigation className="size-5" /> Start navigation
              </button>
              <button className={btn("secondary", "lg", "rounded-xl px-4")} onClick={reset} aria-label="Edit addresses">
                <RotateCcw className="size-5" />
              </button>
            </div>
          </>
        ) : current ? (
          // Keyed by stop so the next drop visibly slides in after one is finished.
          <section key={next} className="animate-rise overflow-hidden rounded-2xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                Stop {offset + next + 1} of {total}
              </p>
              <span className="text-xs text-slate-500">
                {formatDuration(current.legDurationS)} · {formatKm(current.legDistanceM)}
              </span>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{current.address}</h2>
                {current.label !== current.address && <p className="mt-0.5 text-xs text-slate-500">{current.label}</p>}
                {current.approximate && <p className="mt-1 text-xs text-amber-700">Approximate location: check the address on arrival.</p>}
              </div>
              <p className="text-sm text-slate-600">
                Arrive around <span className="font-semibold text-slate-900">{formatClock(projected[0].arrivalS)}</span>
                {lateBy(0) >= LATE_S && <span className="ml-1.5 text-xs text-amber-600">(planned {formatClock(current.arrivalS)})</span>}
              </p>
              <a href={navigationUrls(current.lat, current.lng).google} target="_blank" rel="noreferrer" className={btn("primary", "lg", "w-full rounded-xl")}>
                <Navigation className="size-5" /> Navigate (Google Maps)
              </a>
              <a href={navigationUrls(current.lat, current.lng).apple} target="_blank" rel="noreferrer" className="block text-center text-xs text-slate-500 underline">
                Open in Apple Maps instead
              </a>
              <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
                <button className={btn("success", "lg", "rounded-xl")} onClick={() => finishStop("delivered")}>
                  <CheckCircle2 className="size-5" /> Delivered
                </button>
                <button className={btn("danger", "lg", "rounded-xl")} onClick={() => finishStop("failed")}>
                  <TriangleAlert className="size-5" /> Couldn&apos;t deliver
                </button>
              </div>
            </div>
          </section>
        ) : goingHome ? (
          <section className="animate-rise space-y-3 rounded-2xl bg-white p-4 shadow-card">
            <p className="flex items-center gap-2 font-semibold text-slate-900">
              <Flag className="size-4 text-emerald-600" /> All stops done. Head back to {result.end!.label}
            </p>
            <p className="text-sm text-slate-500">
              About {formatDuration(result.returnLeg?.durationS)} · {formatKm(result.returnLeg?.distanceM)}
            </p>
            <a href={navigationUrls(result.end!.lat, result.end!.lng).google} target="_blank" rel="noreferrer" className={btn("primary", "lg", "w-full rounded-xl")}>
              <Navigation className="size-5" /> Navigate back
            </a>
            <button className={btn("secondary", "md", "w-full rounded-xl")} onClick={startOver}>
              Finish and plan a new route
            </button>
          </section>
        ) : (
          <section className="rounded-2xl bg-white p-8 text-center shadow-card">
            <CheckCircle2 className="mx-auto size-12 animate-check text-emerald-500" />
            <p className="mt-3 text-lg font-semibold">All stops completed</p>
            <button className={btn("secondary", "md", "mt-4 rounded-xl")} onClick={startOver}>
              Plan a new route
            </button>
          </section>
        )}

        {driving && current && (
          <>
            {remaining.length > 1 && multiNav && (
              <a href={multiNav.url} target="_blank" rel="noreferrer" className={btn("secondary", "md", "w-full rounded-xl")}>
                <Route className="size-4" /> Google Maps: next {multiNav.count} stops in this order
              </a>
            )}
            <button className={btn("secondary", "md", "w-full rounded-xl")} disabled={pending} onClick={replanRemaining}>
              {pending ? <Spinner /> : <LocateFixed className="size-4" />} {pending ? "Re-planning…" : `Re-plan the ${remaining.length} remaining from my location`}
            </button>
            <button className={btn("secondary", "md", "w-full rounded-xl")} onClick={() => setShowMap(!showMap)}>
              {showMap ? "Hide route map" : "Show route map"}
            </button>
            {showMap && map}
          </>
        )}

        {/* Stop list with per-leg times */}
        <section className="overflow-hidden rounded-2xl bg-white shadow-card">
          <h3 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-slate-900">Route order</h3>
          <ol className="divide-y divide-line text-sm">
            <li className="flex items-center gap-3 px-4 py-2.5 text-slate-500">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-navy-900 text-xs font-bold text-white">S</span>
              <span className="min-w-0 flex-1 truncate">{result.start.label}</span>
              <span className="tabular-nums">{formatClock(result.startS)}</span>
            </li>
            {done.map((d, i) => (
              <li key={`done-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-slate-400">
                <span className={cx("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white", d.status === "delivered" ? "bg-emerald-500" : "bg-red-500")}>
                  {d.status === "delivered" ? "✓" : "!"}
                </span>
                <span className="min-w-0 flex-1 truncate">{d.address}</span>
                <span className="text-xs">{d.status === "delivered" ? "Delivered" : "Not delivered"}</span>
              </li>
            ))}
            {remaining.map((s, k) => {
              const i = next + k;
              const late = lateBy(k);
              return (
                <li key={i} className={cx("flex items-center gap-3 px-4 py-2.5", driving && k === 0 && "bg-blue-50")}>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: COLOR }}>
                    {offset + i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{s.address}</span>
                    <span className="block text-xs text-slate-500">
                      +{formatDuration(s.legDurationS)} drive · {formatKm(s.legDistanceM)}
                      {s.approximate && <span className="text-amber-700"> · approx. location</span>}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold tabular-nums text-slate-900">{formatClock(projected[k].arrivalS)}</span>
                    <span className={cx("block text-[11px]", late >= LATE_S ? "text-amber-600" : "text-slate-400")}>
                      {late >= LATE_S ? `+${formatDuration(late)} late` : `${formatDuration(projected[k].arrivalS - result.startS)} in`}
                    </span>
                  </span>
                </li>
              );
            })}
            {result.end && result.returnLeg && (
              <li className="flex items-center gap-3 px-4 py-2.5 text-slate-500">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-navy-900 text-white">
                  <Flag className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{result.end.label}</span>
                  <span className="block text-xs">
                    +{formatDuration(result.returnLeg.durationS)} drive · {formatKm(result.returnLeg.distanceM)}
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-slate-900">{formatClock(finishS)}</span>
              </li>
            )}
          </ol>
        </section>

        {driving && (
          <button className="block w-full text-center text-xs text-slate-500 underline" onClick={reset}>
            Cancel this route and start over
          </button>
        )}
      </main>
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}

const START_PIN = "__start";

/** Where the route will start: live accuracy while measuring, then the nearest street and how much to trust it. */
function StartCard({
  here,
  locating,
  onRefresh,
  onChange,
}: {
  here: Here | null;
  locating: { accuracy: number | null } | null;
  onRefresh: () => void;
  onChange: () => void;
}) {
  const quality = !here ? null : here.manual || here.accuracy <= GOOD_FIX_M ? "good" : here.accuracy <= ROUGH_FIX_M ? "fair" : "rough";
  return (
    <section
      className={cx(
        "rounded-2xl bg-white p-4 shadow-card ring-1",
        quality === "rough" ? "ring-red-200" : quality === "fair" ? "ring-amber-200" : quality === "good" ? "ring-emerald-200" : "ring-transparent",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cx(
            "relative grid size-9 shrink-0 place-items-center rounded-full",
            locating ? "bg-blue-50 text-blue-600" : quality === "good" ? "bg-emerald-50 text-emerald-600" : quality === "fair" ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600",
          )}
        >
          <LocateFixed className="size-4" />
          {locating && <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/30" />}
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-slate-900">Your start</p>
          {locating ? (
            <p className="text-slate-500">
              Finding your exact location…{locating.accuracy !== null && <span className="tabular-nums"> {describeAccuracy(locating.accuracy)} so far</span>}
            </p>
          ) : here ? (
            <>
              <p className="truncate text-slate-700">{here.label ? `Near ${here.label}` : `${here.lat.toFixed(5)}, ${here.lng.toFixed(5)}`}</p>
              <p className={cx("text-xs", quality === "good" ? "text-emerald-700" : quality === "fair" ? "text-amber-700" : "text-red-700")}>
                {here.manual
                  ? "Placed by hand on the map"
                  : quality === "good"
                    ? `Precise GPS fix (${describeAccuracy(here.accuracy)})`
                    : quality === "fair"
                      ? `GPS ${describeAccuracy(here.accuracy)}. Check the dark S pin is where you are.`
                      : `Only accurate to ${describeAccuracy(here.accuracy)} (no GPS lock). Drag the dark S pin to where you are, or type your start address.`}
              </p>
            </>
          ) : (
            <p className="text-slate-500">Not measured yet.</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button className={btn("secondary", "sm")} disabled={!!locating} onClick={onRefresh}>
          {locating ? <Spinner className="size-3" /> : <LocateFixed className="size-3.5" />} {here ? "Measure again" : "Find my location"}
        </button>
        <button className={btn("ghost", "sm")} onClick={onChange}>
          Use another start
        </button>
      </div>
    </section>
  );
}
