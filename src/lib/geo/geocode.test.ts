import { afterEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../db";
import { geocodeCache, orders } from "../db/schema";
import { checkDayLocations, geocodeAddress, postcodeOf, stripNumber } from "./geocode";

describe("postcodeOf", () => {
  it("reads the postcode after the state", () => {
    expect(postcodeOf("18/29 Bruce Hwy, Morayfield QLD 4510")).toBe("4510");
    expect(postcodeOf("18/29 Bruce Hwy, Rockhampton City QLD 4700, Australia")).toBe("4700");
    expect(postcodeOf("12 Smith St, Rockhampton, Queensland, 4700, Australia")).toBe("4700");
  });
  it("reads a trailing postcode added after a comma", () => {
    expect(postcodeOf("44A Simpson St, beerwah, 4519")).toBe("4519");
  });
  it("doesn't mistake a street number for a postcode", () => {
    expect(postcodeOf("1305 Bruce Hwy, Morayfield")).toBeNull();
    expect(postcodeOf("Bruce Hwy, Morayfield QLD, Australia")).toBeNull();
    expect(postcodeOf(null)).toBeNull();
  });
});

describe("stripNumber", () => {
  it("drops unit and street numbers", () => {
    expect(stripNumber("18/29 Bruce Hwy, Morayfield QLD 4510")).toBe("Bruce Hwy, Morayfield QLD 4510");
    expect(stripNumber("1305-1395 Bruce Hwy, Burpengary")).toBe("Bruce Hwy, Burpengary");
    expect(stripNumber("Shop 3, 44A Simpson St, Beerwah")).toBe("Simpson St, Beerwah");
  });
});

/** Enough of the database for geocodeAddress: an empty cache that accepts writes. */
function fakeDb() {
  const chain = { from: () => chain, where: () => chain, limit: async () => [] };
  return {
    select: () => chain,
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
  } as unknown as DB;
}

/** Where Google puts postcodes 4506 (Morayfield) and 4510 (Caboolture), as it answered. */
const POSTCODES: Record<string, object> = {
  "postal_code:4506": { formatted_address: "Morayfield QLD 4506, Australia", geometry: { location: { lat: -27.133839, lng: 152.9264759 }, location_type: "APPROXIMATE" } },
  "postal_code:4510": { formatted_address: "Rocksberg QLD 4510, Australia", geometry: { location: { lat: -27.0796844, lng: 152.9518951 }, location_type: "APPROXIMATE" } },
};

/** Google's answers by address (or, for a postcode lookup, by postcode). */
function googleReplies(byAddress: Record<string, object>) {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test");
  vi.stubGlobal("fetch", async (url: URL) => {
    const address = url.searchParams.get("address");
    const postcode = url.searchParams.get("components")!.split("|")[1];
    const r = address ? byAddress[address] : POSTCODES[postcode];
    return { json: async () => (r ? { status: "OK", results: [r] } : { status: "ZERO_RESULTS", results: [] }) };
  });
}

describe("geocodeAddress", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("doesn't trust an 'exact' match in another postcode, and falls back to the street in the right area", async () => {
    googleReplies({
      "18/29 Bruce Hwy, Morayfield QLD 4510": {
        formatted_address: "18/29 Bruce Hwy, Rockhampton City QLD 4700, Australia",
        geometry: { location: { lat: -23.374108, lng: 150.5043003 }, location_type: "ROOFTOP" },
      },
      "Bruce Hwy, Morayfield QLD 4510": {
        formatted_address: "Bruce Hwy, Morayfield QLD, Australia",
        geometry: { location: { lat: -27.1075825, lng: 152.9765714 }, location_type: "GEOMETRIC_CENTER" },
      },
    });
    const r = await geocodeAddress(fakeDb(), "18/29 Bruce Hwy, Morayfield QLD 4510");
    expect(r).toMatchObject({ status: "approximate", lat: -27.1075825, label: "Bruce Hwy, Morayfield QLD, Australia" });
  });

  it("falls back to the postcode's centre rather than pin the wrong town", async () => {
    googleReplies({
      "29 Bruce Hwy, Morayfield QLD 4510": {
        formatted_address: "29 Bruce Hwy, Rockhampton City QLD 4700, Australia",
        geometry: { location: { lat: -23.37, lng: 150.5 }, location_type: "ROOFTOP" },
      },
    });
    const r = await geocodeAddress(fakeDb(), "29 Bruce Hwy, Morayfield QLD 4510");
    expect(r).toMatchObject({ status: "approximate", lat: -27.0796844, label: "Rocksberg QLD 4510, Australia" });
  });

  it("keeps a match in the neighbouring postcode", async () => {
    googleReplies({
      "113-137 Morayfield Rd, Caboolture, South QLD 4506": {
        formatted_address: "113-137 Morayfield Rd, Caboolture QLD 4510, Australia",
        geometry: { location: { lat: -27.0984116, lng: 152.9491865 }, location_type: "ROOFTOP" },
      },
    });
    const r = await geocodeAddress(fakeDb(), "113-137 Morayfield Rd, Caboolture, South QLD 4506");
    expect(r).toMatchObject({ status: "ok", lat: -27.0984116 });
  });

  it("keeps an exact match in the right postcode", async () => {
    googleReplies({
      "66 Ernest St, South Brisbane QLD 4101": {
        formatted_address: "66 Ernest St, South Brisbane QLD 4101, Australia",
        geometry: { location: { lat: -27.48, lng: 153.02 }, location_type: "ROOFTOP" },
      },
    });
    const r = await geocodeAddress(fakeDb(), "66 Ernest St, South Brisbane QLD 4101");
    expect(r).toMatchObject({ status: "ok", lat: -27.48 });
  });
});

describe("checkDayLocations", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const rockhampton = { lat: -23.374108, lng: 150.5043003 };
  /** What the cache held for the address before postcodes were checked. */
  const cachedRockhampton = { ...rockhampton, status: "ok", provider: "google", label: "18/29 Bruce Hwy, Rockhampton City QLD 4700, Australia" };
  const order = (lat: number, lng: number, geocodeLabel: string | null = "18/29 Bruce Hwy, Rockhampton City QLD 4700, Australia") => ({
    id: "o1",
    geocodeStatus: "ok",
    address: "18/29 Bruce Hwy, Morayfield QLD 4510",
    suburb: null,
    postcode: null,
    lat,
    lng,
    geocodeLabel,
  });

  /** Orders and cache rows for the query; records order updates. */
  function db(orderRows: object[], cacheRows: object[]) {
    const updates: object[] = [];
    const select = () => {
      let table: unknown;
      let cacheKey: unknown;
      const q = {
        from: (t: unknown) => ((table = t), q),
        where: (cond: { queryChunks?: { value?: unknown }[] }) => {
          // eq(geocodeCache.query, key): the key is the bound parameter.
          cacheKey = cond?.queryChunks?.map((c) => (c as { value?: unknown }).value).find((v) => typeof v === "string" && v.includes("|"));
          return table === orders ? Promise.resolve(orderRows) : q;
        },
        limit: async () => (table === geocodeCache && !String(cacheKey).includes("postcode:") ? cacheRows : []),
      };
      return q;
    };
    const fake = {
      select,
      insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
      update: () => ({ set: (v: object) => ({ where: async () => void updates.push(v) }) }),
    };
    return { db: fake as unknown as DB, updates };
  }

  function google() {
    googleReplies({
      "18/29 Bruce Hwy, Morayfield QLD 4510": {
        formatted_address: "18/29 Bruce Hwy, Rockhampton City QLD 4700, Australia",
        geometry: { location: rockhampton, location_type: "ROOFTOP" },
      },
      "Bruce Hwy, Morayfield QLD 4510": {
        formatted_address: "Bruce Hwy, Morayfield QLD, Australia",
        geometry: { location: { lat: -27.1075825, lng: 152.9765714 }, location_type: "GEOMETRIC_CENTER" },
      },
    });
  }

  it("moves a stop the geocoder put in another town", async () => {
    google();
    const { db: d, updates } = db([order(rockhampton.lat, rockhampton.lng)], [cachedRockhampton]);
    expect(await checkDayLocations(d, "2026-11-12")).toBe(1);
    expect(updates[0]).toMatchObject({ lat: -27.1075825, geocodeStatus: "approximate" });
  });

  it("leaves a pin someone placed by hand", async () => {
    google();
    const moved = db([order(-27.12, 152.97)], [cachedRockhampton]);
    expect(await checkDayLocations(moved.db, "2026-11-12")).toBe(0);
    // Confirmed where it was: the label is cleared on confirming.
    const confirmed = db([order(rockhampton.lat, rockhampton.lng, null)], [cachedRockhampton]);
    expect(await checkDayLocations(confirmed.db, "2026-11-12")).toBe(0);
    expect([...moved.updates, ...confirmed.updates]).toEqual([]);
  });
});
