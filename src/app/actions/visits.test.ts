import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "@/lib/db";
import { customers, customerVisitPhotos, customerVisits, settings, users } from "@/lib/db/schema";
import { shiftDate } from "@/lib/dates";
import { todayIn } from "@/lib/time";

// Logging store visits: the visit, its photos, and the stage and reminder it sets.

const state = { db: null as unknown as DB, user: null as unknown as { id: string; role: string } };
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/dal")>();
  return {
    ...real,
    assertUser: async (roles: string[]) => {
      if (!roles.includes(state.user.role)) throw new real.AuthError("Not authorised");
      return state.user;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { logVisit, deleteVisit } = await import("./visits");
const { loadPipeline } = await import("@/lib/pipeline");

let sam: string;
let kim: string;
let admin: string;
let mine: string;
let theirs: string;
let nobodys: string;
let today: string;

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const visit = (fields: Record<string, string>, photos = 0) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  for (let i = 0; i < photos; i++) f.append("photo", new File([jpeg], `p${i}.jpg`, { type: "image/jpeg" }));
  return logVisit(f);
};
const customer = async (id: string) => (await state.db.select().from(customers).where(eq(customers.id, id)))[0];
const as = (id: string, role = "sales") => (state.user = { id, role });

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  state.db = lite as unknown as DB;
  await state.db.insert(settings).values({ id: 1 });
  today = todayIn("Australia/Brisbane");
  [{ id: sam }, { id: kim }, { id: admin }] = await state.db
    .insert(users)
    .values([
      { email: "sam@x.test", name: "Sam", role: "sales", passwordHash: "x" },
      { email: "kim@x.test", name: "Kim", role: "sales", passwordHash: "x" },
      { email: "boss@x.test", name: "Boss", role: "admin", passwordHash: "x" },
    ])
    .returning();
  [{ id: mine }, { id: theirs }, { id: nobodys }] = await state.db
    .insert(customers)
    .values([{ name: "Sam's Shop", salesRepId: sam }, { name: "Kim's Shop", salesRepId: kim }, { name: "Nobody's Shop" }])
    .returning();
  as(sam);
}, 30000);

describe("logging a visit", () => {
  it("records it with photos and where, moves the customer along and sets the reminder", async () => {
    const on = shiftDate(today, 3);
    const r = await visit({ customerId: mine, outcome: "samples", note: "Linda liked the 8oz cups", followUpOn: on, lat: "-27.5", lng: "153.0" }, 2);
    expect(r).toMatchObject({ ok: true, data: { stage: "interested", followUpOn: on } });
    const c = await customer(mine);
    expect(c).toMatchObject({ salesStage: "interested", followUpOn: on, followUpNote: "Linda liked the 8oz cups" });
    expect(c.contactedAt).not.toBeNull();
    const [v] = await state.db.select().from(customerVisits).where(eq(customerVisits.customerId, mine));
    expect(v).toMatchObject({ outcome: "samples", channel: "visit", userId: sam, lat: -27.5, lng: 153 });
    expect(await state.db.select().from(customerVisitPhotos).where(eq(customerVisitPhotos.visitId, v.id))).toHaveLength(2);
  });

  it("keeps no location for a phone call", async () => {
    await visit({ customerId: mine, channel: "call", outcome: "thinking", lat: "-27.5", lng: "153.0" });
    const [v] = await state.db.select().from(customerVisits).where(eq(customerVisits.outcome, "thinking"));
    expect(v).toMatchObject({ channel: "call", lat: null, lng: null });
    // No reminder picked: any earlier one is cleared.
    expect((await customer(mine)).followUpOn).toBeNull();
  });

  it("needs a reason for not now, and keeps the store out of the follow-ups until the day to try again", async () => {
    expect(await visit({ customerId: mine, outcome: "not_now" })).toMatchObject({ ok: false });
    const later = shiftDate(today, 90);
    expect(await visit({ customerId: mine, outcome: "not_now", reason: "price", followUpOn: later })).toMatchObject({ ok: true, data: { stage: "not_now" } });
    expect(await customer(mine)).toMatchObject({ salesStage: "not_now", notNowReason: "price", followUpNote: "Price" });
    const row = (await loadPipeline(state.db)).customers.find((c) => c.id === mine)!;
    expect(row.due).toBeNull();
    expect(row.lastVisit).toMatchObject({ outcome: "not_now", day: today });
  });

  it("clears the reason once they come round", async () => {
    await visit({ customerId: mine, outcome: "ordered" });
    expect(await customer(mine)).toMatchObject({ salesStage: "won", notNowReason: null, followUpOn: null });
  });

  it("refuses a reminder in the past and an unknown result", async () => {
    expect(await visit({ customerId: mine, outcome: "interested", followUpOn: shiftDate(today, -1) })).toMatchObject({ ok: false });
    expect(await visit({ customerId: mine, outcome: "great" })).toMatchObject({ ok: false });
  });

  it("takes on an unassigned customer, but not another salesperson's", async () => {
    expect(await visit({ customerId: nobodys, outcome: "not_in" })).toMatchObject({ ok: true });
    expect((await customer(nobodys)).salesRepId).toBe(sam);
    expect(await visit({ customerId: theirs, outcome: "interested" })).toMatchObject({ ok: false, error: expect.stringContaining("Another salesperson") });
  });
});

describe("visits logged with no signal and sent later", () => {
  it("are kept once when sent twice", async () => {
    const clientId = "0b0e5a4e-1c1a-4a52-9e0e-8d1f3c2b7a11";
    const first = await visit({ customerId: nobodys, outcome: "interested", clientId }, 1);
    const again = await visit({ customerId: nobodys, outcome: "interested", clientId }, 1);
    expect(first).toMatchObject({ ok: true });
    expect(again).toMatchObject({ ok: true });
    expect(await state.db.select().from(customerVisits).where(eq(customerVisits.id, clientId))).toHaveLength(1);
    expect(await state.db.select().from(customerVisitPhotos).where(eq(customerVisitPhotos.visitId, clientId))).toHaveLength(1);
  });

  it("keep when they happened, and their reminder counts from that day", async () => {
    const clientId = "5c7d9e1f-2a3b-4c5d-8e9f-0a1b2c3d4e5f";
    const at = new Date(Date.now() - 3 * 86_400_000);
    const visitDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(at);
    // Two days after the visit: already past today, but fine for a visit three days ago.
    const r = await visit({ customerId: nobodys, outcome: "samples", clientId, at: at.toISOString(), followUpOn: shiftDate(visitDay, 2) });
    expect(r).toMatchObject({ ok: true });
    const [v] = await state.db.select().from(customerVisits).where(eq(customerVisits.id, clientId));
    expect(Math.abs(v.createdAt.getTime() - at.getTime())).toBeLessThan(1000);
    // A later visit already counted as the last contact: a late one doesn't move it back.
    expect((await customer(nobodys)).contactedAt!.getTime()).toBeGreaterThan(at.getTime());
  });

  it("can't claim a time far in the past or in the future", async () => {
    const clientId = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    await visit({ customerId: nobodys, outcome: "not_in", clientId, at: new Date(Date.now() - 60 * 86_400_000).toISOString() });
    const [v] = await state.db.select().from(customerVisits).where(eq(customerVisits.id, clientId));
    expect(Date.now() - v.createdAt.getTime()).toBeLessThan(60_000);
  });
});

describe("the store's kind", () => {
  it("is saved with a visit when the form asked for it, and left alone otherwise", async () => {
    await visit({ customerId: mine, outcome: "interested", storeType: "bubble_tea" });
    expect((await customer(mine)).storeType).toBe("bubble_tea");
    await visit({ customerId: mine, outcome: "thinking" });
    await visit({ customerId: mine, outcome: "thinking", storeType: "not-a-type" });
    expect((await customer(mine)).storeType).toBe("bubble_tea");
  });
});

describe("deleting a visit", () => {
  it("is for the person who logged it, or an admin", async () => {
    const [v] = await state.db.select().from(customerVisits).where(eq(customerVisits.customerId, nobodys));
    as(kim);
    expect(await deleteVisit(v.id)).toMatchObject({ ok: false });
    as(admin, "admin");
    expect(await deleteVisit(v.id)).toMatchObject({ ok: true });
    expect(await state.db.select().from(customerVisits).where(eq(customerVisits.id, v.id))).toHaveLength(0);
    as(sam);
  });
});
