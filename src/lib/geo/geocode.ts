import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { DB } from "../db";
import { customers, depots, geocodeCache, type GeocodeStatus, orders } from "../db/schema";
import { geocodeQuery } from "../orders";
import { haversine, type LatLng } from "./routing";

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

/**
 * "--", "N/A", "TBA", "": no address was given. Geocoders still answer these — Google with the
 * middle of Australia — so they must never be looked up as an address.
 */
export function isPlaceholderAddress(text: string | null | undefined) {
  const t = (text ?? "").replace(/,?\s*australia\s*$/i, "").trim();
  if (!/[a-z]{2,}|\d{4}/i.test(t)) return true;
  return /^(n\/?a|tba|tbc|none|nil|null|unknown|no address|address|same|same as above)\.?$/i.test(t);
}

/**
 * A match for the whole country or a whole state ("Australia", "Queensland, Australia"): what a
 * geocoder answers when it found nothing it could place. Not a location to drive to.
 */
export function isTooVague(label: string | null | undefined) {
  if (!label) return false;
  return new RegExp(`^\\s*(?:(?:${STATES})\\s*,?\\s*)?australia\\s*$`, "i").test(label) || new RegExp(`^\\s*(?:${STATES})\\s*$`, "i").test(label);
}

/**
 * The address to show the driver and on the docket: the one written on the order, or — when
 * none was given ("--") — where the order was found (e.g. the business found by name).
 */
export function shownAddress(o: { address: string; geocodeLabel: string | null }) {
  return isPlaceholderAddress(o.address) && o.geocodeLabel ? o.geocodeLabel.replace(/, Australia$/, "") : o.address;
}

const FAILED = (provider: string): GeocodeResult => ({ status: "failed", lat: null, lng: null, label: null, provider });

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

/** A match further than this from the written postcode is in the wrong town. Neighbouring postcodes are closer. */
const WRONG_TOWN_KM = 40;

/**
 * Whether a match is in the wrong town: away from the postcode written in the address. A
 * different postcode alone isn't enough, addresses often carry the neighbouring one
 * ("Morayfield Rd, Caboolture 4506" is in 4510). Google sometimes ignores the suburb and
 * postcode and matches the same number in another town ("29 Bruce Hwy, Morayfield 4510" →
 * Rockhampton, 600 km away) as if exact.
 */
async function inWrongTown(db: DB, want: string | null, r: { status: string; lat: number | null; lng: number | null; label: string | null }) {
  if (!want || r.status === "failed" || r.lat === null || r.lng === null) return false;
  const got = postcodeOf(r.label);
  if (got === want) return false;
  const area = await postcodeArea(db, want);
  if (!area) return got !== null;
  return haversine(area, { lat: r.lat, lng: r.lng }) / 1000 > WRONG_TOWN_KM;
}

/** Where a postcode is (its centre), cached like addresses. */
async function postcodeArea(db: DB, postcode: string): Promise<(LatLng & { label: string | null }) | null> {
  const key = `${COUNTRY}|postcode:${postcode}`;
  const [cached] = await db.select().from(geocodeCache).where(eq(geocodeCache.query, key)).limit(1);
  let r: GeocodeResult | null = cached && cached.status !== "failed" ? { ...cached, status: cached.status as GeocodeResult["status"] } : null;
  if (!r) {
    r = await lookupPostcode(postcode);
    await saveToCache(db, key, r);
  }
  return r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng, label: r.label } : null;
}

async function saveToCache(db: DB, key: string, r: GeocodeResult) {
  await db
    .insert(geocodeCache)
    .values({ query: key, lat: r.lat, lng: r.lng, label: r.label, status: r.status, provider: r.provider })
    .onConflictDoUpdate({ target: geocodeCache.query, set: { lat: r.lat, lng: r.lng, label: r.label, status: r.status, provider: r.provider } });
}

export async function geocodeAddress(db: DB, address: string): Promise<GeocodeResult> {
  if (isPlaceholderAddress(address)) return FAILED(geocoderName());
  const key = normalise(address);
  const want = COUNTRY === "au" ? postcodeOf(address) : null;
  const [cached] = await db.select().from(geocodeCache).where(eq(geocodeCache.query, key)).limit(1);
  // A country- or state-wide answer cached before those were refused is looked up again.
  if (cached && cached.status !== "failed" && !isTooVague(cached.label) && !(await inWrongTown(db, want, cached))) {
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
  if (want && (await inWrongTown(db, want, result))) {
    // Matched in another town: the street in the right area, else the postcode's centre, for
    // someone to check the pin. Either keeps the route close to right.
    const street = stripNumber(address);
    const retry = street !== address ? await lookup(street) : null;
    const area = await postcodeArea(db, want);
    if (retry && retry.status !== "failed" && area && !(await inWrongTown(db, want, { ...retry, label: null }))) result = { ...retry, status: "approximate" };
    else if (area) result = { status: "approximate", lat: area.lat, lng: area.lng, label: area.label, provider: result.provider };
    else result = { status: "failed", lat: null, lng: null, label: null, provider: result.provider };
  }

  await saveToCache(db, key, result);
  return result;
}

/**
 * Looks at the day's open orders that may sit in the wrong place and locates them again:
 * those waiting to be located, and those pinned in another town before matches were checked.
 * A pin someone placed by hand (it no longer matches what the geocoder returned) is theirs and
 * is left alone. Returns how many orders were updated.
 */
export async function checkDayLocations(db: DB, date: string) {
  const rows = await db
    .select({
      id: orders.id,
      address: orders.address,
      suburb: orders.suburb,
      postcode: orders.postcode,
      lat: orders.lat,
      lng: orders.lng,
      geocodeStatus: orders.geocodeStatus,
      geocodeLabel: orders.geocodeLabel,
      customerName: orders.customerName,
      customerId: orders.customerId,
    })
    .from(orders)
    .where(and(eq(orders.deliveryDate, date), inArray(orders.status, ["pending", "planned", "dispatched"])));
  let updated = 0;
  let waiting = 0;
  for (const o of rows) {
    const query = geocodeQuery(o);
    // A big import is located by its own background job; this only picks up a few stragglers.
    if (o.geocodeStatus === "pending" && ++waiting > 10) continue;
    // Pinned to the whole country or state ("Australia"): never a real location, so always look again.
    if (o.geocodeStatus !== "pending" && !(o.lat !== null && isTooVague(o.geocodeLabel))) {
      // No label: placed or confirmed by hand on the map.
      if (COUNTRY !== "au" || o.lat === null || !o.geocodeLabel) continue;
      const want = postcodeOf(query);
      // Cheap check first: only a pin outside the written postcode can be in the wrong town.
      if (!want || postcodeOf(o.geocodeLabel) === want) continue;
      const [cached] = await db.select({ lat: geocodeCache.lat, lng: geocodeCache.lng }).from(geocodeCache).where(eq(geocodeCache.query, normalise(query))).limit(1);
      if (!cached || cached.lat !== o.lat || cached.lng !== o.lng) continue;
      if (!(await inWrongTown(db, want, { status: o.geocodeStatus, lat: o.lat, lng: o.lng, label: o.geocodeLabel }))) continue;
    }
    const r = await locateOrder(db, o);
    await db.update(orders).set({ lat: r.lat, lng: r.lng, geocodeStatus: r.status, geocodeLabel: r.label, updatedAt: new Date() }).where(eq(orders.id, o.id));
    updated++;
  }
  return updated;
}

type OrderToLocate = {
  id?: string;
  address: string;
  suburb: string | null;
  postcode: string | null;
  customerName?: string | null;
  customerId?: string | null;
};

/** Further than this from every depot, a match found by business name is someone else's shop. */
const BUSINESS_RANGE_KM = 150;

/**
 * Where to deliver an order. Its address, looked up as usual. When there's no usable address
 * ("--", blank) or it can't be found, in this order:
 *  1. where staff confirmed this customer on an earlier order (exact, it was checked by eye);
 *  2. the customer's own address on file;
 *  3. the business, searched by name (and suburb) near the depot — flagged approximate so
 *     someone confirms it; confirming it makes it (1) for this customer's next orders;
 *  4. the suburb or postcode's centre, approximate.
 * Otherwise "failed": no pin at all, so the order shows as needing an address rather than
 * being driven to the wrong place.
 */
export async function locateOrder(db: DB, o: OrderToLocate): Promise<GeocodeResult> {
  const hasAddress = !isPlaceholderAddress(o.address);
  if (hasAddress) {
    const r = await geocodeAddress(db, geocodeQuery(o));
    if (r.status !== "failed") return r;
  }

  const name = o.customerName?.trim() ?? "";
  if (o.customerId || name) {
    const earlier = await db
      .select({ lat: orders.lat, lng: orders.lng, address: orders.address, label: orders.geocodeLabel })
      .from(orders)
      .where(
        and(
          o.customerId ? eq(orders.customerId, o.customerId) : sql`lower(${orders.customerName}) = lower(${name})`,
          o.id ? ne(orders.id, o.id) : undefined,
          isNotNull(orders.lat),
          eq(orders.geocodeStatus, "ok"),
          // The same address: a customer with another address written is somewhere else.
          hasAddress ? sql`lower(trim(${orders.address})) = lower(trim(${o.address}))` : undefined,
          // Placed or confirmed by hand (no label), unless the order had no address either: then
          // "ok" only comes from someone confirming it, and the label is where it was found.
          hasAddress ? isNull(orders.geocodeLabel) : undefined,
        ),
      )
      .orderBy(desc(orders.updatedAt))
      .limit(20);
    const prev = earlier.find((e) => e.label === null || isPlaceholderAddress(e.address));
    if (prev?.lat != null && prev.lng != null) return { status: "ok", lat: prev.lat, lng: prev.lng, label: hasAddress ? null : prev.label, provider: "confirmed" };
  }

  if (o.customerId && !hasAddress) {
    const [c] = await db
      .select({ address: customers.address, lat: customers.lat, lng: customers.lng, status: customers.geocodeStatus, label: customers.geocodeLabel, placedFor: customers.geocodedAddress })
      .from(customers)
      .where(eq(customers.id, o.customerId))
      .limit(1);
    if (c?.address && !isPlaceholderAddress(c.address)) {
      const placed = c.lat !== null && c.lng !== null && c.placedFor === c.address && c.status && c.status !== "failed" && !isTooVague(c.label);
      const r = placed ? { status: c.status!, lat: c.lat, lng: c.lng, label: c.label, provider: "customer" } : await geocodeAddress(db, c.address);
      if (r.status !== "failed") return r;
    }
  }

  if (name) {
    const r = await findBusiness(db, name, [o.suburb, o.postcode].filter(Boolean).join(" "));
    if (r.status !== "failed") return r;
  }

  const area = [o.suburb, o.postcode].filter(Boolean).join(" ");
  if (area) {
    const r = await geocodeAddress(db, area);
    if (r.status !== "failed") return { ...r, status: "approximate" };
  }
  return FAILED(geocoderName());
}

/**
 * A business found by name ("Sushi Paradise (Jindalee DFO)") with Google Places, near the
 * depots. Always approximate: a name can match another branch, so someone confirms the pin.
 */
async function findBusiness(db: DB, name: string, area: string): Promise<GeocodeResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return FAILED("google-places");
  const text = [name.replace(/[()[\]]/g, " "), area].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (text.length < 3) return FAILED("google-places");
  const key = `${COUNTRY}|business:${text.toLowerCase()}`;
  const [cached] = await db.select().from(geocodeCache).where(eq(geocodeCache.query, key)).limit(1);
  if (cached && cached.status !== "failed") return { status: "approximate", lat: cached.lat, lng: cached.lng, label: cached.label, provider: cached.provider };

  const homes = (await db.select({ lat: depots.lat, lng: depots.lng }).from(depots).orderBy(asc(depots.createdAt))).filter(
    (d): d is LatLng => d.lat !== null && d.lng !== null,
  );
  const home = homes[0];
  let result = FAILED("google-places");
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location" },
      body: JSON.stringify({
        textQuery: text,
        regionCode: COUNTRY.toUpperCase(),
        languageCode: "en-AU",
        pageSize: 1,
        ...(home && { locationBias: { circle: { center: { latitude: home.lat, longitude: home.lng }, radius: 50_000 } } }),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { places?: { displayName?: { text: string }; formattedAddress?: string; location?: { latitude: number; longitude: number } }[] };
    const p = body.places?.[0];
    if (p?.location && p.formattedAddress) {
      const at = { lat: p.location.latitude, lng: p.location.longitude };
      const near = !homes.length || homes.some((d) => haversine(d, at) / 1000 <= BUSINESS_RANGE_KM);
      const address = p.formattedAddress.replace(/, Australia$/, "");
      if (near && !isTooVague(p.formattedAddress)) {
        result = { status: "approximate", ...at, label: p.displayName?.text ? `${p.displayName.text}, ${address}` : address, provider: "google-places" };
      }
    }
  } catch (err) {
    // Places not enabled on the key, or no answer: no pin rather than a guess.
    console.warn(`[geocode] business search unavailable (${(err as Error).message}).`);
    return result;
  }
  await saveToCache(db, key, result);
  return result;
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

/** The centre of a postcode area. */
async function lookupPostcode(postcode: string): Promise<GeocodeResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    try {
      return await google("", key, `postal_code:${postcode}`);
    } catch {
      // Fall through to OpenStreetMap.
    }
  }
  return nominatim(`${postcode}, Australia`);
}

class GoogleUnavailable extends Error {}

const VAGUE_TYPES = new Set(["country", "administrative_area_level_1", "administrative_area_level_2", "colloquial_area"]);

async function google(address: string, apiKey: string, component?: string): Promise<GeocodeResult> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  if (address) url.searchParams.set("address", address);
  url.searchParams.set("region", COUNTRY);
  url.searchParams.set("components", [`country:${COUNTRY.toUpperCase()}`, component].filter(Boolean).join("|"));
  url.searchParams.set("key", apiKey);
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const body = (await res.json()) as {
    status: string;
    results: { formatted_address: string; types?: string[]; partial_match?: boolean; geometry: { location: { lat: number; lng: number }; location_type: string } }[];
  };
  const r = body.results?.[0];
  // ZERO_RESULTS is a real "not found"; REQUEST_DENIED / OVER_QUERY_LIMIT / etc. mean Google couldn't answer.
  if (body.status !== "OK" && body.status !== "ZERO_RESULTS") throw new GoogleUnavailable(`${body.status}: ${(body as { error_message?: string }).error_message ?? ""}`.trim());
  if (body.status !== "OK" || !r) return FAILED("google");
  // The whole country, state or region: Google found nothing it could place.
  if (r.types?.some((t) => VAGUE_TYPES.has(t)) || isTooVague(r.formatted_address)) return FAILED("google");
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
    if (!r) return FAILED("nominatim");
    if (["country", "state", "region", "county", "state_district"].includes(r.addresstype ?? "")) return FAILED("nominatim");
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
