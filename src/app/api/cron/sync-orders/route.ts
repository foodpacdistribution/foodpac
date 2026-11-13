import { eq } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { checkDatabaseSize } from "@/lib/db-size";
import { orderFeeds } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { reportError } from "@/lib/report-error";
import { geocodeOrderIds, runFeed } from "@/lib/sync";

export const maxDuration = 300;

/**
 * Pulls every enabled order feed. Called by Vercel Cron (see vercel.json),
 * which sends "Authorization: Bearer $CRON_SECRET".
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorised", { status: 401 });

  const db = await getDb();
  const s = await getSettings(db);
  const feeds = await db.select({ id: orderFeeds.id, name: orderFeeds.name }).from(orderFeeds).where(eq(orderFeeds.enabled, true));
  const results = [];
  const geocode: string[] = [];
  for (const f of feeds) {
    const r = await runFeed(db, f.id, s.timezone);
    geocode.push(...r.geocodeIds);
    results.push({ feed: f.name, ok: r.ok, inserted: r.inserted, updated: r.updated, skipped: r.skipped, message: r.message });
    if (!r.ok) await reportError(new Error(r.message ?? "The feed failed"), { area: "Order sync", detail: `Feed "${f.name}": tonight's orders from it may be missing.` });
  }
  if (geocode.length) after(() => geocodeOrderIds(db, geocode));
  // Once a day is enough to see the database filling up.
  const databaseMb = await checkDatabaseSize(db);
  return Response.json({ feeds: results, databaseMb });
}
