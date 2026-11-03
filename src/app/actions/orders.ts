"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { insertDemoOrders } from "@/lib/db/seed";
import { depots, orders, routeStops, salesOrders } from "@/lib/db/schema";
import { geocodeAddress } from "@/lib/geo/geocode";
import { getT } from "@/lib/i18n/server";
import { pruneEmptyRoutes } from "@/lib/shipments";
import { UserError } from "@/lib/planning";
import { geocodeQuery, type ImportRow, validateImportRow } from "@/lib/orders";
import { inputToMinutes } from "@/lib/time";

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const int = (f: FormData, k: string) => {
  const v = str(f, k);
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new UserError(`${k} must be a positive number`);
  return Math.round(n);
};

function revalidateAll() {
  revalidatePath("/admin/orders");
  revalidatePath("/admin/planner");
  revalidatePath("/admin");
}

/** Removes an order from any not-yet-completed stop (date change, deletion of plan membership). */
async function detachFromPlans(ids: string[]) {
  const db = await getDb();
  await db.delete(routeStops).where(and(inArray(routeStops.orderId, ids), eq(routeStops.status, "pending")));
}

export async function saveOrder(_prev: unknown, form: FormData) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    const id = str(form, "id");
    const address = str(form, "address");
    const deliveryDate = str(form, "deliveryDate");
    if (!address) throw new UserError("Address is required.");
    if (!deliveryDate || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) throw new UserError("Delivery date is required.");
    const windowStartMin = inputToMinutes(str(form, "windowStart"));
    const windowEndMin = inputToMinutes(str(form, "windowEnd"));
    if (windowStartMin !== null && windowEndMin !== null && windowStartMin >= windowEndMin) {
      throw new UserError("Delivery window must end after it starts.");
    }

    const values = {
      orderNumber: str(form, "orderNumber") ?? `ORD-${deliveryDate.replaceAll("-", "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      deliveryDate,
      customerName: str(form, "customerName") ?? "",
      phone: str(form, "phone"),
      address,
      suburb: str(form, "suburb"),
      postcode: str(form, "postcode"),
      windowStartMin,
      windowEndMin,
      serviceMin: int(form, "serviceMin"),
      demand: int(form, "demand") ?? 1,
      priority: form.get("priority") === "1" ? 1 : 0,
      notes: str(form, "notes"),
      pinnedDriverId: str(form, "pinnedDriverId"),
      depotId: str(form, "depotId"),
      updatedAt: new Date(),
    };

    const dupe = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.orderNumber, values.orderNumber),
          eq(orders.deliveryDate, deliveryDate),
          ...(id ? [ne(orders.id, id)] : []),
        ),
      )
      .limit(1);
    if (dupe.length) throw new UserError(`Order ${values.orderNumber} already exists for ${deliveryDate}.`);

    let orderId = id;
    if (id) {
      const [existing] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!existing) throw new UserError("Order not found.");
      if (existing.status === "delivered") throw new UserError("Delivered orders can't be edited.");
      const addressChanged =
        existing.address !== values.address || existing.suburb !== values.suburb || existing.postcode !== values.postcode;
      const dateChanged = existing.deliveryDate !== deliveryDate;
      if (dateChanged) await detachFromPlans([id]);
      await db
        .update(orders)
        .set({
          ...values,
          ...(addressChanged ? { lat: null, lng: null, geocodeStatus: "pending" as const, geocodeLabel: null } : {}),
          // Moving a failed/planned order to another day puts it back in the queue.
          ...(dateChanged || existing.status === "failed" ? { status: "pending" as const, driverId: null } : {}),
        })
        .where(eq(orders.id, id));
      if (!addressChanged) orderId = null; // no need to geocode
    } else {
      const [row] = await db.insert(orders).values(values).returning({ id: orders.id });
      orderId = row.id;
    }

    if (orderId) await geocodeOne(orderId);
    revalidateAll();
    return { message: id ? "Order updated" : "Order added" };
  });
}

async function geocodeOne(id: string) {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!o) return null;
  const r = await geocodeAddress(db, geocodeQuery(o));
  await db
    .update(orders)
    .set({ lat: r.lat, lng: r.lng, geocodeStatus: r.status, geocodeLabel: r.label, updatedAt: new Date() })
    .where(eq(orders.id, id));
  return { id, status: r.status, label: r.label };
}

/** Called by the client in small batches so the UI can show progress (Nominatim allows ~1 req/s). */
export async function geocodeOrders(ids: string[]) {
  return attempt(async () => {
    await assertUser(STAFF);
    const results = [];
    for (const id of ids.slice(0, 5)) results.push(await geocodeOne(id));
    revalidateAll();
    return { data: results.filter(Boolean) };
  });
}

/**
 * Deletes orders. Delivered or failed ones carry the proof of delivery, so only admins can
 * delete those (e.g. test data), and only when they explicitly include them.
 */
export async function deleteOrders(ids: string[], opts: { includeCompleted?: boolean } = {}) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    if (opts.includeCompleted && user.role !== "admin") throw new UserError("Only an admin can delete delivered orders.");
    const db = await getDb();
    const rows = await db.select({ id: orders.id, status: orders.status, deliveryDate: orders.deliveryDate }).from(orders).where(inArray(orders.id, ids));
    const completed = (r: { status: string }) => r.status === "delivered" || r.status === "failed";
    // A live shop order's delivery goes with the shop order (cancel or delete it in Sales orders);
    // deleting just the delivery would leave a confirmed order nobody delivers.
    const shop = new Set(
      (
        await db
          .select({ id: salesOrders.deliveryOrderId })
          .from(salesOrders)
          .where(and(inArray(salesOrders.deliveryOrderId, ids), ne(salesOrders.status, "cancelled")))
      ).map((r) => r.id),
    );
    const deletable = rows.filter((r) => !shop.has(r.id) && (opts.includeCompleted || !completed(r)));
    if (deletable.length) {
      // Stops, delivery events and proof photos/signatures go with the order (foreign keys cascade).
      await db.delete(orders).where(inArray(orders.id, deletable.map((r) => r.id)));
      await pruneEmptyRoutes(db, deletable.map((r) => r.deliveryDate));
    }
    revalidateAll();
    revalidatePath("/admin/shipments");
    revalidatePath("/driver");
    const done = rows.length - deletable.length - shop.size;
    const t = await getT();
    const message = [
      t("Deleted {n} order(s)", { n: deletable.length }),
      done > 0 && t("kept {n} already delivered or failed", { n: done }),
      shop.size > 0 && t("kept {n} shop order(s): cancel or delete those in Sales orders", { n: shop.size }),
    ].filter(Boolean);
    return { message: message.join(" · ") };
  });
}

export async function rescheduleOrders(ids: string[], date: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError("Pick a date.");
    const db = await getDb();
    const rows = await db.select().from(orders).where(inArray(orders.id, ids));
    const movable = rows.filter((r) => r.status !== "delivered");
    let moved = 0;
    for (const o of movable) {
      const clash = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.orderNumber, o.orderNumber), eq(orders.deliveryDate, date), ne(orders.id, o.id)))
        .limit(1);
      if (clash.length) continue;
      await detachFromPlans([o.id]);
      await db
        .update(orders)
        .set({ deliveryDate: date, status: "pending", driverId: null, updatedAt: new Date() })
        .where(eq(orders.id, o.id));
      moved++;
    }
    revalidateAll();
    return { message: `Moved ${moved} order(s) to ${date}` };
  });
}

export async function importOrders(rows: ImportRow[], defaultDate: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    if (rows.length > 2000) throw new UserError("Import at most 2,000 rows at a time.");
    const db = await getDb();
    const errors: { row: number; message: string }[] = [];
    const valid: (typeof orders.$inferInsert)[] = [];
    const seen = new Set<string>();
    const duplicates: string[] = [];
    const depotByName = new Map((await db.select().from(depots)).map((d) => [d.name.trim().toLowerCase(), d.id]));

    rows.forEach((raw, i) => {
      const res = validateImportRow(raw, defaultDate, i);
      if (!res.ok) return errors.push({ row: i + 1, message: res.error });
      const depotName = (raw.depot ?? "").trim();
      const depotId = depotName ? depotByName.get(depotName.toLowerCase()) : null;
      if (depotId === undefined) return errors.push({ row: i + 1, message: `Unknown depot "${depotName}"` });
      const key = `${res.value.orderNumber}|${res.value.deliveryDate}`;
      if (seen.has(key)) return duplicates.push(res.value.orderNumber);
      seen.add(key);
      valid.push({ ...res.value, depotId, source: "import" });
    });

    // Ids of the new orders, so the import page can place them on the map straight away.
    const ids: string[] = [];
    for (let i = 0; i < valid.length; i += 200) {
      const batch = valid.slice(i, i + 200);
      const ins = await db.insert(orders).values(batch).onConflictDoNothing().returning({ id: orders.id, orderNumber: orders.orderNumber });
      ids.push(...ins.map((r) => r.id));
      const got = new Set(ins.map((r) => r.orderNumber));
      batch.forEach((b) => !got.has(b.orderNumber) && duplicates.push(b.orderNumber));
    }
    revalidateAll();
    return { data: { inserted: ids.length, ids, duplicates, errors } };
  });
}

export async function addDemoOrders(date: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    const n = await insertDemoOrders(await getDb(), date);
    revalidateAll();
    return { message: n ? `Added ${n} demo orders` : "Demo orders already exist for this date" };
  });
}
