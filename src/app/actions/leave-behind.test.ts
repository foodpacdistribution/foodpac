import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "@/lib/db";
import { customers, settings, users } from "@/lib/db/schema";

// The leave-behind's QR code: a signed reference to the salesperson (and store), and sign-ups
// through it.

const state = { db: null as unknown as DB };
const requested: string[] = [];
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: async () => state.db }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "10.0.0.1" }), cookies: async () => ({ set: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));
vi.mock("@/lib/notify", () => ({ accountRequested: async (c: { name: string }) => void requested.push(c.name), orderConfirmed: async () => {} }));
vi.mock("@/lib/customer-locations", () => ({ locateCustomersLater: () => {} }));

const { leaveBehindRef, readLeaveBehindRef } = await import("@/lib/leave-behind");
const { registerCustomer } = await import("./shop");

let sam: string;
let lead: string;
let n = 0;

const signUp = (ref: string | null, business = "Noodle Bar") => {
  const f = new FormData();
  f.set("business", business);
  f.set("name", "Mei");
  f.set("email", `mei${++n}@shop.test`);
  f.set("password", "longenough");
  f.set("phone", "0400 000 000");
  if (ref) f.set("ref", ref);
  return registerCustomer(null, f);
};
const byEmail = async (email: string) => {
  const [u] = await state.db.select().from(users).where(eq(users.email, email));
  return (await state.db.select().from(customers).where(eq(customers.id, u.customerId!)))[0];
};

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  state.db = lite as unknown as DB;
  await state.db.insert(settings).values({ id: 1 });
  [{ id: sam }] = await state.db.insert(users).values({ email: "sam@x.test", name: "Sam Lee", role: "sales", passwordHash: "x" }).returning();
  [{ id: lead }] = await state.db.insert(customers).values({ name: "Golden Dumpling", address: "1 Main St" }).returning();
}, 30000);

describe("the leave-behind reference", () => {
  it("is short, and says who left it and for which store", async () => {
    const ref = leaveBehindRef(sam, lead);
    expect(ref.length).toBeLessThanOrEqual(29);
    expect(await readLeaveBehindRef(state.db, ref)).toMatchObject({ rep: { id: sam, name: "Sam Lee" }, customer: { id: lead, name: "Golden Dumpling", hasLogin: false } });
    expect(await readLeaveBehindRef(state.db, leaveBehindRef(sam))).toMatchObject({ rep: { id: sam }, customer: null });
  });

  it("can't be made up or pointed at another store", async () => {
    const ref = leaveBehindRef(sam, lead);
    expect(await readLeaveBehindRef(state.db, ref.slice(0, -1) + (ref.endsWith("A") ? "B" : "A"))).toBeNull();
    const other = "00000000" + ref.slice(16);
    expect(await readLeaveBehindRef(state.db, ref.slice(0, 8) + other)).toBeNull();
    expect(await readLeaveBehindRef(state.db, "nonsense")).toBeNull();
  });
});

describe("signing up from a leave-behind", () => {
  it("makes the new account the salesperson's", async () => {
    expect(await signUp(leaveBehindRef(sam), "Bubble Tea Co")).toMatchObject({ ok: true });
    expect(await byEmail(`mei${n}@shop.test`)).toMatchObject({ name: "Bubble Tea Co", salesRepId: sam, salesStage: "interested", approved: false, registeredOnline: true });
    expect(requested).toContain("Bubble Tea Co");
  });

  it("joins the store's own record instead of adding it again, and only once", async () => {
    const before = (await state.db.select().from(customers)).length;
    expect(await signUp(leaveBehindRef(sam, lead), "Golden Dumpling")).toMatchObject({ ok: true });
    expect((await state.db.select().from(customers)).length).toBe(before);
    const c = await byEmail(`mei${n}@shop.test`);
    // Staff-added and already approved: stays approved, keeps its address, gains the phone.
    expect(c).toMatchObject({ id: lead, salesRepId: sam, approved: true, address: "1 Main St", phone: "0400 000 000", registeredOnline: true });
    expect(await signUp(leaveBehindRef(sam, lead))).toMatchObject({ ok: false, error: expect.stringContaining("already has an account") });
  });

  it("still works as an ordinary sign-up with a bad reference", async () => {
    expect(await signUp("abcdef12.xxxxxxxxxxxx", "Corner Cafe")).toMatchObject({ ok: true });
    expect(await byEmail(`mei${n}@shop.test`)).toMatchObject({ name: "Corner Cafe", salesRepId: null, salesStage: "new" });
  });
});
