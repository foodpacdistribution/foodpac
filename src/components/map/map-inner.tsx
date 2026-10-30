"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import type { MapProps } from "./types";

const TILE_URL = process.env.NEXT_PUBLIC_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_TILE_ATTRIBUTION ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function pinIcon(label: string, color: string, status: string, highlighted: boolean) {
  const size = highlighted ? 30 : 24;
  const bg = status === "delivered" ? "#10b981" : status === "failed" ? "#ef4444" : status === "unrouted" ? "#94a3b8" : color;
  const text = status === "delivered" ? "✓" : status === "failed" ? "!" : label;
  return L.divIcon({
    className: "",
    html: `<div class="stop-pin" style="width:${size}px;height:${size}px;background:${bg};${highlighted ? "outline:3px solid rgba(37,99,235,.35);" : ""}">${text}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

const depotIcon = L.divIcon({
  className: "",
  html: `<div style="width:34px;height:34px;border-radius:10px;background:#0d1b30;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);display:grid;place-items:center;color:white">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-8h10v8"/></svg></div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

function vehicleIcon(v: { color: string; initials: string; stale: boolean; heading: number | null }) {
  const arrow =
    v.heading !== null && !v.stale
      ? `<div style="position:absolute;inset:-9px;transform:rotate(${v.heading}deg)"><div style="margin:0 auto;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:9px solid ${v.color}"></div></div>`
      : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:34px;height:34px">${arrow}<div style="width:34px;height:34px;border-radius:9999px;background:${v.stale ? "#94a3b8" : v.color};border:3px solid white;box-shadow:0 0 0 4px ${v.stale ? "rgba(148,163,184,.3)" : v.color + "40"},0 2px 6px rgba(0,0,0,.35);display:grid;place-items:center;color:white;font-weight:700;font-size:11px">${v.initials}</div></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
}

function FitBounds({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 13);
    else map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 15 });
    // Refit only when the set of things shown changes, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export default function MapInner({
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
  const focusStops = focusRouteId ? stops.filter((s) => s.routeId === focusRouteId) : stops;
  const fitPoints = useMemo<[number, number][]>(
    () => [
      ...depots.map((d) => [d.lat, d.lng] as [number, number]),
      ...focusStops.map((s) => [s.lat, s.lng] as [number, number]),
      ...vehicles.map((v) => [v.lat, v.lng] as [number, number]),
    ],
    [depots, focusStops, vehicles],
  );
  const fitKey = fitOnce ? "once" : `${focusRouteId ?? "all"}|${focusStops.map((s) => s.id).join(",")}`;
  const center: [number, number] = depots[0] ? [depots[0].lat, depots[0].lng] : (fitPoints[0] ?? [-27.47, 153.02]);

  return (
    <MapContainer center={center} zoom={11} scrollWheelZoom className={className} style={{ height: "100%", width: "100%" }}>
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
      <FitBounds points={fitPoints} fitKey={fitKey} />
      <InvalidateOnResize />
      {trails.map((t) => (
        <Polyline key={`trail-${t.id}`} positions={t.path} pathOptions={{ color: t.color, weight: 3, opacity: 0.9, dashArray: "2 7", lineCap: "round" }} />
      ))}
      {routes.map((r) => {
        const dim = focusRouteId && focusRouteId !== r.id;
        return (
          <Polyline
            key={r.id}
            positions={r.path}
            pathOptions={{ color: r.color, weight: dim ? 3 : 5, opacity: dim ? 0.2 : 0.85, lineJoin: "round" }}
          />
        );
      })}
      {depots.map((d) => (
        <Marker key={d.id} position={[d.lat, d.lng]} icon={depotIcon} zIndexOffset={1000}>
          <Popup>
            <strong>{d.name}</strong>
            <br />
            Depot
          </Popup>
        </Marker>
      ))}
      {vehicles.map((v) => (
        <Marker key={`veh-${v.id}`} position={[v.lat, v.lng]} icon={vehicleIcon(v)} zIndexOffset={2000}>
          <Popup>
            <p className="font-semibold text-slate-900">{v.title}</p>
            {v.lines.map((l, i) => (
              <p key={i} className="text-slate-600">
                {l}
              </p>
            ))}
          </Popup>
        </Marker>
      ))}
      {stops.map((s) => {
        const dim = focusRouteId && s.routeId !== focusRouteId;
        return (
          <Marker
            key={s.id}
            position={[s.lat, s.lng]}
            icon={pinIcon(s.label, s.color, s.status, s.id === highlightStopId)}
            opacity={dim ? 0.35 : 1}
            zIndexOffset={s.id === highlightStopId ? 900 : 0}
            eventHandlers={onSelectStop ? { click: () => onSelectStop(s.id) } : undefined}
          >
            <Popup>
              <div className="space-y-0.5">
                <p className="font-semibold text-slate-900">{s.title}</p>
                {s.lines.map((l, i) => (
                  <p key={i} className="text-slate-600">
                    {l}
                  </p>
                ))}
                {s.navigateUrl && (
                  <a href={s.navigateUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block font-medium text-blue-600">
                    Navigate →
                  </a>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
