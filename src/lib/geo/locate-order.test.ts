import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "../db";
import { customers, depots, geocodeCache, orders } from "../db/schema";
import { checkDayLocations, geocodeAddress, isPlaceholderAddress, isTooVague, locateOrder, shownAddress } from "./geocode";

let db: DB;
const DATE = "2026-11-13";
/** Where Google Places has Sushi Paradise at DFO Jindalee. */
const DFO = { lat: -27.5336, lng: 152.9399 };
const AUSTRALIA = {
  formatted_address: "Australia",
  types: ["country", "political"],
  geometry: { location: { lat: -25.274398, lng: 133.775136 }, location_type: "APPROXIMATE" },
};

let placesCalls: string[] = [];
/** Google: the geocoder answers "Australia" for anything it can't place; Places knows the shop. */
function google(places: Record<string, object> = {}) {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test");
  placesCalls = [];
  vi.stubGlobal("fetch", async (url: URL | string, init?: { body?: string }) => {
    if (String(url).includes("places:searchText")) {
      const q = JSON.parse(init!.body!).textQuery as string;
      placesCalls.push(q);
      const hit = Object.entries(places).find(([k]) => q.toLowerCase().includes(k.toLowerCase()));
      return { ok: true, json: async () => ({ places: hit ? [hit[1]] : [] }) };
    }
    return { json: async () => ({ status: "OK", results: [AUSTRALIA] }) };
  });
}
const SUSHI = { displayName: { text: "SUSHI PARADISE DFO JINDALEE" }, formattedAddress: "Shop 49/16 Amazons Pl, Jindalee QLD 4074, Australia", location: { latitude: DFO.lat, longitude: DFO.lng } };

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  await db.insert(depots).values({ name: "Depot", lat: -27.47, lng: 153.02 });
}, 30000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isPlaceholderAddress / isTooVague", () => {
  it("knows a missing address", () => {
    for (const a of ["--", "-", "", "  ", "N/A", "n/a", "TBA", "none", "--, Australia"]) expect(isPlaceholderAddress(a)).toBe(true);
    for (const a of ["16 Amazons Pl, Jindalee", "Jindalee 4074", "Shop 49, DFO Jindalee"]) expect(isPlaceholderAddress(a)).toBe(false);
  });
  it("knows a country- or state-wide match", () => {
    for (const l of ["Australia", "Queensland, Australia", "QLD, Australia", "Queensland"]) expect(isTooVague(l)).toBe(true);
    for (const l of ["Jindalee QLD 4074, Australia", "16 Amazons Pl, Jindalee QLD 4074, Australia", null]) expect(isTooVague(l)).toBe(false);
  });
});

describe("geocodeAddress", () => {
  it("never looks up a placeholder, and refuses the middle of Australia", async () => {
    google();
    expect((await geocodeAddress(db, "--")).status).toBe("failed");
    expect(await geocodeAddress(db, "Nowhere Rd, Nowhereville")).toMatchObject({ status: "failed", lat: null });
  });
});

describe("locateOrder", () => {
  it("finds the business by name when the address is missing, flagged for a check", async () => {
    google({ "Sushi Paradise": SUSHI });
    const r = await locateOrder(db, { address: "--", suburb: null, postcode: null, customerName: "Sushi Paradise (Jindalee DFO)" });
    expect(r).toMatchObject({ status: "approximate", lat: DFO.lat, lng: DFO.lng, label: "SUSHI PARADISE DFO JINDALEE, Shop 49/16 Amazons Pl, Jindalee QLD 4074" });
    expect(placesCalls[0]).toBe("Sushi Paradise Jindalee DFO");
  });

  it("refuses a business match far from the depot", async () => {
    google({ "Far Cafe": { ...SUSHI, location: { latitude: -33.86, longitude: 151.2 } } });
    expect((await locateOrder(db, { address: "--", suburb: null, postcode: null, customerName: "Far Cafe" })).status).toBe("failed");
  });

  it("uses where staff confirmed the customer before", async () => {
    google({ "Corner Deli": SUSHI });
    await db.insert(orders).values({ orderNumber: "OLD1", deliveryDate: "2026-11-01", customerName: "Corner Deli", address: "--", lat: -27.5, lng: 153.0, geocodeStatus: "ok", geocodeLabel: null });
    const r = await locateOrder(db, { address: "--", suburb: null, postcode: null, customerName: "corner deli" });
    expect(r).toMatchObject({ status: "ok", lat: -27.5, lng: 153.0 });
    expect(placesCalls).toEqual([]);
  });

  it("reuses a confirmed business match, with its address for the driver", async () => {
    google();
    const label = "SUSHI PARADISE DFO JINDALEE, Shop 49/16 Amazons Pl, Jindalee QLD 4074";
    await db.insert(orders).values({ orderNumber: "OLD2", deliveryDate: "2026-11-02", customerName: "Sushi Train (Jindalee)", address: "--", lat: DFO.lat, lng: DFO.lng, geocodeStatus: "ok", geocodeLabel: label });
    const r = await locateOrder(db, { address: "--", suburb: null, postcode: null, customerName: "Sushi Train (Jindalee)" });
    expect(r).toMatchObject({ status: "ok", lat: DFO.lat, label });
    expect(placesCalls).toEqual([]);
    expect(shownAddress({ address: "--", geocodeLabel: label })).toBe(label);
    expect(shownAddress({ address: "1 Test St", geocodeLabel: "1 Test St, Sunnybank QLD 4109, Australia" })).toBe("1 Test St");
  });

  it("uses the customer's address on file", async () => {
    google();
    const [c] = await db
      .insert(customers)
      .values({ name: "Noodle Bar", address: "1 Test St, Sunnybank QLD 4109", lat: -27.58, lng: 153.06, geocodeStatus: "ok", geocodeLabel: "1 Test St, Sunnybank QLD 4109, Australia", geocodedAddress: "1 Test St, Sunnybank QLD 4109" })
      .returning();
    const r = await locateOrder(db, { address: "--", suburb: null, postcode: null, customerName: "Noodle Bar", customerId: c.id });
    expect(r).toMatchObject({ status: "ok", lat: -27.58 });
  });

  it("leaves no pin rather than a wrong one", async () => {
    google();
    expect(await locateOrder(db, { address: "--", suburb: null, postcode: null, customerName: "Unknown Shop" })).toMatchObject({ status: "failed", lat: null });
  });
});

describe("checkDayLocations", () => {
  it("moves an order already pinned to 'Australia'", async () => {
    google({ "Sushi Paradise": SUSHI });
    // What the old code cached and saved for an address of "--".
    await db.insert(geocodeCache).values({ query: "au|--", lat: AUSTRALIA.geometry.location.lat, lng: AUSTRALIA.geometry.location.lng, label: "Australia", status: "approximate", provider: "google" }).onConflictDoNothing();
    const [o] = await db
      .insert(orders)
      .values({
        orderNumber: "SO002312",
        deliveryDate: DATE,
        customerName: "Sushi Paradise (Jindalee DFO)",
        address: "--",
        lat: AUSTRALIA.geometry.location.lat,
        lng: AUSTRALIA.geometry.location.lng,
        geocodeStatus: "approximate",
        geocodeLabel: "Australia",
        status: "planned",
      })
      .returning();
    expect(await checkDayLocations(db, DATE)).toBe(1);
    const [after] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(after).toMatchObject({ lat: DFO.lat, lng: DFO.lng, geocodeStatus: "approximate" });
  });
});
