// Road travel times and route shapes from OSRM (public demo server by default;
// set OSRM_URL to a self-hosted instance for production volume). If OSRM is
// unreachable we fall back to a straight-line estimate and say so in the UI.

export type LatLng = { lat: number; lng: number };

export type TravelMatrix = {
  durations: number[][];
  distances: number[][];
  source: "osrm" | "estimate";
};

const OSRM_URL = (process.env.OSRM_URL ?? "https://router.project-osrm.org").replace(/\/$/, "");
const TABLE_CHUNK = 50;

export function routingName() {
  return process.env.OSRM_URL ? "osrm (self-hosted)" : "osrm (public demo server)";
}

const coord = (p: LatLng) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

async function osrmTable(points: LatLng[], sources: number[], destinations: number[]) {
  const url =
    `${OSRM_URL}/table/v1/driving/${points.map(coord).join(";")}` +
    `?annotations=duration,distance&sources=${sources.join(";")}&destinations=${destinations.join(";")}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`OSRM table ${res.status}`);
  const body = (await res.json()) as { code: string; durations: (number | null)[][]; distances: (number | null)[][] };
  if (body.code !== "Ok") throw new Error(`OSRM table ${body.code}`);
  return body;
}

export async function travelMatrix(points: LatLng[]): Promise<TravelMatrix> {
  const n = points.length;
  const durations = points.map(() => new Array<number>(n).fill(0));
  const distances = points.map(() => new Array<number>(n).fill(0));
  try {
    const chunks: number[][] = [];
    for (let i = 0; i < n; i += TABLE_CHUNK) chunks.push(Array.from({ length: Math.min(TABLE_CHUNK, n - i) }, (_, k) => i + k));
    for (const src of chunks) {
      for (const dst of chunks) {
        // Send only the coordinates this block needs to stay under server size limits.
        const ids = src === dst ? src : [...src, ...dst];
        const local = ids.map((i) => points[i]);
        const s = src.map((_, k) => k);
        const d = src === dst ? s : dst.map((_, k) => src.length + k);
        const body = await osrmTable(local, s, d);
        src.forEach((i, a) =>
          dst.forEach((j, b) => {
            const dur = body.durations[a][b];
            const dist = body.distances[a][b];
            if (dur === null || dist === null) throw new Error("OSRM: unroutable pair");
            durations[i][j] = Math.round(dur);
            distances[i][j] = Math.round(dist);
          }),
        );
      }
    }
    return { durations, distances, source: "osrm" };
  } catch (err) {
    console.warn("[routing] OSRM unavailable, using straight-line estimate:", (err as Error).message);
    return estimateMatrix(points);
  }
}

export function haversine(a: LatLng, b: LatLng) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight line × 1.35 detour factor at an average 35 km/h. Clearly worse than real road data. */
export function estimateMatrix(points: LatLng[]): TravelMatrix {
  const distances = points.map((p) => points.map((q) => Math.round(haversine(p, q) * 1.35)));
  const durations = distances.map((row) => row.map((d) => Math.round(d / (35 / 3.6))));
  return { durations, distances, source: "estimate" };
}

/** Road path through the given points as [lat, lng] pairs; straight lines if OSRM fails. */
export async function routeGeometry(points: LatLng[]): Promise<[number, number][]> {
  if (points.length < 2) return points.map((p) => [p.lat, p.lng]);
  const out: [number, number][] = [];
  try {
    for (let i = 0; i < points.length - 1; i += 79) {
      const slice = points.slice(i, i + 80);
      const url = `${OSRM_URL}/route/v1/driving/${slice.map(coord).join(";")}?overview=full&geometries=geojson`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`OSRM route ${res.status}`);
      const body = (await res.json()) as { code: string; routes: { geometry: { coordinates: [number, number][] } }[] };
      if (body.code !== "Ok") throw new Error(`OSRM route ${body.code}`);
      for (const [lng, lat] of body.routes[0].geometry.coordinates) {
        out.push([Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]);
      }
    }
    return out;
  } catch {
    return points.map((p) => [p.lat, p.lng]);
  }
}
