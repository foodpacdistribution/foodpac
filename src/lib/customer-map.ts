// The customer map: which area a customer is in, and grouping nearby customers into one bubble
// with a count. Client-safe; the map regroups every time it is zoomed.

import type { SalesStage } from "./db/schema";

export type CustomerPin = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  code: string;
  address: string;
  phone: string | null;
  stage: SalesStage;
  active: boolean;
  /** Placed on the street or suburb rather than the exact building. */
  approximate: boolean;
  areaKey: string;
  /** Where clicking the customer goes; null = no page this user can open. */
  href: string | null;
};

/** Pin colour for each sales stage (the pipeline's dots, as hex for the map). */
export const STAGE_COLOR: Record<SalesStage, string> = {
  new: "#94a3b8",
  interested: "#3b82f6",
  negotiating: "#f59e0b",
  won: "#10b981",
};

const STATES = "QLD|NSW|VIC|SA|WA|TAS|NT|ACT";
const STATE_NAMES = "Queensland|New South Wales|Victoria|South Australia|Western Australia|Tasmania|Northern Territory|Australian Capital Territory";
// "…, Sunnybank QLD 4109" (Google's formatted address, and most typed addresses), or just
// "Sunnybank QLD 4109" when there's no street.
const SUBURB = new RegExp(`(?:^|,)\\s*([^,\\d]+?)\\s+(?:${STATES})\\.?,?\\s*(\\d{4})\\b`, "i");
// The postcode alone: after a state ("QLD 4109", OpenStreetMap's "Queensland, 4109").
const POSTCODE = new RegExp(`\\b(?:${STATES}|${STATE_NAMES})\\b\\.?,?\\s*(\\d{4})\\b`, "i");

export const UNKNOWN_AREA = "?";

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());

/**
 * The suburb and postcode a customer is in, from the geocoder's tidy address first and the
 * address as typed second. Falls back to the postcode alone, then to "unknown".
 */
export function areaOf(...addresses: (string | null | undefined)[]): { key: string; name: string } {
  const texts = addresses.filter((a): a is string => !!a?.trim());
  for (const t of texts) {
    const m = SUBURB.exec(t);
    if (m) {
      const suburb = titleCase(m[1].trim());
      return { key: `${suburb.toLowerCase()}|${m[2]}`, name: `${suburb} ${m[2]}` };
    }
  }
  for (const t of texts) {
    const m = POSTCODE.exec(t);
    if (m) return { key: m[1], name: m[1] };
  }
  return { key: UNKNOWN_AREA, name: "Unknown area" };
}

// Web Mercator, in pixels at a zoom level (256-pixel tiles, as both Google and Leaflet use).
function project(lat: number, lng: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
}

export type Cluster<P> = { key: string; lat: number; lng: number; points: P[] };

/**
 * Groups points that would sit within `radiusPx` of each other on screen at this zoom. Each
 * point joins the nearest group started within the radius, or starts its own; a group is drawn
 * at the average position of its points. Points are taken in a fixed order, so the same data at
 * the same zoom always groups the same way.
 */
export function clusterPoints<P extends { id: string; lat: number; lng: number }>(points: P[], zoom: number, radiusPx = 56): Cluster<P>[] {
  const z = Math.round(zoom);
  const sorted = [...points].sort((a, b) => a.lat - b.lat || a.lng - b.lng || (a.id < b.id ? -1 : 1));
  const groups: { x: number; y: number; points: P[] }[] = [];
  const grid = new Map<string, number[]>();
  const r2 = radiusPx * radiusPx;
  for (const p of sorted) {
    const { x, y } = project(p.lat, p.lng, z);
    const cx = Math.floor(x / radiusPx);
    const cy = Math.floor(y / radiusPx);
    let best = -1;
    let bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const gi of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const d = (groups[gi].x - x) ** 2 + (groups[gi].y - y) ** 2;
          if (d <= r2 && d < bestD) [best, bestD] = [gi, d];
        }
      }
    }
    if (best >= 0) {
      groups[best].points.push(p);
      continue;
    }
    groups.push({ x, y, points: [p] });
    const cell = `${cx}:${cy}`;
    grid.set(cell, [...(grid.get(cell) ?? []), groups.length - 1]);
  }
  return groups.map((g) => ({
    key: g.points.length === 1 ? g.points[0].id : `${g.points[0].id}+${g.points.length}`,
    lat: g.points.reduce((s, p) => s + p.lat, 0) / g.points.length,
    lng: g.points.reduce((s, p) => s + p.lng, 0) / g.points.length,
    points: g.points,
  }));
}

/** True when a group's points are all within a few metres: zooming in won't split them, so list them instead. */
export function samePlace(points: { lat: number; lng: number }[]) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return Math.max(...lats) - Math.min(...lats) < 0.0003 && Math.max(...lngs) - Math.min(...lngs) < 0.0003;
}

/** Bubble diameter and colour: bigger and darker as the count grows. */
export function bubbleStyle(n: number) {
  if (n < 10) return { size: 34, color: "#60a5fa" };
  if (n < 50) return { size: 40, color: "#3b82f6" };
  if (n < 200) return { size: 48, color: "#2563eb" };
  return { size: 56, color: "#1d4ed8" };
}
