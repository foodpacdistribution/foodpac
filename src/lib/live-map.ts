import type { MapVehicle } from "@/components/map";
import type { RouteView } from "./planning";
import type { LiveVehicle } from "./tracking";

export const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function formatAgo(s: number | null) {
  if (s === null) return "never";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m ago`;
}

/** A darker shade of a route colour (#rrggbb), for the GPS trail drawn over that route. */
export function darken(hex: string, by = 0.4) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#0f172a";
  const n = parseInt(m[1], 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - by)).toString(16).padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** Map markers for drivers that have reported at least one position. */
export function vehicleMarkers(routes: RouteView[], live: LiveVehicle[]): MapVehicle[] {
  return live.flatMap((v) => {
    const r = routes.find((x) => x.id === v.routeId);
    if (!r || !v.last) return [];
    const done = r.stops.filter((s) => s.status !== "pending").length;
    return [
      {
        id: v.routeId,
        lat: v.last.lat,
        lng: v.last.lng,
        color: r.color,
        initials: initials(r.driverName),
        stale: v.stale,
        heading: v.last.heading,
        accuracyM: v.last.accuracyM,
        ageLabel: formatAgo(v.ageS),
        title: r.driverName,
        lines: [
          `Stop ${Math.min(done + 1, r.stops.length)} of ${r.stops.length}${r.status === "completed" ? " · finished" : ""}`,
          `Updated ${formatAgo(v.ageS)}${v.last.speedKmh !== null ? ` · ${v.last.speedKmh} km/h` : ""}`,
        ],
      },
    ];
  });
}
