"use client";

import { AdvancedMarker, APIProvider, InfoWindow, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useState } from "react";
import type { MapProps } from "./types";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
// Advanced markers need a Map ID; DEMO_MAP_ID works for development. Create your own in Google Cloud for production styling.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ?? "DEMO_MAP_ID";

type Selected = { lat: number; lng: number; title: string; lines: string[]; navigateUrl?: string } | null;

function FitBounds({ points, fitKey }: { points: google.maps.LatLngLiteral[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(13);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 48);
    // Refit only when the set of things shown changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

function Pin({ label, color, status, highlighted }: { label: string; color: string; status: string; highlighted: boolean }) {
  const size = highlighted ? 30 : 24;
  const bg = status === "delivered" ? "#10b981" : status === "failed" ? "#ef4444" : status === "unrouted" ? "#94a3b8" : color;
  return (
    <div
      className="stop-pin"
      style={{ width: size, height: size, background: bg, outline: highlighted ? "3px solid rgba(37,99,235,.35)" : undefined }}
    >
      {status === "delivered" ? "✓" : status === "failed" ? "!" : label}
    </div>
  );
}

export default function GoogleMapInner({
  depots = [],
  stops,
  routes,
  trails = [],
  vehicles = [],
  focusRouteId,
  highlightStopId,
  onSelectStop,
  className,
  fitOnce,
}: MapProps) {
  const [selected, setSelected] = useState<Selected>(null);
  const focusStops = focusRouteId ? stops.filter((s) => s.routeId === focusRouteId) : stops;
  const fitPoints = useMemo(
    () => [
      ...depots.map((d) => ({ lat: d.lat, lng: d.lng })),
      ...focusStops.map((s) => ({ lat: s.lat, lng: s.lng })),
      ...vehicles.map((v) => ({ lat: v.lat, lng: v.lng })),
    ],
    [depots, focusStops, vehicles],
  );
  const fitKey = fitOnce ? "once" : `${focusRouteId ?? "all"}|${focusStops.map((s) => s.id).join(",")}`;
  const center = depots[0] ? { lat: depots[0].lat, lng: depots[0].lng } : (fitPoints[0] ?? { lat: -27.47, lng: 153.02 });

  return (
    <APIProvider apiKey={API_KEY} language="en" region="AU">
      <Map
        className={className}
        style={{ width: "100%", height: "100%" }}
        mapId={MAP_ID}
        defaultCenter={center}
        defaultZoom={11}
        gestureHandling="greedy"
        mapTypeControl
        streetViewControl
        fullscreenControl
        clickableIcons={false}
        onClick={() => setSelected(null)}
      >
        <FitBounds points={fitPoints} fitKey={fitKey} />

        {trails.map((t) => (
          <Polyline
            key={`trail-${t.id}`}
            path={t.path.map(([lat, lng]) => ({ lat, lng }))}
            strokeOpacity={0}
            icons={[{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeColor: t.color, scale: 2.5 }, offset: "0", repeat: "10px" }]}
          />
        ))}
        {routes.map((r) => {
          const dim = focusRouteId && focusRouteId !== r.id;
          return (
            <Polyline
              key={r.id}
              path={r.path.map(([lat, lng]) => ({ lat, lng }))}
              strokeColor={r.color}
              strokeWeight={dim ? 3 : 5}
              strokeOpacity={dim ? 0.2 : 0.85}
            />
          );
        })}

        {depots.map((d) => (
          <AdvancedMarker
            key={d.id}
            position={{ lat: d.lat, lng: d.lng }}
            zIndex={1000}
            title={d.name}
            onClick={() => setSelected({ lat: d.lat, lng: d.lng, title: d.name, lines: ["Depot"] })}
          >
            <div className="grid size-[34px] place-items-center rounded-[10px] border-2 border-white bg-navy-900 text-white shadow-[0_2px_6px_rgba(0,0,0,.4)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 21V8l9-5 9 5v13" />
                <path d="M7 21v-8h10v8" />
              </svg>
            </div>
          </AdvancedMarker>
        ))}

        {stops.map((s) => {
          const dim = focusRouteId && s.routeId !== focusRouteId;
          return (
            <AdvancedMarker
              key={s.id}
              position={{ lat: s.lat, lng: s.lng }}
              zIndex={s.id === highlightStopId ? 900 : 1}
              title={s.title}
              onClick={() => {
                setSelected({ lat: s.lat, lng: s.lng, title: s.title, lines: s.lines, navigateUrl: s.navigateUrl });
                onSelectStop?.(s.id);
              }}
            >
              <div style={{ opacity: dim ? 0.35 : 1 }}>
                <Pin label={s.label} color={s.color} status={s.status} highlighted={s.id === highlightStopId} />
              </div>
            </AdvancedMarker>
          );
        })}

        {vehicles.map((v) => (
          <AdvancedMarker
            key={`veh-${v.id}`}
            position={{ lat: v.lat, lng: v.lng }}
            zIndex={2000}
            title={v.title}
            onClick={() => setSelected({ lat: v.lat, lng: v.lng, title: v.title, lines: v.lines })}
          >
            <div className="relative size-[34px]">
              {v.heading !== null && !v.stale && (
                <div className="absolute -inset-[9px]" style={{ transform: `rotate(${v.heading}deg)` }}>
                  <div
                    className="mx-auto h-0 w-0"
                    style={{ borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderBottom: `9px solid ${v.color}` }}
                  />
                </div>
              )}
              <div
                className="grid size-[34px] place-items-center rounded-full border-[3px] border-white text-[11px] font-bold text-white"
                style={{
                  background: v.stale ? "#94a3b8" : v.color,
                  boxShadow: `0 0 0 4px ${v.stale ? "rgba(148,163,184,.3)" : `${v.color}40`}, 0 2px 6px rgba(0,0,0,.35)`,
                }}
              >
                {v.initials}
              </div>
            </div>
          </AdvancedMarker>
        ))}

        {selected && (
          <InfoWindow position={{ lat: selected.lat, lng: selected.lng }} pixelOffset={[0, -16]} onCloseClick={() => setSelected(null)} headerDisabled>
            <div className="space-y-0.5 text-[13px] leading-snug">
              <p className="font-semibold text-slate-900">{selected.title}</p>
              {selected.lines.map((l, i) => (
                <p key={i} className="text-slate-600">
                  {l}
                </p>
              ))}
              {selected.navigateUrl && (
                <a href={selected.navigateUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block font-medium text-blue-600">
                  Navigate in Google Maps →
                </a>
              )}
            </div>
          </InfoWindow>
        )}
      </Map>
    </APIProvider>
  );
}
