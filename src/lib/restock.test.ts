import { describe, expect, it, vi } from "vitest";
import { restockDue } from "./restock";

vi.mock("server-only", () => ({}));

const TODAY = "2026-11-16";
// Every 7 days, last on the 9th.
const weekly = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"];

describe("restockDue", () => {
  it("is due once a usual gap has passed since the last order", () => {
    expect(restockDue(weekly, TODAY, null)).toEqual({ everyDays: 7, days: 7, lastOrderOn: "2026-11-09" });
    expect(restockDue(weekly, "2026-11-15", null)).toBeNull();
  });

  it("sends one per gap: not again until they've ordered", () => {
    expect(restockDue(weekly, TODAY, "2026-11-16")).toBeNull();
    expect(restockDue(weekly, "2026-11-18", "2026-11-16")).toBeNull();
    // Reminded in an earlier gap, before the last order: due again.
    expect(restockDue(weekly, TODAY, "2026-11-05")).not.toBeNull();
  });

  it("leaves customers long past their rhythm to the sales team", () => {
    // Up to two gaps and a week (21 days for weekly), then it's a call, not an email.
    expect(restockDue(weekly, "2026-11-30", null)?.days).toBe(21);
    expect(restockDue(weekly, "2026-12-01", null)).toBeNull();
  });

  it("needs a steady rhythm from a few orders", () => {
    expect(restockDue(["2026-11-02", "2026-11-09"], TODAY, null)).toBeNull();
    // Same day twice (shop order and its delivery) counts once.
    expect(restockDue(["2026-11-02", "2026-11-02", "2026-11-09"], TODAY, null)).toBeNull();
    // Every few months is too far apart to remind.
    expect(restockDue(["2026-05-01", "2026-07-01", "2026-09-01"], "2026-11-05", null)).toBeNull();
  });

  it("counts an upcoming delivery as ordering today", () => {
    expect(restockDue([...weekly, TODAY], TODAY, null)).toBeNull();
  });
});

// The queries and the send, against a real database.
const mail = vi.hoisted(() => ({ sent: [] as { to: string | string[]; subject: string; text: string }[] }));
vi.mock("./email", async (orig) => ({
  ...(await orig<typeof import("./email")>()),
  emailEnabled: () => true,
  sendEmail: async (m: { to: string | string[]; subject: string; text: string }) => (mail.sent.push(m), true),
}));

describe("sendRestockReminders", () => {
  it("emails each regular customer due today once, with what they usually buy", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const { eq } = await import("drizzle-orm");
    const { schema } = await import("./db");
    const { customers, orders, salesOrderItems, salesOrders, settings } = await import("./db/schema");
    const { shiftDate } = await import("./dates");
    const { readUnsubscribeToken, sendRestockReminders } = await import("./restock");
    const { todayIn } = await import("./time");
    const lite = drizzle(new PGlite(), { schema });
    await migrate(lite, { migrationsFolder: "drizzle" });
    const db = lite as unknown as import("./db").DB;
    await db.insert(settings).values({ id: 1, restockReminders: true });
    const today = todayIn("Australia/Brisbane");
    const day = (n: number) => new Date(Date.parse(`${today}T02:00:00Z`) - n * 86_400_000);
    const [due, offed, fresh, phone] = await db
      .insert(customers)
      .values([
        { name: "Due Cafe", email: "due@x.test" },
        { name: "Opted Out", email: "out@x.test", restockEmails: false },
        { name: "Just Ordered", email: "fresh@x.test" },
        { name: "Phone Orders", email: "phone@x.test" },
      ])
      .returning();
    let n = 0;
    const order = async (customerId: string, daysAgo: number) => {
      const [so] = await db
        .insert(salesOrders)
        .values({ number: `SO-${++n}`, customerId, paymentMethod: "invoice", subtotalCents: 1000, deliveryFeeCents: 0, gstCents: 100, totalCents: 1100, deliveryDate: today, recipient: "x", address: "x", idempotencyKey: `k${n}`, createdAt: day(daysAgo) })
        .returning();
      await db.insert(salesOrderItems).values({ salesOrderId: so.id, sku: "CUP", name: "Coffee cups", packSize: "", unit: "carton", unitPriceCents: 1000, qty: 3, gst: true, lineCents: 3000 });
      // Its delivery, two days later: the same order, not another order day.
      const [d] = await db.insert(orders).values({ orderNumber: `D-${n}`, customerId, deliveryDate: shiftDate(today, 2 - daysAgo), address: "x" }).returning();
      await db.update(salesOrders).set({ deliveryOrderId: d.id }).where(eq(salesOrders.id, so.id));
    };
    // Phone and email orders only (no shop order): every 10 days, last 10 days ago.
    for (const d of [40, 30, 20, 10]) await db.insert(orders).values({ orderNumber: `P-${d}`, customerId: phone.id, deliveryDate: shiftDate(today, -d), address: "x" });
    for (const c of [due, offed]) for (const d of [28, 21, 14, 7]) await order(c.id, d);
    for (const d of [21, 14, 7, 0]) await order(fresh.id, d);

    expect(await sendRestockReminders(db)).toEqual({ sent: 2, due: 2 });
    expect(mail.sent.map((m) => m.to).sort()).toEqual(["due@x.test", "phone@x.test"]);
    mail.sent.sort((a, b) => String(a.to).localeCompare(String(b.to)));
    expect(mail.sent[0].text).toContain("3 × carton · Coffee cups");
    // A second run the same day sends nothing.
    expect((await sendRestockReminders(db)).sent).toBe(0);
    // The email's link turns them off for that customer only.
    const token = decodeURIComponent(mail.sent[0].text.match(/unsubscribe\?t=(\S+)/)![1]);
    expect(await readUnsubscribeToken(token)).toBe(due.id);
    expect(await readUnsubscribeToken(token + "x")).toBeNull();
    const [row] = await db.select().from(customers).where(eq(customers.id, due.id));
    expect(row.restockRemindedAt).not.toBeNull();
  }, 30000);
});
