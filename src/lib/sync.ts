import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import Papa from "papaparse";
import type { DB } from "./db";
import { apiKeys, depots, type FeedResult, orderFeeds, orders } from "./db/schema";
import { geocodeAddress } from "./geo/geocode";
import { shiftDate } from "./dates";
import { geocodeQuery, guessMapping, IMPORT_FIELDS, type ImportField, type ImportRow, validateImportRow } from "./orders";
import { todayIn } from "./time";

export type UpsertResult = {
  inserted: number;
  updated: number;
  unchanged: number;
  /** Already planned, dispatched or completed — left untouched so routes don't change under the dispatcher. */
  locked: string[];
  errors: { row: number; message: string }[];
  /** Orders whose address needs (re)geocoding. */
  geocodeIds: string[];
};

/**
 * Creates or updates orders by (order number, delivery date). Used by the API
 * and scheduled feeds, so re-sending the same data is safe.
 */
export async function upsertOrders(db: DB, rows: ImportRow[], opts: { defaultDate: string; source: string }): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, locked: [], errors: [], geocodeIds: [] };
  const depotRows = await db.select({ id: depots.id, name: depots.name }).from(depots);
  const depotByName = new Map(depotRows.map((d) => [d.name.trim().toLowerCase(), d.id]));

  const valid: { row: number; value: typeof orders.$inferInsert }[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, i) => {
    const res = validateImportRow(raw, opts.defaultDate, i);
    if (!res.ok) return result.errors.push({ row: i + 1, message: res.error });
    let depotId: string | null = null;
    const depotName = (raw.depot ?? "").toString().trim();
    if (depotName) {
      depotId = depotByName.get(depotName.toLowerCase()) ?? null;
      if (!depotId) return result.errors.push({ row: i + 1, message: `Unknown depot "${depotName}"` });
    }
    const key = `${res.value.orderNumber}|${res.value.deliveryDate}`;
    if (seen.has(key)) return result.errors.push({ row: i + 1, message: `Duplicate of an earlier row (${res.value.orderNumber})` });
    seen.add(key);
    valid.push({ row: i + 1, value: { ...res.value, depotId, source: opts.source } });
  });

  for (let i = 0; i < valid.length; i += 200) {
    const batch = valid.slice(i, i + 200);
    const existing = await db
      .select()
      .from(orders)
      .where(
        and(
          inArray(orders.orderNumber, batch.map((b) => b.value.orderNumber)),
          inArray(orders.deliveryDate, [...new Set(batch.map((b) => b.value.deliveryDate))]),
        ),
      );
    const byKey = new Map(existing.map((o) => [`${o.orderNumber}|${o.deliveryDate}`, o]));

    for (const { value } of batch) {
      const prev = byKey.get(`${value.orderNumber}|${value.deliveryDate}`);
      if (!prev) {
        const [row] = await db.insert(orders).values(value).onConflictDoNothing().returning({ id: orders.id });
        if (row) {
          result.inserted++;
          result.geocodeIds.push(row.id);
        }
        continue;
      }
      if (prev.status !== "pending") {
        result.locked.push(value.orderNumber);
        continue;
      }
      const fields = {
        customerName: value.customerName ?? "",
        phone: value.phone ?? null,
        address: value.address,
        suburb: value.suburb ?? null,
        postcode: value.postcode ?? null,
        windowStartMin: value.windowStartMin ?? null,
        windowEndMin: value.windowEndMin ?? null,
        serviceMin: value.serviceMin ?? null,
        demand: value.demand ?? 1,
        priority: value.priority ?? 0,
        notes: value.notes ?? null,
        depotId: value.depotId ?? null,
      };
      // Re-sending identical data is a no-op, so repeated feed pulls don't churn the table.
      if ((Object.keys(fields) as (keyof typeof fields)[]).every((k) => prev[k] === fields[k])) {
        result.unchanged++;
        continue;
      }
      const addressChanged = prev.address !== value.address || prev.suburb !== fields.suburb || prev.postcode !== fields.postcode;
      await db
        .update(orders)
        .set({
          ...fields,
          updatedAt: new Date(),
          ...(addressChanged ? { lat: null, lng: null, geocodeStatus: "pending" as const, geocodeLabel: null } : {}),
        })
        .where(eq(orders.id, prev.id));
      result.updated++;
      if (addressChanged) result.geocodeIds.push(prev.id);
    }
  }
  return result;
}

/** Geocodes orders one by one (Nominatim allows ~1 request/second). Meant for after()/background use. */
export async function geocodeOrderIds(db: DB, ids: string[]) {
  for (const id of ids) {
    const [o] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!o || o.lat !== null) continue;
    const r = await geocodeAddress(db, geocodeQuery(o));
    await db
      .update(orders)
      .set({ lat: r.lat, lng: r.lng, geocodeStatus: r.status, geocodeLabel: r.label, updatedAt: new Date() })
      .where(eq(orders.id, id));
  }
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Returns the plaintext key once; only its hash is stored. */
export async function createApiKey(db: DB, name: string) {
  const key = `dp_${randomBytes(24).toString("base64url")}`;
  await db.insert(apiKeys).values({ name, prefix: key.slice(0, 10), keyHash: sha256(key) });
  return key;
}

export async function verifyApiKey(db: DB, req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : (req.headers.get("x-api-key") ?? "").trim();
  if (!key.startsWith("dp_")) return null;
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, sha256(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return row;
}

// ---------------------------------------------------------------------------
// Scheduled feeds
// ---------------------------------------------------------------------------

const MAX_FEED_BYTES = 5 * 1024 * 1024;

/** Turns a feed body into rows keyed by our field names. */
export function parseFeed(body: string, format: "csv" | "json", mapping: Record<string, string>): ImportRow[] {
  let records: Record<string, unknown>[];
  if (format === "json") {
    const parsed = JSON.parse(body) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as { orders?: unknown[]; data?: unknown[] })?.orders ?? (parsed as { data?: unknown[] })?.data;
    if (!Array.isArray(list)) throw new Error("JSON must be an array of orders, or { orders: [...] }");
    records = list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  } else {
    const res = Papa.parse<Record<string, string>>(body.trim(), { header: true, skipEmptyLines: true });
    records = res.data;
  }
  if (!records.length) return [];

  const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
  // Explicit mapping wins; anything unmapped falls back to header auto-detection.
  const guessed = guessMapping(headers);
  const columnFor = (field: ImportField) => mapping[field] || (guessed[field] !== undefined ? headers[guessed[field]!] : undefined);

  return records.map((r) => {
    const row: ImportRow = {};
    for (const f of IMPORT_FIELDS) {
      const col = columnFor(f.key);
      const v = col ? r[col] : undefined;
      if (v !== undefined && v !== null) row[f.key] = String(v);
    }
    return row;
  });
}

export async function runFeed(db: DB, feedId: string, timezone: string): Promise<FeedResult & { geocodeIds: string[] }> {
  const [feed] = await db.select().from(orderFeeds).where(eq(orderFeeds.id, feedId)).limit(1);
  if (!feed) throw new Error("Feed not found");
  const today = todayIn(timezone);
  const defaultDate = feed.dateMode === "tomorrow" ? shiftDate(today, 1) : today;
  let result: FeedResult & { geocodeIds: string[] };
  try {
    const res = await fetch(feed.url, {
      headers: feed.authHeader ? { Authorization: feed.authHeader } : undefined,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);
    const body = await res.text();
    if (body.length > MAX_FEED_BYTES) throw new Error("Feed is larger than 5 MB");
    const rows = parseFeed(body, feed.format, feed.mapping);
    const r = await upsertOrders(db, rows, { defaultDate, source: `feed:${feed.name}` });
    result = {
      at: new Date().toISOString(),
      ok: true,
      message: `${rows.length} rows read, ${r.unchanged} unchanged` + (r.errors.length ? ` · first error: row ${r.errors[0].row} ${r.errors[0].message}` : ""),
      inserted: r.inserted,
      updated: r.updated,
      skipped: r.locked.length,
      errors: r.errors.length,
      geocodeIds: r.geocodeIds,
    };
  } catch (err) {
    result = { at: new Date().toISOString(), ok: false, message: (err as Error).message, inserted: 0, updated: 0, skipped: 0, errors: 1, geocodeIds: [] };
  }
  const { geocodeIds: _ids, ...stored } = result;
  await db.update(orderFeeds).set({ lastRunAt: new Date(), lastResult: stored }).where(eq(orderFeeds.id, feed.id));
  return result;
}
