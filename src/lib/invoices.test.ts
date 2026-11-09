import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DB } from "./db";
import { schema } from "./db";
import { customers, deliveryEvents, deliveryProofs, products, salesOrders, settings, users } from "./db/schema";
import { accountStatement, finaliseInvoice, invoiceDelivery, reopenInvoice } from "./invoices";
import { sendInvoice } from "./notify";
import { cancelOrder } from "./shop";
import { createStaffOrder, updateStaffOrder } from "./staff-orders";

let db: DB;
let cust: string;
let staff: string;
let cups: string;
const today = "2026-11-10";
let key = 0;

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  await db.insert(settings).values({ id: 1, bankDetails: "BSB 123-456 Acc 7890" }).onConflictDoNothing();
  [{ id: staff }] = await db.insert(users).values({ email: "office@x.test", name: "Office", role: "admin", passwordHash: "x" }).returning({ id: users.id });
  [{ id: cust }] = await db.insert(customers).values({ name: "Lucky Noodle Bar", email: "accounts@lucky.test", paymentTerms: "net14" }).returning({ id: customers.id });
  [{ id: cups }] = await db.insert(products).values({ sku: "CUP8", name: "Cup 8 oz", priceCents: 4000, stock: 100 }).returning({ id: products.id });
}, 30000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const base = { deliveryDate: "2026-11-12", recipient: "Mei", phone: null, address: "1 Main St, Sunnybank", instructions: null, windowStartMin: null, windowEndMin: null, notes: null, deliveryFeeCents: 0 };
const place = (qty: number) =>
  createStaffOrder(db, staff, { ...base, customerId: cust, lines: [{ productId: cups, qty, unitPriceCents: 1000 }], method: "invoice", idempotencyKey: `k${++key}` }, today);
const get = async (id: string) => (await db.select().from(salesOrders).where(eq(salesOrders.id, id)))[0];

describe("proforma → final invoice", () => {
  it("starts as a proforma that can still be changed", async () => {
    const so = await place(2);
    expect(so.invoiceStatus).toBe("proforma");
    await updateStaffOrder(db, so.id, { ...base, lines: [{ productId: cups, qty: 3, unitPriceCents: 1000 }] }, today);
    expect((await get(so.id)).subtotalCents).toBe(3000);
  });

  it("locks the order once final, and unlocks it when reopened", async () => {
    const so = await place(2);
    const issued = new Date("2026-11-10T03:00:00Z");
    const f = await finaliseInvoice(db, so.id, issued);
    expect(f).toMatchObject({ invoiceStatus: "final", invoicedAt: issued });
    await expect(updateStaffOrder(db, so.id, { ...base, lines: [{ productId: cups, qty: 5, unitPriceCents: 1000 }] }, today)).rejects.toThrow(/final/);
    await expect(finaliseInvoice(db, so.id)).rejects.toThrow(/already final/);

    await reopenInvoice(db, so.id);
    expect(await get(so.id)).toMatchObject({ invoiceStatus: "proforma", invoicedAt: null, invoiceSentAt: null });
    await updateStaffOrder(db, so.id, { ...base, lines: [{ productId: cups, qty: 5, unitPriceCents: 1000 }] }, today);
    expect((await get(so.id)).subtotalCents).toBe(5000);
  });

  it("won't finalise a cancelled order or reopen a paid invoice", async () => {
    const gone = await place(1);
    await cancelOrder(db, gone.id);
    await expect(finaliseInvoice(db, gone.id)).rejects.toThrow(/cancelled/);

    const paid = await place(1);
    await finaliseInvoice(db, paid.id);
    await db.update(salesOrders).set({ paymentStatus: "paid", paidAt: new Date() }).where(eq(salesOrders.id, paid.id));
    await expect(reopenInvoice(db, paid.id)).rejects.toThrow(/paid/);
  });
});

describe("statement of account", () => {
  it("lists final unpaid invoices only, flagging overdue ones", async () => {
    const before = await accountStatement(db, cust, today);
    const old = await place(4); // due 26 Nov
    await finaliseInvoice(db, old.id, new Date("2026-11-01T00:00:00Z"));
    await place(9); // still a proforma: not on the statement
    const s = await accountStatement(db, cust, "2026-11-30");
    expect(s.invoices.length).toBe(before.invoices.length + 1);
    expect(s.invoices.find((r) => r.id === old.id)).toMatchObject({ totalCents: 4400, overdue: true });
    expect(s.owingCents - before.owingCents).toBe(4400);
  });
});

describe("emailing the final invoice", () => {
  it("refuses a proforma", async () => {
    const so = await place(1);
    expect(await sendInvoice(db, so.id)).toMatchObject({ sent: false, reason: expect.stringMatching(/Finalise/) });
  });

  it("sends the invoice with the statement and records when it went", async () => {
    vi.stubEnv("RESEND_API_KEY", "test");
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const so = await place(2);
    await finaliseInvoice(db, so.id);
    const r = await sendInvoice(db, so.id);
    expect(r).toEqual({ sent: true, to: "accounts@lucky.test" });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.to).toBe("accounts@lucky.test");
    expect(body.subject).toContain(`Tax invoice ${so.number}`);
    expect(body.html).toContain("Statement of account");
    expect(body.html).toContain("(this invoice)");
    expect(body.text).toMatch(/Total owing \$/);
    expect(await get(so.id)).toMatchObject({ invoiceSentTo: "accounts@lucky.test" });
    expect((await get(so.id)).invoiceSentAt).toBeInstanceOf(Date);
  });

  it("doesn't record a send that failed", async () => {
    vi.stubEnv("RESEND_API_KEY", "test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const so = await place(1);
    await finaliseInvoice(db, so.id);
    expect((await sendInvoice(db, so.id)).sent).toBe(false);
    expect((await get(so.id)).invoiceSentAt).toBeNull();
  });
});

describe("proof of delivery on the invoice", () => {
  it("is empty until delivered, then shows who signed, when, and the signature", async () => {
    const so = await get((await place(1)).id);
    expect(so.deliveryOrderId).toBeTruthy();
    expect(await invoiceDelivery(db, so, "Australia/Brisbane")).toBeNull();

    const [ev] = await db
      .insert(deliveryEvents)
      .values({ orderId: so.deliveryOrderId!, type: "delivered", recipient: "Mei", createdAt: new Date("2026-11-12T00:42:00Z") })
      .returning();
    const [sig] = await db
      .insert(deliveryProofs)
      .values({ orderId: so.deliveryOrderId!, eventId: ev.id, kind: "signature", mime: "image/png", bytes: 3, data: new Uint8Array([1, 2, 3]), sha256: "x" })
      .returning({ id: deliveryProofs.id });

    expect(await invoiceDelivery(db, so, "Australia/Brisbane")).toEqual({
      at: "12 November 2026 at 10:42 am",
      recipient: "Mei",
      signatureUrl: `/api/proofs/${sig.id}`,
    });
  });
});
