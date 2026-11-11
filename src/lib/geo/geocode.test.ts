import { afterEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../db";
import { geocodeCache, orders } from "../db/schema";
import { geocodeAddress, postcodeOf, relocateMisplacedOrders, stripNumber } from "./geocode";

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

function googleReplies(byAddress: Record<string, object>) {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test");
  vi.stubGlobal("fetch", async (url: URL) => {
    const address = url.searchParams.get("address")!;
    const r = byAddress[address];
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

  it("gives up rather than pin the wrong town", async () => {
    googleReplies({
      "29 Bruce Hwy, Morayfield QLD 4510": {
        formatted_address: "29 Bruce Hwy, Rockhampton City QLD 4700, Australia",
        geometry: { location: { lat: -23.37, lng: 150.5 }, location_type: "ROOFTOP" },
      },
    });
    const r = await geocodeAddress(fakeDb(), "29 Bruce Hwy, Morayfield QLD 4510");
    expect(r).toMatchObject({ status: "failed", lat: null });
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

describe("relocateMisplacedOrders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const rockhampton = { lat: -23.374108, lng: 150.5043003 };
  /** What the cache held for the address before postcodes were checked. */
  const cachedRockhampton = { ...rockhampton, status: "ok", provider: "google", label: "18/29 Bruce Hwy, Rockhampton City QLD 4700, Australia" };
  const order = (lat: number, lng: number) => ({
    id: "o1",
    address: "18/29 Bruce Hwy, Morayfield QLD 4510",
    suburb: null,
    postcode: null,
    lat,
    lng,
    geocodeLabel: "18/29 Bruce Hwy, Rockhampton City QLD 4700, Australia",
  });

  /** Orders and cache rows for the query; records order updates. */
  function db(orderRows: object[], cacheRows: object[]) {
    const updates: object[] = [];
    const select = () => {
      let table: unknown;
      const q = {
        from: (t: unknown) => ((table = t), q),
        where: () => (table === orders ? Promise.resolve(orderRows) : q),
        limit: async () => (table === geocodeCache ? cacheRows : []),
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
    expect(await relocateMisplacedOrders(d, "2026-11-12")).toBe(1);
    expect(updates[0]).toMatchObject({ lat: -27.1075825, geocodeStatus: "approximate" });
  });

  it("leaves a pin someone placed by hand", async () => {
    google();
    const { db: d, updates } = db([order(-27.12, 152.97)], [cachedRockhampton]);
    expect(await relocateMisplacedOrders(d, "2026-11-12")).toBe(0);
    expect(updates).toEqual([]);
  });
});
