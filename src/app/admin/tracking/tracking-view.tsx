"use client";

import { AlertTriangle, Gauge, Navigation, Radio, SignalZero, Timer, X } from "lucide-react";
import { useState } from "react";
import { DeliveryMap, type MapDepot, type MapRoute, type MapStop, type MapVehicle } from "@/components/map";
import { T, Tx } from "@/components/i18n";
import { Badge, btn, Card, ColorDot, cx } from "@/components/ui";

export type TrackingRow = {
  id: string;
  driverName: string;
  color: string;
  status: "planned" | "in_progress" | "completed";
  stale: boolean;
  stop: number;
  stops: number;
  trips: number;
  ago: string;
  next: { name: string; eta: string } | null;
  toNext: string;
  speed: string;
  driven: string;
  planned: string;
  alerts: string[];
};

/** The live map and one card per driver; picking a card frames that driver's route on the map. */
export function TrackingView({
  rows,
  depots,
  stops,
  routes,
  trails,
  vehicles,
}: {
  rows: TrackingRow[];
  depots: MapDepot[];
  stops: MapStop[];
  routes: MapRoute[];
  trails: MapRoute[];
  vehicles: MapVehicle[];
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const focused = rows.find((r) => r.id === focus) ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <Card className="relative h-[480px] overflow-hidden xl:h-[calc(100dvh-10rem)] xl:min-h-[560px]">
        <DeliveryMap fitOnce depots={depots} stops={stops} routes={routes} trails={trails} vehicles={vehicles} focusRouteId={focus} />
        {focused && (
          <button type="button" onClick={() => setFocus(null)} className={cx(btn("secondary", "sm"), "absolute top-3 left-1/2 z-10 -translate-x-1/2 shadow-md")}>
            <ColorDot color={focused.color} /> {focused.driverName} <X className="size-3.5" />
            <span className="sr-only">
              <T>{"Show all drivers"}</T>
            </span>
          </button>
        )}
      </Card>

      <div className="space-y-3">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setFocus((f) => (f === r.id ? null : r.id))}
            aria-pressed={focus === r.id}
            className="block w-full text-left"
          >
            <Card className={cx("transition-shadow hover:shadow-md", r.alerts.length > 0 && "border-amber-300", focus === r.id && "ring-2 ring-blue-500/60")}>
              <div className="flex items-start gap-3 px-4 py-3">
                <ColorDot color={r.color} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">{r.driverName}</p>
                    {r.status === "completed" ? (
                      <Badge tone="green">
                        <T>{"Finished"}</T>
                      </Badge>
                    ) : r.status === "in_progress" ? (
                      r.stale ? (
                        <Badge tone="amber">
                          <SignalZero className="size-3" /> <T>{"Signal lost"}</T>
                        </Badge>
                      ) : (
                        <Badge tone="blue">
                          <Radio className="size-3" /> <T>{"Live"}</T>
                        </Badge>
                      )
                    ) : (
                      <Badge>
                        <T>{"Not started"}</T>
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    <T>{"Stop"}</T> {r.stop} <T>{"of"}</T> {r.stops}
                    {r.trips > 1 && (
                      <>
                        {" "}
                        <Tx>{`· ${r.trips} trips`}</Tx>
                      </>
                    )}{" "}
                    <T>{"· last update"}</T> <Tx>{r.ago}</Tx>
                  </p>
                  {r.next && r.status !== "planned" && (
                    <p className="mt-2 truncate text-sm text-slate-700">
                      <T>{"Next:"}</T> <span className="font-medium">{r.next.name}</span>
                      <span className="text-slate-400">
                        {" "}
                        <T>{"· ETA"}</T> {r.next.eta}
                      </span>
                    </p>
                  )}
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                      <dt className="flex items-center gap-1 text-slate-500">
                        <Navigation className="size-3" /> <T>{"To next"}</T>
                      </dt>
                      <dd className="font-semibold tabular-nums text-slate-800">{r.toNext}</dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                      <dt className="flex items-center gap-1 text-slate-500">
                        <Gauge className="size-3" /> <T>{"Speed"}</T>
                      </dt>
                      <dd className="font-semibold tabular-nums text-slate-800">{r.speed}</dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                      <dt className="flex items-center gap-1 text-slate-500">
                        <Timer className="size-3" /> <T>{"Driven"}</T>
                      </dt>
                      <dd className="font-semibold tabular-nums text-slate-800">
                        {r.driven}
                        <span className="font-normal text-slate-400"> / {r.planned}</span>
                      </dd>
                    </div>
                  </dl>
                  {r.alerts.map((a) => (
                    <p key={a} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                      <AlertTriangle className="size-3.5" /> <Tx>{a}</Tx>
                    </p>
                  ))}
                </div>
              </div>
            </Card>
          </button>
        ))}
        <p className="px-1 text-[11px] leading-relaxed text-slate-500">
          <T>
            {
              "Grey line: already driven · coloured line: still to drive · dark line: the GPS trail. Tap a driver to focus on their route. Phones stop sending location while the driver app is in the background (e.g. navigating in Google Maps) or the screen is locked; a grey marker shows the last known position and how old it is."
            }
          </T>
        </p>
      </div>
    </div>
  );
}
