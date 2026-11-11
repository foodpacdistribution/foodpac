import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { DB } from "../db";
import { geocodeCache, type GeocodeStatus, orders } from "../db/schema";
import { geocodeQuery } from "../orders";

export type GeocodeResult = {
  status: Exclude<GeocodeStatus, "pending">;
  lat: number | null;
  lng: number | null;
  label: string | null;
  provider: string;
};

const COUNTRY = (process.env.GEOCODE_COUNTRY ?? "au").toLowerCase();
const USER_AGENT = process.env.GEOCODE_USER_AGENT ?? "foodpac-distribution/1.0";

export function geocoderName() {
  return process.env.GOOGLE_MAPS_API_KEY ? "google" : "nominatim";
}

function normalise(address: string) {
  return `${COUNTRY}|${address.toLowerCase().replace(/[\s,]+/g, " ").trim()}`;
}

/** "Unit 3/12 Smith St" → "12 Smith St": open geocoders often miss unit-level addresses. */
export function stripUnit(address: string) {
  return address
    .replace(/^\s*(unit|u|shop|suite|level|lvl|apt|apartment)\s*\d+[a-z]?\s*[,/]?\s*/i, "")
    .replace(/^\s*\d+[a-z]?\s*\/\s*(?=\d)/i, "")
    .trim();
}

const STATES = "QLD|NSW|VIC|SA|WA|TAS|NT|ACT|Queensland|New South Wales|Victoria|South Australia|Western Australia|Tasmania|Northern Territory|Australian Capital Territory";

/** The postcode written in an address or geocoder label ("…, Morayfield QLD 4510", "…, 4510, Australia"), or null. */
export function postcodeOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.replace(/,?\s*australia\s*$/i, "");
  const m = new RegExp(`\\b(?:${STATES})\\b,?\\s*(\\d{4})\\b`, "i").exec(t) ?? /,\s*(\d{4})\s*$/.exec(t);
  return m ? m[1] : null;
}

/** "18/29 Bruce Hwy, Morayfield QLD 4510" → "Bruce Hwy, Morayfield QLD 4510": the street, for when the number can't be found. */
export function stripNumber(address: string) {
  return stripUnit(address)
    .replace(/^\s*\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?\s+/i, "")
    .trim();
}

export async function geocodeAddress(db: DB, address: string): Promise<GeocodeResult> {
  const key = normalise(address);
  // Google sometimes ignores the suburb and postcode and matches the same street number in
  // another town ("29 Bruce Hwy, Morayfield 4510" → Rockhampton 4700, 600 km away) as if exact.
  const want = COUNTRY === "au" ? postcodeOf(address) : null;
  const elsewhere = (r: { status: string; label: string | null }) => {
    const got = r.status === "failed" ? null : postcodeOf(r.label);
    return !!want && !!got && got !== want;
  };
  const [cached] = await db.select().from(geocodeCache).where(eq(geocodeCache.query, key)).limit(1);
  if (cached && cached.status !== "failed" && !elsewhere(cached)) {
    return { status: cached.status as GeocodeResult["status"], lat: cached.lat, lng: cached.lng, label: cached.label, provider: cached.provider };
  }

  let result = await lookup(address);
  if (result.status === "failed") {
    const simpler = stripUnit(address);
    if (simpler !== address) {
      const retry = await lookup(simpler);
      // Matched without the unit number, so the pin is the building/street, not the exact door.
      if (retry.status !== "failed") result = { ...retry, status: "approximate" };
    }
  }
  if (elsewhere(result)) {
    // Wrong postcode: fall back to the street in the right area, for someone to check the pin.
    const street = stripNumber(address);
    const retry = street !== address ? await lookup(street) : null;
    result =
      retry && retry.status !== "failed" && !elsewhere(retry)
        ? { ...retry, status: "approximate" }
        : { status: "failed", lat: null, lng: null, label: null, provider: result.provider };
  }

  await db
    .insert(geocodeCache)
    .values({ query: key, lat: result.lat, lng: result.lng, label: result.label, status: result.status, provider: result.provider })
    .onConflictDoUpdate({
      target: geocodeCache.query,
      set: { lat: result.lat, lng: result.lng, label: result.label, status: result.status, provider: result.provider },
    });
  return result;
}

/**
 * Looks again at the day's open orders that were pinned in a different postcode from their
 * address, before that was checked. A pin someone placed by hand (it no longer matches what the
 * geocoder returned) is theirs and is left alone. Returns how many orders were moved.
 */
export async function relocateMisplacedOrders(db: DB, date: string) {
  if (COUNTRY !== "au") return 0;
  const rows = await db
    .select({ id: orders.id, address: orders.address, suburb: orders.suburb, postcode: orders.postcode, lat: orders.lat, lng: orders.lng, geocodeLabel: orders.geocodeLabel })
    .from(orders)
    .where(and(eq(orders.deliveryDate, date), isNotNull(orders.lat), isNotNull(orders.geocodeLabel), inArray(orders.status, ["pending", "planned", "dispatched"])));
  let moved = 0;
  for (const o of rows) {
    const query = geocodeQuery(o);
    const want = postcodeOf(query);
    const got = postcodeOf(o.geocodeLabel);
    if (!want || !got || want === got) continue;
    const [cached] = await db.select({ lat: geocodeCache.lat, lng: geocodeCache.lng }).from(geocodeCache).where(eq(geocodeCache.query, normalise(query))).limit(1);
    if (!cached || cached.lat !== o.lat || cached.lng !== o.lng) continue;
    const r = await geocodeAddress(db, query);
    await db.update(orders).set({ lat: r.lat, lng: r.lng, geocodeStatus: r.status, geocodeLabel: r.label, updatedAt: new Date() }).where(eq(orders.id, o.id));
    moved++;
  }
  return moved;
}

async function lookup(address: string): Promise<GeocodeResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return nominatim(address);
  try {
    return await google(address, key);
  } catch (err) {
    // Key, billing or quota problem on Google's side: don't mark every address "not found".
    console.warn(`[geocode] Google unavailable (${(err as Error).message}); using OpenStreetMap.`);
    return nominatim(address);
  }
}

class GoogleUnavailable extends Error {}

async function google(address: string, apiKey: string): Promise<GeocodeResult> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("region", COUNTRY);
  url.searchParams.set("components", `country:${COUNTRY.toUpperCase()}`);
  url.searchParams.set("key", apiKey);
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const body = (await res.json()) as {
    status: string;
    results: { formatted_address: string; partial_match?: boolean; geometry: { location: { lat: number; lng: number }; location_type: string } }[];
  };
  const r = body.results?.[0];
  // ZERO_RESULTS is a real "not found"; REQUEST_DENIED / OVER_QUERY_LIMIT / etc. mean Google couldn't answer.
  if (body.status !== "OK" && body.status !== "ZERO_RESULTS") throw new GoogleUnavailable(`${body.status}: ${(body as { error_message?: string }).error_message ?? ""}`.trim());
  if (body.status !== "OK" || !r) return { status: "failed", lat: null, lng: null, label: null, provider: "google" };
  const precise = !r.partial_match && ["ROOFTOP", "RANGE_INTERPOLATED"].includes(r.geometry.location_type);
  return {
    status: precise ? "ok" : "approximate",
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    label: r.formatted_address,
    provider: "google",
  };
}

// Nominatim's usage policy: max 1 request/second, identify yourself with a User-Agent.
let nextNominatimSlot = 0;

async function nominatim(address: string): Promise<GeocodeResult> {
  const wait = nextNominatimSlot - Date.now();
  nextNominatimSlot = Math.max(Date.now(), nextNominatimSlot) + 1100;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  const url = new URL(process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", address);
  url.searchParams.set("countrycodes", COUNTRY);
  url.searchParams.set("limit", "1");
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const [r] = (await res.json()) as { lat: string; lon: string; display_name: string; addresstype?: string }[];
    if (!r) return { status: "failed", lat: null, lng: null, label: null, provider: "nominatim" };
    const precise = ["house", "building", "amenity", "shop", "office", "craft", "commercial", "retail"].includes(r.addresstype ?? "");
    return { status: precise ? "ok" : "approximate", lat: Number(r.lat), lng: Number(r.lon), label: r.display_name, provider: "nominatim" };
  } catch {
    // Network/rate-limit failure: report as failed but the caller can retry later.
    return { status: "failed", lat: null, lng: null, label: null, provider: "nominatim" };
  }
}

/** Nearest street address for a point ("Near 12 Smith St, Moorooka"), so a GPS start can be checked at a glance. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("latlng", `${lat},${lng}`);
      url.searchParams.set("result_type", "street_address|premise|subpremise|route");
      url.searchParams.set("key", key);
      const body = (await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json()) as { status: string; results?: { formatted_address: string }[] };
      if (body.status === "OK" && body.results?.[0]) return body.results[0].formatted_address.replace(/, Australia$/, "");
    } catch {
      // Fall through to OpenStreetMap.
    }
  }
  try {
    const url = new URL((process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org/search").replace(/\/search$/, "/reverse"));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("zoom", "18");
    const r = (await (await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) })).json()) as {
      address?: Record<string, string>;
      display_name?: string;
    };
    const a = r.address ?? {};
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    const place = a.suburb ?? a.city_district ?? a.town ?? a.city ?? a.village;
    return [street, place].filter(Boolean).join(", ") || r.display_name || null;
  } catch {
    return null;
  }
}
