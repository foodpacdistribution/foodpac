"use client";

import { AlertTriangle, MapPinned, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { locateCustomerBatch, retryFailedLocations } from "@/app/actions/customer-map";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { CustomerMap } from "@/components/map";
import { btn, Card, cx, EmptyState, inputCls, PageHeader, Spinner } from "@/components/ui";
import { type CustomerPin, STAGE_COLOR, UNKNOWN_AREA } from "@/lib/customer-map";
import type { SalesStage } from "@/lib/db/schema";
import { SALES_STAGES, STAGE_INFO } from "@/lib/sales-stage";

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
};

type Area = { key: string; name: string; total: number; byStage: Record<SalesStage, number>; pins: CustomerPin[] };

const emptyStages = (): Record<SalesStage, number> => ({ new: 0, interested: 0, negotiating: 0, won: 0 });

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

export function CustomerMapClient({ customers }: { customers: MapCustomer[] }) {
  const tr = useT();
  const [stage, setStage] = useState<SalesStage | "all">("all");
  const [withInactive, setWithInactive] = useState(false);
  const [areaKey, setAreaKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showFailed, setShowFailed] = useState(false);
  const [retrying, startRetry] = useTransition();

  const pending = customers.filter((c) => c.place === "pending").length;
  const failed = customers.filter((c) => c.place === "failed");
  const noAddress = customers.filter((c) => c.place === "none").length;
  const locating = useLocating(pending);

  // Stage counts follow the inactive switch; everything below follows both filters.
  const visible = useMemo(() => customers.filter((c) => withInactive || c.active), [customers, withInactive]);
  const stageCounts = useMemo(() => {
    const n = emptyStages();
    for (const c of visible) n[c.stage]++;
    return n;
  }, [visible]);
  const shown = useMemo(() => visible.filter((c) => stage === "all" || c.stage === stage), [visible, stage]);
  const pins = useMemo<CustomerPin[]>(
    () =>
      shown
        .filter((c) => c.place === "placed")
        .map((c) => ({
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
        })),
    [shown],
  );

  const areas = useMemo(() => {
    const byKey = new Map<string, Area>();
    const pinById = new Map(pins.map((p) => [p.id, p]));
    for (const c of shown) {
      if (c.place === "none") continue;
      let a = byKey.get(c.areaKey);
      if (!a) byKey.set(c.areaKey, (a = { key: c.areaKey, name: c.areaName, total: 0, byStage: emptyStages(), pins: [] }));
      a.total++;
      a.byStage[c.stage]++;
      const pin = pinById.get(c.id);
      if (pin) a.pins.push(pin);
    }
    // Most customers first; "unknown" always last.
    return [...byKey.values()].sort((x, y) => Number(x.key === UNKNOWN_AREA) - Number(y.key === UNKNOWN_AREA) || y.total - x.total || x.name.localeCompare(y.name));
  }, [shown, pins]);

  const picked = areaKey ? areas.find((a) => a.key === areaKey) : undefined;
  const fitPins = picked?.pins.length ? picked.pins : pins;
  // Re-frame when a filter or area changes, and once when the first pins arrive.
  const fitKey = `${stage}|${withInactive}|${picked?.key ?? ""}|${pins.length > 0}`;
  const maxArea = Math.max(1, ...areas.map((a) => a.total));
  const term = q.trim().toLowerCase();
  const listed = term ? areas.filter((a) => a.name.toLowerCase().includes(term)) : areas;

  const retry = () =>
    startRetry(async () => {
      await locating.run(retryFailedLocations);
    });

  return (
    <div>
      <PageHeader
        title="Customer Map"
        subtitle="Where your customers are. Each bubble shows how many customers are around that spot: click it or zoom in to see them one by one."
      />

      {/* Stage filter, with how many customers are at each stage. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip on={stage === "all"} onClick={() => setStage("all")} label={tr("All")} n={visible.length} />
        {SALES_STAGES.map((s) => (
          <Chip key={s} on={stage === s} onClick={() => setStage(stage === s ? "all" : s)} label={tr(STAGE_INFO[s].label)} n={stageCounts[s]} color={STAGE_COLOR[s]} />
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={withInactive} onChange={(e) => setWithInactive(e.target.checked)} className="size-4 rounded border-line" />
          {tr("Include inactive customers")}
        </label>
      </div>

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
          <EmptyState icon={MapPinned} title="No customers yet">
            Import your customers or add them, and they show up here by their address.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <Card className="relative h-[60vh] min-h-[420px] overflow-hidden lg:h-[calc(100dvh-16rem)]">
              <CustomerMap pins={pins} fitKey={fitKey} fitPins={fitPins} className="z-0 h-full w-full" />
              {pins.length === 0 && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center bg-white/60 text-sm text-slate-600">
                  {locating.running ? tr("Placing customers on the map…") : tr("No customers with an address match these filters.")}
                </div>
              )}
            </Card>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              {SALES_STAGES.map((s) => (
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

          <Card className="flex max-h-[calc(100dvh-12rem)] min-h-0 flex-col lg:h-[calc(100dvh-16rem)]">
            <div className="border-b border-line px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">{tr("Customers by area")}</h2>
                {picked && (
                  <button type="button" onClick={() => setAreaKey(null)} className="text-xs font-medium text-blue-600 hover:underline">
                    {tr("Show all areas")}
                  </button>
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
                return (
                  <li key={a.key}>
                    <button
                      type="button"
                      onClick={() => setAreaKey(on ? null : a.key)}
                      aria-pressed={on}
                      disabled={!a.pins.length}
                      className={cx(
                        "w-full rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-default",
                        on ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-50",
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cx("truncate text-sm font-medium", a.key === UNKNOWN_AREA ? "text-slate-500" : "text-slate-900")}>{tr(a.name)}</span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{a.total}</span>
                      </span>
                      {/* Bar length = customers here compared with the busiest area; colours = sales stages. */}
                      <span className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-slate-100" style={{ width: `${Math.max(6, (a.total / maxArea) * 100)}%` }}>
                        {SALES_STAGES.map((s) =>
                          a.byStage[s] ? <span key={s} style={{ width: `${(a.byStage[s] / a.total) * 100}%`, background: STAGE_COLOR[s] }} /> : null,
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
              {listed.length === 0 && <li className="px-2.5 py-6 text-center text-sm text-slate-500">{tr(areas.length ? "No area matches that search." : "No areas yet.")}</li>}
            </ol>
          </Card>
        </div>
      )}
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
