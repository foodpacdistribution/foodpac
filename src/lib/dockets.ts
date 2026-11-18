import "server-only";
import { generateText, Output } from "ai";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "./db";
import {
  customers,
  deliveryDockets,
  deliveryEvents,
  deliveryProofs,
  type DocketRead,
  type DocketReadStatus,
  drivers,
  type GoodsLine,
  orders,
  plans,
  routes,
  routeStops,
  salesOrders,
} from "./db/schema";
import { locateOrder, postcodeOf } from "./geo/geocode";
import { nameLikeness, parseInvoiceText } from "./invoice-text";
import { UserError } from "./planning";
import { buildShipment, sendShipment, transferOrder } from "./shipments";

// A driver photographs the paper invoices they've been handed (one or a whole stack), the
// photos are read for the invoice number, customer, address and goods, the driver checks what
// was read, and then they go on the driver's route for today like any other delivery: same stop
// list, proof of delivery and live tracking, and the office sees each photo with its delivery.

/** At most this many photos at a time, so one tap can't run up a big reading bill. */
export const MAX_DOCKETS_AT_ONCE = 30;

/** The model that reads the photos (through the Vercel AI Gateway). */
const MODEL = process.env.DOCKET_MODEL || "anthropic/claude-sonnet-5.5";

/** Reading needs the AI Gateway: a key, or (on Vercel) the deployment's own OIDC token. */
export function canReadPhotos() {
  return !!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);
}

const readSchema = z.object({
  isInvoice: z.boolean().describe("true when the photo shows an invoice, delivery docket or sales order"),
  invoiceNumber: z.string().nullable().describe("The invoice number, e.g. INV002276"),
  salesOrderNumber: z.string().nullable().describe("The sales order number, e.g. SO002343"),
  customerName: z.string().nullable().describe("The customer's business name as printed, e.g. Sushi Paradise (Toowong)"),
  deliveryAddress: z
    .string()
    .nullable()
    .describe("Where the goods go: the SHIP TO / deliver to address (else the BILL TO address), on one line: street, suburb, state, postcode. No repeated suburb."),
  phone: z.string().nullable(),
  items: z
    .array(
      z.object({
        name: z.string().describe("The product line as printed (both languages if printed in two)"),
        qty: z.number().nullable(),
        unit: z.string().nullable().describe("The unit, e.g. CTN, PK, BAG (without the bracketed pack count)"),
      }),
    )
    .describe("Every line of goods, in order"),
  total: z.number().nullable().describe("The invoice amount / amount due in dollars, including GST"),
});

const PROMPT = `This is a photo a delivery driver took of a paper invoice for a delivery in Australia.
Read it exactly as printed. Leave a field null if it isn't on the page or can't be read; never guess.
Ignore the supplier's own details (Foodpac Distribution is the supplier, not the customer).`;

const text = (v: unknown, max: number) => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s && !/^(n\/?a|null|none|-+)$/i.test(s) ? s.slice(0, max) : null;
};

/** Tidies what the model returned into what's stored (pure, so it's tested without a model). */
export function cleanRead(raw: Partial<z.infer<typeof readSchema>>): DocketRead {
  const goods: GoodsLine[] = (raw.items ?? [])
    .map((it) => ({
      name: text(it?.name, 200) ?? "",
      qty: typeof it?.qty === "number" && Number.isFinite(it.qty) && it.qty > 0 ? Math.round(it.qty * 100) / 100 : null,
      unit: text(it?.unit, 20)?.replace(/\s*\[.*$/, "") || null,
    }))
    .filter((g) => g.name)
    .slice(0, 80);
  const total = typeof raw.total === "number" && Number.isFinite(raw.total) && raw.total >= 0 ? Math.round(raw.total * 100) : null;
  const num = (v: unknown) => text(v, 40)?.replace(/\s+/g, "").toUpperCase() ?? null;
  return {
    invoiceNumber: num(raw.invoiceNumber),
    salesOrderNumber: num(raw.salesOrderNumber),
    customerName: text(raw.customerName, 200),
    address: text(raw.deliveryAddress, 300),
    phone: text(raw.phone, 40),
    goods,
    totalCents: total,
  };
}

/** Reads one invoice photo. Throws when the model can't be reached. */
export async function readInvoicePhoto(data: Uint8Array, mime: string): Promise<DocketRead & { isInvoice: boolean }> {
  const { output } = await generateText({
    model: MODEL,
    output: Output.object({ schema: readSchema }),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image", image: data, mediaType: mime },
        ],
      },
    ],
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(90_000),
    providerOptions: { gateway: { tags: ["feature:docket-reading"] } },
  });
  return { ...cleanRead(output), isInvoice: output.isInvoice };
}

/** Why the model couldn't be used, in a line the office can act on. */
export function readProblem(err: unknown): string {
  const e = err as { statusCode?: number; message?: string; name?: string; cause?: unknown } | null;
  const status = e?.statusCode;
  const msg = (e?.message ?? String(err)).replace(/\s+/g, " ").slice(0, 240);
  if (status === 401 || status === 403 || /oidc|authenticat|api key/i.test(msg)) return `AI Gateway refused the request (not switched on for this project, or no key): ${msg}`;
  if (status === 402 || /credit|payment|billing/i.test(msg)) return `AI Gateway is out of credit: ${msg}`;
  if (status === 429) return `AI Gateway rate limit: ${msg}`;
  if (/timeout|abort/i.test(msg) || e?.name === "TimeoutError") return `Reading took too long: ${msg}`;
  return status ? `AI Gateway error ${status}: ${msg}` : msg;
}

const nameKey = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");

/** The one customer this invoice is for: same name (ignoring case, spaces and punctuation), else same phone. */
export async function matchCustomer(db: DB, name: string | null, phone: string | null) {
  const key = name ? nameKey(name) : "";
  if (key) {
    const rows = await db
      .select({ id: customers.id, name: customers.name, address: customers.address, phone: customers.phone })
      .from(customers)
      .where(sql`lower(regexp_replace(${customers.name}, '[[:space:][:punct:]]+', '', 'g')) = ${key}`)
      .limit(2);
    if (rows.length === 1) return rows[0];
  }
  const tel = digits(phone).slice(-9);
  if (tel.length >= 8) {
    const rows = await db
      .select({ id: customers.id, name: customers.name, address: customers.address, phone: customers.phone })
      .from(customers)
      .where(sql`right(regexp_replace(coalesce(${customers.phone}, ''), '\\D', '', 'g'), 9) = ${tel}`)
      .limit(2);
    if (rows.length === 1) return rows[0];
  }
  return null;
}

type Who = { id: string; driverId: string | null };

/**
 * Saves a photographed invoice and reads it. The photo is kept even when reading fails (no
 * signal to the model, not set up, a blurry photo): the driver then types the details in.
 */
/** After the AI Gateway refuses (no card, no key), don't ask it again for a while. */
let aiRestingUntil = 0;

/**
 * Saves a photographed invoice and reads it: with the AI model when it's available, else from
 * the text the phone recognised in the photo (`text`). The invoice number finds the office's
 * delivery for it today, whose customer, address and goods are then used as they are; else the
 * customer is matched to one on file (allowing for misread letters) and their address used. The
 * photo is kept whatever happens: the driver can always pick or type the details in.
 */
export async function addDocket(
  db: DB,
  who: Who,
  photo: { mime: string; data: Uint8Array },
  date: string,
  read: typeof readInvoicePhoto | null = readInvoicePhoto,
  text: string | null = null,
) {
  if (!who.driverId) throw new UserError("Your login isn't linked to a driver. Ask the office to link it.");
  const [row] = await db
    .insert(deliveryDockets)
    .values({ driverId: who.driverId, userId: who.id, deliveryDate: date, mime: photo.mime, bytes: photo.data.byteLength, data: photo.data })
    .returning({ id: deliveryDockets.id });
  let problem: string | null = null;
  let got: DocketRead | null = null;
  let postcode: string | null = null;
  let notInvoice = false;
  if (read && canReadPhotos() && Date.now() >= aiRestingUntil) {
    try {
      const r = await read(photo.data, photo.mime);
      if (!r.isInvoice && !r.customerName && !r.invoiceNumber) notInvoice = true;
      else got = r;
    } catch (err) {
      console.error("[docket read]", err);
      problem = readProblem(err);
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 401 || status === 402 || status === 403) aiRestingUntil = Date.now() + 10 * 60_000;
    }
  }
  if (!got && text?.trim()) {
    const t = parseInvoiceText(text.slice(0, 20_000));
    if (t.invoiceNumber || t.salesOrderNumber || t.customerName) {
      got = { invoiceNumber: t.invoiceNumber, salesOrderNumber: t.salesOrderNumber, customerName: t.customerName, address: null, phone: null, goods: [], totalCents: t.totalCents };
      postcode = t.postcode;
      notInvoice = false;
    }
  }

  // The office's delivery for this invoice today: everything comes from it.
  const office = got ? await sameInvoice(db, got.invoiceNumber ?? got.salesOrderNumber, got, date) : null;
  const customer = office
    ? null
    : got
      ? ((await matchCustomer(db, got.customerName, got.phone)) ?? (got.customerName ? await likelyCustomer(db, got.customerName, postcode ?? postcodeOf(got.address)) : null))
      : null;
  const values = office
    ? {
        orderNumber: office.orderNumber,
        customerName: office.customerName || got!.customerName,
        address: office.address,
        phone: office.phone ?? got!.phone,
        goods: office.goods?.length ? office.goods : got!.goods.length ? got!.goods : null,
        customerId: office.customerId,
      }
    : {
        orderNumber: got?.invoiceNumber ?? got?.salesOrderNumber ?? null,
        // The name on file when matched (it puts right a misread name).
        customerName: customer?.name ?? got?.customerName ?? null,
        // What's printed comes first; the customer's address on file fills a gap.
        address: got?.address ?? customer?.address ?? null,
        phone: got?.phone ?? customer?.phone ?? null,
        goods: got?.goods.length ? got.goods : null,
        customerId: customer?.id ?? null,
      };
  const error = !got
    ? notInvoice
      ? "This doesn't look like an invoice. Retake the photo or search for the customer below."
      : "Couldn't read this photo. Search for the customer or invoice number below, or retake it."
    : !values.customerName || !values.address
      ? "Couldn't match the customer. Search for them below."
      : null;
  await db
    .update(deliveryDockets)
    .set({ readStatus: got ? "read" : "unread", readError: error, readProblem: problem, read: got, totalCents: got?.totalCents ?? null, ...values })
    .where(eq(deliveryDockets.id, row.id));
  return row.id;
}

/**
 * The customer a misread name most likely is: the closest name on file, when it's clearly the
 * closest (a branch name in brackets tells "Sushi Paradise (Toowong)" from "(Jindalee)"), with
 * the printed postcode to help. Null when it's not clear.
 */
export async function likelyCustomer(db: DB, name: string, postcode: string | null) {
  const rows = await db
    .select({ id: customers.id, name: customers.name, address: customers.address, phone: customers.phone })
    .from(customers)
    .where(sql`${customers.address} is not null and ${customers.address} <> ''`)
    .limit(5000);
  const scored = rows
    .map((c) => ({ c, score: nameLikeness(name, c.name) + (postcode && c.address?.includes(postcode) ? 0.08 : 0) }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (!best || best.score < 0.8 || (next && best.score - next.score < 0.06)) return null;
  return best.c;
}

/** A docket the driver may change: their own, not yet on the route. Staff may change any. */
async function editable(db: DB, who: Who & { staff?: boolean }, id: string) {
  const [d] = await db.select({ driverId: deliveryDockets.driverId, addedAt: deliveryDockets.addedAt }).from(deliveryDockets).where(eq(deliveryDockets.id, id)).limit(1);
  if (!d || (!who.staff && d.driverId !== who.driverId)) throw new UserError("That photo is gone. Reload the page.");
  if (d.addedAt) throw new UserError("This one is already on the route.");
}

/** The driver's corrections to what was read. */
export async function updateDocket(
  db: DB,
  who: Who & { staff?: boolean },
  id: string,
  f: { orderNumber: string | null; customerName: string | null; address: string | null; phone: string | null; customerId?: string | null },
) {
  await editable(db, who, id);
  const name = text(f.customerName, 200);
  const phone = text(f.phone, 40);
  // Picked from the list: that customer. Typed: whoever the name or phone matches.
  const [picked] = f.customerId
    ? await db.select({ id: customers.id, address: customers.address, phone: customers.phone }).from(customers).where(eq(customers.id, f.customerId)).limit(1)
    : [];
  const customer = picked ?? (await matchCustomer(db, name, phone));
  await db
    .update(deliveryDockets)
    .set({
      orderNumber: text(f.orderNumber, 40)?.replace(/\s+/g, "").toUpperCase() ?? null,
      customerName: name,
      address: text(f.address, 300) ?? customer?.address ?? null,
      phone: phone ?? customer?.phone ?? null,
      customerId: customer?.id ?? null,
    })
    .where(eq(deliveryDockets.id, id));
}

export async function removeDocket(db: DB, who: Who & { staff?: boolean }, id: string) {
  await editable(db, who, id);
  await db.delete(deliveryDockets).where(eq(deliveryDockets.id, id));
}

export type DocketPick =
  | { kind: "order"; orderNumber: string; customerName: string; address: string; phone: string | null; customerId: string | null; driver: string | null }
  | { kind: "customer"; customerId: string; customerName: string; address: string; phone: string | null; code: string };

/**
 * What a driver can pick instead of typing: the day's deliveries not yet delivered (by invoice
 * number or customer), then customers on file (by name, code or phone).
 */
export async function searchForDocket(db: DB, q: string, date: string): Promise<DocketPick[]> {
  const term = q.replace(/\s+/g, " ").trim().slice(0, 60);
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const tel = term.replace(/\D/g, "");
  const [orderRows, customerRows] = await Promise.all([
    db
      .select({ orderNumber: orders.orderNumber, customerName: orders.customerName, address: orders.address, phone: orders.phone, customerId: orders.customerId, driver: drivers.name })
      .from(orders)
      .leftJoin(drivers, eq(drivers.id, orders.driverId))
      .where(
        and(
          eq(orders.deliveryDate, date),
          inArray(orders.status, ["pending", "planned", "dispatched"]),
          sql`(${orders.orderNumber} ilike ${like} or ${orders.customerName} ilike ${like})`,
        ),
      )
      .orderBy(orders.orderNumber)
      .limit(6),
    db
      .select({ customerId: customers.id, customerName: customers.name, address: customers.address, phone: customers.phone, code: customers.code })
      .from(customers)
      .where(
        and(
          sql`${customers.address} is not null and ${customers.address} <> ''`,
          tel.length >= 6
            ? sql`(${customers.name} ilike ${like} or ${customers.code} ilike ${like} or regexp_replace(coalesce(${customers.phone}, ''), '\\D', '', 'g') like ${`%${tel}%`})`
            : sql`(${customers.name} ilike ${like} or ${customers.code} ilike ${like})`,
        ),
      )
      .orderBy(customers.name)
      .limit(8),
  ]);
  return [
    ...orderRows.map((o) => ({ kind: "order" as const, ...o })),
    ...customerRows.map((c) => ({ kind: "customer" as const, ...c, address: c.address ?? "" })),
  ];
}

export type DeliverResult = { id: string; ok: boolean; error?: string };

/**
 * Puts the chosen dockets on the driver's route for `date` and sends it to their phone. An
 * invoice the office already has as a delivery that day (imported, or a shop order) is that
 * delivery: it moves onto this driver's route if it's elsewhere. Anything else becomes a new
 * delivery, placed on the map from its address (or the customer's). Each docket succeeds or
 * fails on its own; one with an address that can't be found waits for the driver to fix it.
 */
export async function deliverDockets(db: DB, who: Who, ids: string[], date: string): Promise<DeliverResult[]> {
  const driverId = who.driverId;
  if (!driverId) throw new UserError("Your login isn't linked to a driver. Ask the office to link it.");
  const [driver] = await db.select({ active: drivers.active }).from(drivers).where(eq(drivers.id, driverId)).limit(1);
  if (!driver?.active) throw new UserError("Your driver profile is switched off. Ask the office.");
  const rows = ids.length
    ? await db
        .select()
        .from(deliveryDockets)
        .where(and(inArray(deliveryDockets.id, ids.slice(0, MAX_DOCKETS_AT_ONCE * 2)), eq(deliveryDockets.driverId, driverId), isNull(deliveryDockets.addedAt)))
    : [];
  const results: DeliverResult[] = [];
  const toAdd: { docketId: string; orderId: string }[] = [];
  const linked: { docketId: string; orderId: string }[] = [];

  for (const d of rows) {
    const fail = (error: string) => results.push({ id: d.id, ok: false, error });
    if (!d.customerName || !d.address) {
      fail("Add the customer and the address first.");
      continue;
    }
    const existing = d.orderId ? await orderById(db, d.orderId) : await sameInvoice(db, d.orderNumber, d.read, date);
    if (existing) {
      if (existing.status === "delivered") {
        fail(`${existing.orderNumber} has already been delivered.`);
        continue;
      }
      if (existing.status === "failed") {
        fail(`${existing.orderNumber} was already marked as not delivered today. Ask the office to send it again.`);
        continue;
      }
      if (existing.deliveryDate !== date) {
        // Only an order this docket made can be on another day (photographed yesterday, added today).
        await db.update(orders).set({ deliveryDate: date, status: "pending", driverId: null, updatedAt: new Date() }).where(and(eq(orders.id, existing.id), eq(orders.status, "pending")));
      }
      if (existing.lat === null || existing.lng === null) {
        // The office's order hasn't been placed on the map yet: place it now, from its own address
        // (else the one on the photo), so it can go on the route.
        let place = await placeFor(db, existing.address, existing.postcode ?? postcodeOf(existing.address), existing.customerName || d.customerName, existing.customerId ?? d.customerId);
        if (place.status === "failed" && d.address !== existing.address) place = await placeFor(db, d.address, postcodeOf(d.address), d.customerName, d.customerId);
        if (place.status === "failed" || place.lat === null || place.lng === null) {
          fail("Couldn't find this address on the map. Check it (street, suburb and postcode) and try again.");
          continue;
        }
        await db.update(orders).set({ lat: place.lat, lng: place.lng, geocodeStatus: place.status, geocodeLabel: place.label, updatedAt: new Date() }).where(eq(orders.id, existing.id));
      }
      const stop = await pendingStop(db, existing.id, date);
      try {
        if (stop?.driverId === driverId) linked.push({ docketId: d.id, orderId: existing.id });
        else if (stop) {
          await transferOrder(db, stop.routeId, existing.id, driverId);
          linked.push({ docketId: d.id, orderId: existing.id });
        } else toAdd.push({ docketId: d.id, orderId: existing.id });
      } catch (err) {
        if (err instanceof UserError) fail(err.message);
        else throw err;
        continue;
      }
      if (!d.orderId) await db.update(deliveryDockets).set({ orderId: existing.id }).where(eq(deliveryDockets.id, d.id));
      continue;
    }

    const postcode = postcodeOf(d.address);
    const place = await placeFor(db, d.address, postcode, d.customerName, d.customerId);
    if (place.status === "failed" || place.lat === null || place.lng === null) {
      fail("Couldn't find this address on the map. Check it (street, suburb and postcode) and try again.");
      continue;
    }
    const number = d.orderNumber || `DK-${date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
    const [order] = await db
      .insert(orders)
      .values({
        orderNumber: number,
        deliveryDate: date,
        customerName: d.customerName,
        phone: d.phone,
        address: d.address,
        postcode,
        lat: place.lat,
        lng: place.lng,
        geocodeStatus: place.status,
        geocodeLabel: place.label,
        goods: d.goods,
        customerId: d.customerId,
        source: "docket",
        notes: d.totalCents !== null ? `Invoice total $${(d.totalCents / 100).toFixed(2)}` : null,
      })
      .onConflictDoNothing()
      .returning({ id: orders.id });
    if (!order) {
      fail(`There's already a delivery numbered ${number} today. Check the invoice number.`);
      continue;
    }
    await db.update(deliveryDockets).set({ orderId: order.id }).where(eq(deliveryDockets.id, d.id));
    toAdd.push({ docketId: d.id, orderId: order.id });
  }

  if (toAdd.length) {
    try {
      await buildShipment(db, date, driverId, toAdd.map((a) => a.orderId));
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      for (const a of toAdd) results.push({ id: a.docketId, ok: false, error: err.message });
      toAdd.length = 0;
    }
  }
  const done = [...linked, ...toAdd];
  if (done.length) {
    // On the driver's phone straight away: they have the goods in hand.
    const route = await routeFor(db, driverId, date);
    if (route && !route.dispatchedAt) await sendShipment(db, route.id);
    await db.update(deliveryDockets).set({ addedAt: new Date() }).where(inArray(deliveryDockets.id, done.map((a) => a.docketId)));
    for (const a of done) results.push({ id: a.docketId, ok: true });
  }
  return results;
}

/**
 * Where to deliver: the customer's own pin when the invoice gives the address on file (it was
 * placed and checked already), else the address looked up as usual, else the customer's pin as
 * a rough guess for the driver, who is there in person anyway.
 */
async function placeFor(db: DB, address: string, postcode: string | null, customerName: string, customerId: string | null) {
  const [c] = customerId
    ? await db
        .select({ address: customers.address, lat: customers.lat, lng: customers.lng, status: customers.geocodeStatus, label: customers.geocodeLabel, placedFor: customers.geocodedAddress })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1)
    : [];
  const pinned = c && c.lat !== null && c.lng !== null && c.status && c.status !== "failed" && c.placedFor === c.address;
  const same = (a: string | null) => (a ?? "").toLowerCase().replace(/[\s,]+/g, " ").trim();
  if (pinned && same(c.address) === same(address)) return { status: c.status!, lat: c.lat, lng: c.lng, label: c.label };
  const r = await locateOrder(db, { address, suburb: null, postcode, customerName, customerId });
  if (r.status !== "failed") return r;
  if (pinned) return { status: "approximate" as const, lat: c.lat, lng: c.lng, label: c.label };
  return r;
}

async function orderById(db: DB, id: string) {
  const [o] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return o ?? null;
}

/** The day's delivery already made for this invoice (by invoice or sales order number), if any. */
async function sameInvoice(db: DB, number: string | null, read: DocketRead | null, date: string) {
  const numbers = [...new Set([number, read?.invoiceNumber, read?.salesOrderNumber].filter((n): n is string => !!n))];
  if (!numbers.length) return null;
  const upper = numbers.map((n) => n.toUpperCase());
  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.deliveryDate, date), inArray(sql`upper(${orders.orderNumber})`, upper)))
    .limit(1);
  if (o) return o;
  const [so] = await db
    .select({ order: orders })
    .from(salesOrders)
    .innerJoin(orders, eq(orders.id, salesOrders.deliveryOrderId))
    .where(and(inArray(sql`upper(${salesOrders.number})`, upper), eq(orders.deliveryDate, date)))
    .limit(1);
  return so?.order ?? null;
}

async function pendingStop(db: DB, orderId: string, date: string) {
  const [s] = await db
    .select({ routeId: routes.id, driverId: routes.driverId })
    .from(routeStops)
    .innerJoin(routes, eq(routes.id, routeStops.routeId))
    .innerJoin(plans, eq(plans.id, routes.planId))
    .where(and(eq(routeStops.orderId, orderId), eq(routeStops.status, "pending"), eq(plans.deliveryDate, date)))
    .limit(1);
  return s ?? null;
}

async function routeFor(db: DB, driverId: string, date: string) {
  const [r] = await db
    .select({ id: routes.id, dispatchedAt: routes.dispatchedAt })
    .from(routes)
    .innerJoin(plans, eq(plans.id, routes.planId))
    .where(and(eq(routes.driverId, driverId), eq(plans.deliveryDate, date)))
    .limit(1);
  return r ?? null;
}

export type DocketView = {
  id: string;
  at: string;
  driverName: string | null;
  readStatus: DocketReadStatus;
  readError: string | null;
  /** Why reading failed (office only). */
  readProblem: string | null;
  orderNumber: string | null;
  customerName: string | null;
  address: string | null;
  phone: string | null;
  goods: GoodsLine[];
  totalCents: number | null;
  /** Matched to a customer on file. */
  known: boolean;
  orderId: string | null;
  added: boolean;
  /** How the delivery went, once it's on a route. */
  delivery: { status: string; at: string | null; recipient: string | null; reason: string | null } | null;
  /** Proof-of-delivery photos and signature. */
  proofs: { id: string; kind: "photo" | "signature" }[];
};

/** Dockets for a day: one driver's (their screen), or everyone's (the office). Newest first. */
export async function listDockets(db: DB, date: string, driverId?: string): Promise<DocketView[]> {
  const rows = await db
    .select({
      d: {
        id: deliveryDockets.id,
        createdAt: deliveryDockets.createdAt,
        readStatus: deliveryDockets.readStatus,
        readError: deliveryDockets.readError,
        readProblem: deliveryDockets.readProblem,
        orderNumber: deliveryDockets.orderNumber,
        customerName: deliveryDockets.customerName,
        address: deliveryDockets.address,
        phone: deliveryDockets.phone,
        goods: deliveryDockets.goods,
        totalCents: deliveryDockets.totalCents,
        customerId: deliveryDockets.customerId,
        orderId: deliveryDockets.orderId,
        addedAt: deliveryDockets.addedAt,
      },
      driverName: drivers.name,
      orderStatus: orders.status,
    })
    .from(deliveryDockets)
    .leftJoin(drivers, eq(drivers.id, deliveryDockets.driverId))
    .leftJoin(orders, eq(orders.id, deliveryDockets.orderId))
    .where(and(eq(deliveryDockets.deliveryDate, date), driverId ? eq(deliveryDockets.driverId, driverId) : undefined))
    .orderBy(desc(deliveryDockets.createdAt))
    .limit(300);
  const orderIds = rows.filter((r) => r.d.addedAt && r.d.orderId).map((r) => r.d.orderId!);
  const events = orderIds.length
    ? await db
        .select({ orderId: deliveryEvents.orderId, type: deliveryEvents.type, at: deliveryEvents.createdAt, recipient: deliveryEvents.recipient, reason: deliveryEvents.reason })
        .from(deliveryEvents)
        .where(and(inArray(deliveryEvents.orderId, orderIds), inArray(deliveryEvents.type, ["delivered", "failed"])))
        .orderBy(desc(deliveryEvents.createdAt))
    : [];
  const proofs = orderIds.length
    ? await db.select({ id: deliveryProofs.id, orderId: deliveryProofs.orderId, kind: deliveryProofs.kind }).from(deliveryProofs).where(inArray(deliveryProofs.orderId, orderIds)).orderBy(deliveryProofs.createdAt)
    : [];
  return rows.map(({ d, driverName, orderStatus }) => {
    const ev = events.find((e) => e.orderId === d.orderId);
    return {
      id: d.id,
      at: d.createdAt.toISOString(),
      driverName,
      readStatus: d.readStatus,
      readError: d.readError,
      readProblem: d.readProblem,
      orderNumber: d.orderNumber,
      customerName: d.customerName,
      address: d.address,
      phone: d.phone,
      goods: d.goods ?? [],
      totalCents: d.totalCents,
      known: !!d.customerId,
      orderId: d.orderId,
      added: !!d.addedAt,
      delivery:
        d.addedAt && orderStatus
          ? { status: orderStatus, at: ev?.at.toISOString() ?? null, recipient: ev?.recipient ?? null, reason: ev?.reason ?? null }
          : null,
      proofs: proofs.filter((p) => p.orderId === d.orderId).map((p) => ({ id: p.id, kind: p.kind })),
    };
  });
}

/** The photo, for its driver or the office. */
export async function docketPhoto(db: DB, id: string) {
  const [p] = await db
    .select({ mime: deliveryDockets.mime, data: deliveryDockets.data, driverId: deliveryDockets.driverId })
    .from(deliveryDockets)
    .where(eq(deliveryDockets.id, id))
    .limit(1);
  return p ?? null;
}
