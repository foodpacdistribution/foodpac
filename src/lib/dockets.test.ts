import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "./db";
import { customers, deliveryDockets, depots, drivers, orders, routes, routeStops, settings, users } from "./db/schema";
import { addDocket, cleanRead, deliverDockets, listDockets, readProblem, searchForDocket, updateDocket } from "./dockets";
import { buildShipment } from "./shipments";

const DATE = "2026-11-18";
let db: DB;
let sam: { id: string; driverId: string };
let kim: { id: string; driverId: string };

const photo = { mime: "image/jpeg", data: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) };
const invoice = (over: Partial<ReturnType<typeof cleanRead>> = {}) => async () => ({
  isInvoice: true,
  ...cleanRead({
    invoiceNumber: "INV002276",
    salesOrderNumber: "SO002343",
    customerName: "Sushi Paradise (Toowong)",
    deliveryAddress: "K6/9 Sherwood Rd, Toowong QLD 4066",
    phone: null,
    items: [
      { name: "PAPER BOWL 520ml", qty: 1, unit: "CTN [20.00]" },
      { name: "YANG ZI mini soy sauce", qty: 1, unit: "CTN" },
    ],
    total: 300.83,
  }),
  ...over,
});

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
  vi.stubEnv("AI_GATEWAY_API_KEY", "test");
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  await db.insert(depots).values({ name: "Depot", lat: -27.47, lng: 153.02 });
  const [d1, d2] = await db.insert(drivers).values([{ name: "Sam" }, { name: "Kim" }]).returning();
  const [u1, u2] = await db
    .insert(users)
    .values([
      { email: "sam@example.com", name: "Sam", passwordHash: "x", role: "driver", driverId: d1.id },
      { email: "kim@example.com", name: "Kim", passwordHash: "x", role: "driver", driverId: d2.id },
    ])
    .returning();
  sam = { id: u1.id, driverId: d1.id };
  kim = { id: u2.id, driverId: d2.id };
  await db.insert(customers).values({ name: "Sushi Paradise (Toowong)", address: "K6/9 Sherwood Rd, Toowong QLD 4066", phone: "0412 345 678", lat: -27.485, lng: 152.99, geocodeStatus: "ok", geocodedAddress: "K6/9 Sherwood Rd, Toowong QLD 4066" });
});

describe("cleanRead", () => {
  it("tidies numbers, units, money and blanks", () => {
    const r = cleanRead({
      invoiceNumber: " inv 002276 ",
      salesOrderNumber: "N/A",
      customerName: "  Sushi   Paradise ",
      deliveryAddress: "",
      items: [{ name: "Bowl", qty: 2, unit: "CTN [8.00]" }, { name: " ", qty: 1, unit: null }, { name: "Lid", qty: -1, unit: null }],
      total: 300.834,
    });
    expect(r).toEqual({
      invoiceNumber: "INV002276",
      salesOrderNumber: null,
      customerName: "Sushi Paradise",
      address: null,
      phone: null,
      goods: [
        { name: "Bowl", qty: 2, unit: "CTN" },
        { name: "Lid", qty: null, unit: null },
      ],
      totalCents: 30083,
    });
  });
});

describe("photographed invoices", () => {
  it("reads the photo and matches the customer on file", async () => {
    const id = await addDocket(db, sam, photo, DATE, invoice());
    const [d] = await db.select().from(deliveryDockets).where(eq(deliveryDockets.id, id));
    expect(d.readStatus).toBe("read");
    expect(d.orderNumber).toBe("INV002276");
    expect(d.customerId).not.toBeNull();
    expect(d.phone).toBe("0412 345 678"); // from the customer on file
    expect(d.goods).toHaveLength(2);
    expect(d.totalCents).toBe(30083);
  });

  it("keeps the photo when it can't be read, for the driver to type in", async () => {
    const id = await addDocket(db, sam, photo, DATE, async () => {
      throw new Error("gateway down");
    });
    const [d] = await db.select().from(deliveryDockets).where(eq(deliveryDockets.id, id));
    expect(d.readStatus).toBe("unread");
    expect(d.readError).toMatch(/Couldn't read/);
    await expect(deliverDockets(db, sam, [id], DATE)).resolves.toEqual([{ id, ok: false, error: "Add the customer and the address first." }]);
    await updateDocket(db, sam, id, { orderNumber: "inv 9001", customerName: "sushi paradise toowong", address: null, phone: null });
    const [e] = await db.select().from(deliveryDockets).where(eq(deliveryDockets.id, id));
    expect(e.orderNumber).toBe("INV9001");
    expect(e.address).toBe("K6/9 Sherwood Rd, Toowong QLD 4066");
  });

  it("puts them on the driver's route and sends it to their phone", async () => {
    const mine = await db.select({ id: deliveryDockets.id }).from(deliveryDockets).where(eq(deliveryDockets.driverId, sam.driverId));
    const res = await deliverDockets(db, sam, mine.map((d) => d.id), DATE);
    expect(res.filter((r) => !r.ok)).toEqual([]);
    const [route] = await db.select().from(routes).where(eq(routes.driverId, sam.driverId));
    expect(route.dispatchedAt).not.toBeNull();
    const stops = await db.select({ n: orders.orderNumber, status: orders.status, source: orders.source }).from(routeStops).innerJoin(orders, eq(orders.id, routeStops.orderId)).where(eq(routeStops.routeId, route.id));
    expect(stops.map((s) => s.n).sort()).toEqual(["INV002276", "INV9001"]);
    expect(stops.every((s) => s.status === "dispatched" && s.source === "docket")).toBe(true);

    const list = await listDockets(db, DATE, sam.driverId);
    expect(list.every((d) => d.added && d.delivery?.status === "dispatched")).toBe(true);
    // Added once: a second tap changes nothing.
    await expect(deliverDockets(db, sam, mine.map((d) => d.id), DATE)).resolves.toEqual([]);
  });

  it("takes over the office's delivery for the same invoice, also from another driver", async () => {
    const [o] = await db
      .insert(orders)
      .values({ orderNumber: "INV5000", deliveryDate: DATE, customerName: "Noodle Bar", address: "1 Queen St, Brisbane QLD 4000", lat: -27.47, lng: 153.025, geocodeStatus: "ok" })
      .returning();
    await buildShipment(db, DATE, kim.driverId, [o.id]);
    const id = await addDocket(db, sam, photo, DATE, invoice({ invoiceNumber: "INV5000", customerName: "Noodle Bar", address: "1 Queen St, Brisbane QLD 4000", goods: [] }));
    const res = await deliverDockets(db, sam, [id], DATE);
    expect(res).toEqual([{ id, ok: true }]);
    const [after] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(after.driverId).toBe(sam.driverId);
    expect(await db.select().from(orders).where(eq(orders.orderNumber, "INV5000"))).toHaveLength(1);
  });

  it("won't add an invoice that's already been delivered", async () => {
    await db.update(orders).set({ status: "delivered" }).where(eq(orders.orderNumber, "INV5000"));
    const id = await addDocket(db, kim, photo, DATE, invoice({ invoiceNumber: "INV5000", customerName: "Noodle Bar", address: "1 Queen St, Brisbane QLD 4000" }));
    const [r] = await deliverDockets(db, kim, [id], DATE);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already been delivered/);
  });

  it("asks for a better address when it can't be found", async () => {
    const id = await addDocket(db, kim, photo, DATE, invoice({ invoiceNumber: "INV7777", customerName: "Unknown Shop", address: "Somewhere", goods: [] }));
    const [r] = await deliverDockets(db, kim, [id], DATE);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't find this address/) });
  });

  it("only lets the driver deliver their own photos", async () => {
    const [samDocket] = await db.insert(deliveryDockets).values({ driverId: sam.driverId, deliveryDate: DATE, mime: "image/jpeg", bytes: 1, data: photo.data, customerName: "X", address: "Y" }).returning();
    await expect(deliverDockets(db, kim, [samDocket.id], DATE)).resolves.toEqual([]);
    await expect(updateDocket(db, kim, samDocket.id, { orderNumber: null, customerName: "Z", address: "Z", phone: null })).rejects.toThrow(/gone/);
  });
});

describe("picking instead of typing", () => {
  it("finds today's deliveries by invoice number and customers by name, code or phone", async () => {
    await db.insert(orders).values({ orderNumber: "INV8080", deliveryDate: DATE, customerName: "Dumpling House", address: "5 Main St, Sunnybank QLD 4109" });
    await db.insert(customers).values({ name: "Dumpling House", address: "5 Main St, Sunnybank QLD 4109", lat: -27.58, lng: 153.06, geocodeStatus: "ok", geocodedAddress: "5 Main St, Sunnybank QLD 4109" });
    const byNumber = await searchForDocket(db, "inv80", DATE);
    expect(byNumber).toEqual([expect.objectContaining({ kind: "order", orderNumber: "INV8080", customerName: "Dumpling House", driver: null })]);
    expect(await searchForDocket(db, "inv80", "2026-11-19")).toEqual([]);
    // Today's deliveries for them first (already on Sam's route), then the customer on file.
    const byName = await searchForDocket(db, "sushi par", DATE);
    expect(byName.map((h) => h.kind)).toEqual(["order", "order", "customer"]);
    expect(byName.at(-1)).toMatchObject({ customerName: "Sushi Paradise (Toowong)", address: "K6/9 Sherwood Rd, Toowong QLD 4066", code: expect.any(String) });
    expect(await searchForDocket(db, "0412345", DATE)).toEqual([expect.objectContaining({ kind: "customer", customerName: "Sushi Paradise (Toowong)" })]);
    expect(await searchForDocket(db, "x", DATE)).toEqual([]);
    expect(await searchForDocket(db, "100%_", DATE)).toEqual([]);
  });

  it("picking a delivery makes the docket that exact delivery", async () => {
    const id = await addDocket(db, kim, photo, DATE, async () => {
      throw Object.assign(new Error("Unauthenticated request to AI Gateway"), { statusCode: 401 });
    });
    const [failed] = await db.select().from(deliveryDockets).where(eq(deliveryDockets.id, id));
    expect(failed.readProblem).toMatch(/not switched on/);
    const [pick] = await searchForDocket(db, "INV8080", DATE);
    if (pick.kind !== "order") throw new Error("expected an order");
    await updateDocket(db, kim, id, { orderNumber: pick.orderNumber, customerName: pick.customerName, address: pick.address, phone: pick.phone, customerId: pick.customerId });
    // The office's order had no pin yet: it's placed from the customer on file, then routed.
    await expect(deliverDockets(db, kim, [id], DATE)).resolves.toEqual([{ id, ok: true }]);
    const same = await db.select().from(orders).where(eq(orders.orderNumber, "INV8080"));
    expect(same).toHaveLength(1);
    expect(same[0]).toMatchObject({ driverId: kim.driverId, status: "dispatched", lat: -27.58 });
  });
});

describe("readProblem", () => {
  it("says what the office can do about it", () => {
    expect(readProblem(Object.assign(new Error("x"), { statusCode: 402 }))).toMatch(/out of credit/);
    expect(readProblem(Object.assign(new Error("x"), { statusCode: 403 }))).toMatch(/not switched on/);
    expect(readProblem(new Error("The operation was aborted due to timeout"))).toMatch(/too long/);
  });
});
