import "server-only";

// Address suggestions while typing. Google Places (New) when the key allows it: suggestions
// resolve to the exact place, so the pin needs no further lookup. Otherwise Photon
// (OpenStreetMap) completes the text and the normal geocoder places it.

export type PlaceSuggestion = {
  /** "g:<placeId>" for Google, "t:<text>" for text-only suggestions. */
  id: string;
  main: string;
  secondary: string;
  /** The full address to put in the field. */
  text: string;
};

export type PlaceDetail = { text: string; lat: number; lng: number };

type Near = { lat: number; lng: number } | null;

let googleBlockedUntil = 0;

export async function suggestPlaces(query: string, near: Near, session: string): Promise<PlaceSuggestion[]> {
  const q = query.trim().slice(0, 120);
  if (q.length < 3) return [];
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key && Date.now() > googleBlockedUntil) {
    try {
      return await googleSuggest(q, near, session, key);
    } catch (err) {
      // Places not enabled on the key (or quota): use the fallback for a while instead of failing every keystroke.
      googleBlockedUntil = Date.now() + 10 * 60_000;
      console.warn(`[places] Google Places unavailable (${(err as Error).message}); using OpenStreetMap suggestions.`);
    }
  }
  return photonSuggest(q, near);
}

export async function placeDetail(id: string, session: string): Promise<PlaceDetail | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !id.startsWith("g:")) return null;
  const placeId = id.slice(2);
  if (!/^[\w-]{10,300}$/.test(placeId)) return null;
  const url = new URL(`https://places.googleapis.com/v1/places/${placeId}`);
  if (session) url.searchParams.set("sessionToken", session);
  const res = await fetch(url, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "formattedAddress,location" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const p = (await res.json()) as { formattedAddress?: string; location?: { latitude: number; longitude: number } };
  if (!p.location || !p.formattedAddress) return null;
  return { text: p.formattedAddress.replace(/, Australia$/, ""), lat: p.location.latitude, lng: p.location.longitude };
}

async function googleSuggest(q: string, near: Near, session: string, key: string): Promise<PlaceSuggestion[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({
      input: q,
      includedRegionCodes: ["au"],
      languageCode: "en-AU",
      ...(session && { sessionToken: session }),
      ...(near && {
        locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50_000 } },
        origin: { latitude: near.lat, longitude: near.lng },
      }),
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as {
    suggestions?: {
      placePrediction?: { placeId: string; distanceMeters?: number; text: { text: string }; structuredFormat?: { mainText: { text: string }; secondaryText?: { text: string } } };
    }[];
  };
  const list = (body.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => {
      const text = p.text.text.replace(/, Australia$/, "");
      const main = p.structuredFormat?.mainText.text ?? text;
      const secondary = (p.structuredFormat?.secondaryText?.text ?? "").replace(/, Australia$/, "");
      return { s: { id: `g:${p.placeId}`, main, secondary, text }, score: suburbMatch(q, main, secondary), dist: p.distanceMeters ?? Infinity };
    });
  // Google sometimes ranks a far-away suburb first ("100 Queen St Bris" → Goodna). Put suggestions
  // whose suburb matches the extra words typed first, then the nearest; otherwise keep its order.
  return list
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => b.score - a.score || a.dist - b.dist || a.i - b.i)
    .slice(0, 6)
    .map((x) => x.s);
}

/** How many typed words (beyond the street part) start a word in the suburb/state text. */
function suburbMatch(q: string, main: string, secondary: string) {
  const mainWords = new Set(main.toLowerCase().split(/[^a-z0-9]+/));
  const words = secondary.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !/^\d/.test(t) && !mainWords.has(t))
    .filter((t) => words.some((w) => w.startsWith(t))).length;
}

const STATE_ABBR: Record<string, string> = {
  Queensland: "QLD",
  "New South Wales": "NSW",
  Victoria: "VIC",
  "South Australia": "SA",
  "Western Australia": "WA",
  Tasmania: "TAS",
  "Northern Territory": "NT",
  "Australian Capital Territory": "ACT",
};

async function photonSuggest(q: string, near: Near): Promise<PlaceSuggestion[]> {
  const url = new URL(process.env.PHOTON_URL ?? "https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "en");
  url.searchParams.set("bbox", "112,-44,154,-10"); // Australia
  if (near) {
    url.searchParams.set("lat", String(near.lat));
    url.searchParams.set("lon", String(near.lng));
  }
  try {
    const res = await fetch(url, { headers: { "User-Agent": "FoodpacDistribution/1.0" }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      features: { properties: { name?: string; housenumber?: string; street?: string; district?: string; locality?: string; city?: string; state?: string; postcode?: string } }[];
    };
    // Keep the house number the person typed when the map only knows the street.
    const typedNumber = /^\s*(\d+[a-z]?(?:\/\d+)?)\s/i.exec(q)?.[1];
    const seen = new Set<string>();
    const out: PlaceSuggestion[] = [];
    for (const { properties: p } of body.features ?? []) {
      const street = p.street ?? (p.housenumber ? p.name : undefined);
      const number = p.housenumber ?? (street && typedNumber ? typedNumber : undefined);
      const main = street ? [number, street].filter(Boolean).join(" ") : (p.name ?? "");
      if (!main) continue;
      const place = p.district ?? p.locality ?? p.city ?? "";
      const secondary = [place, [p.state ? (STATE_ABBR[p.state] ?? p.state) : "", p.postcode].filter(Boolean).join(" ")].filter(Boolean).join(" ");
      const named = p.name && p.name !== street && !p.housenumber ? `${p.name}, ` : "";
      const text = [named + main, secondary].filter(Boolean).join(", ");
      if (seen.has(text)) continue;
      seen.add(text);
      out.push({ id: `t:${text}`, main: named ? `${p.name}` : main, secondary: named ? [main, secondary].join(", ") : secondary, text });
      if (out.length === 6) break;
    }
    return out;
  } catch {
    return [];
  }
}
