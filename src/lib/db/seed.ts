import { count } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { todayIn } from "../time";
import type { DB } from "./index";
import { depots, drivers, orders, settings, users } from "./schema";

// Approximate suburb centres around Brisbane. Demo data only — not real customers.
const DEMO_SUBURBS: [string, string, number, number][] = [
  ["Fortitude Valley", "4006", -27.457, 153.034],
  ["South Brisbane", "4101", -27.48, 153.02],
  ["West End", "4101", -27.483, 153.009],
  ["Toowong", "4066", -27.485, 152.993],
  ["Indooroopilly", "4068", -27.499, 152.973],
  ["Chermside", "4032", -27.385, 153.031],
  ["Aspley", "4034", -27.366, 153.019],
  ["Nundah", "4012", -27.401, 153.059],
  ["Hamilton", "4007", -27.438, 153.064],
  ["Bulimba", "4171", -27.452, 153.058],
  ["Coorparoo", "4151", -27.494, 153.058],
  ["Carindale", "4152", -27.503, 153.102],
  ["Mount Gravatt", "4122", -27.539, 153.082],
  ["Sunnybank", "4109", -27.578, 153.057],
  ["Moorooka", "4105", -27.535, 153.024],
  ["Annerley", "4103", -27.512, 153.033],
  ["Woolloongabba", "4102", -27.489, 153.036],
  ["Kangaroo Point", "4169", -27.477, 153.036],
  ["Newstead", "4006", -27.445, 153.044],
  ["Albion", "4010", -27.43, 153.043],
  ["Kedron", "4031", -27.405, 153.032],
  ["Stafford", "4053", -27.41, 153.011],
  ["Everton Park", "4053", -27.405, 152.99],
  ["Ashgrove", "4060", -27.444, 152.987],
  ["Paddington", "4064", -27.459, 152.999],
  ["Wynnum", "4178", -27.443, 153.17],
  ["Cannon Hill", "4170", -27.472, 153.094],
  ["Holland Park", "4121", -27.522, 153.068],
  ["Salisbury", "4107", -27.552, 153.033],
  ["Mitchelton", "4053", -27.417, 152.978],
];

const DEPOTS = [
  { name: "Brisbane Warehouse (demo)", address: "Eagle Farm QLD 4009", lat: -27.432, lng: 153.085 },
  { name: "Southside Depot (demo)", address: "Rocklea QLD 4106", lat: -27.545, lng: 153.006 },
];

/** Seeds an empty database with demo users, drivers, depot and today's orders. No-op once any user exists. */
export async function seedDemo(db: DB) {
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n > 0) return;

  await db.update(settings).set({ companyName: "Demo Logistics" });
  const [north, south] = await db.insert(depots).values(DEPOTS).returning();

  const driverRows = await db
    .insert(drivers)
    .values([
      { name: "John Carter", phone: "0400 000 001", vehicle: "Van 1", capacity: 40, color: "#2563eb", depotId: north.id },
      { name: "Mia Nguyen", phone: "0400 000 002", vehicle: "Van 2", capacity: 40, color: "#db2777", depotId: north.id },
      // Small ute based south of the river: allowed to come back and reload once.
      { name: "Sam Patel", phone: "0400 000 003", vehicle: "Ute 3", capacity: 12, maxTrips: 2, color: "#059669", depotId: south.id },
    ])
    .returning();

  const passwordHash = await hashPassword("demo1234");
  await db.insert(users).values([
    { email: "admin@demo.local", name: "Alex Admin", role: "admin", passwordHash },
    { email: "dispatch@demo.local", name: "Dana Dispatcher", role: "dispatcher", passwordHash },
    ...driverRows.map((d) => ({
      email: `${d.name.split(" ")[0].toLowerCase()}@demo.local`,
      name: d.name,
      role: "driver" as const,
      driverId: d.id,
      passwordHash,
    })),
  ]);

  await insertDemoOrders(db, todayIn("Australia/Brisbane"));
}

export async function insertDemoOrders(db: DB, deliveryDate: string) {
  const rows = DEMO_SUBURBS.map(([suburb, postcode, lat, lng], i) => {
    // Small deterministic offset so stops in the same suburb don't overlap on the map.
    const jitter = (k: number) => (((i * 37 + k * 11) % 13) - 6) * 0.0012;
    const n = String(i + 1).padStart(2, "0");
    const morning = i % 7 === 2;
    const afternoon = i % 11 === 5;
    return {
      orderNumber: `DEMO-${deliveryDate.replaceAll("-", "")}-${n}`,
      deliveryDate,
      customerName: `Demo Customer ${n}`,
      phone: `07 3000 00${n}`,
      address: `${suburb} QLD ${postcode}`,
      suburb,
      postcode,
      lat: lat + jitter(1),
      lng: lng + jitter(2),
      geocodeStatus: "ok" as const,
      geocodeLabel: `${suburb}, Queensland ${postcode}, Australia (demo)`,
      windowStartMin: morning ? 8 * 60 : afternoon ? 13 * 60 : null,
      windowEndMin: morning ? 12 * 60 : afternoon ? 16 * 60 : null,
      serviceMin: i % 5 === 0 ? 15 : null,
      demand: 1 + (i % 3),
      priority: i % 9 === 0 ? 1 : 0,
      notes: i % 6 === 0 ? "Loading dock at rear" : null,
    };
  });
  const inserted = await db.insert(orders).values(rows).onConflictDoNothing().returning({ id: orders.id });
  return inserted.length;
}
