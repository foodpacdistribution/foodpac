import "server-only";
import { after } from "next/server";
import { cache } from "react";
import { type DB, getDb } from "./db";
import { restoreMissingDeliveries } from "./shop";
import { geocodeOrderIds } from "./sync";
import { todayIn } from "./time";

/**
 * Requested by the delivery screens: confirmed shop orders from today on always have a delivery
 * to plan and ship, even if theirs was deleted. The repair runs after the response, so it never
 * holds up or breaks the page (a write stuck behind a lock used to make every back-office page
 * wait 10 s and fail); anything it restores shows on the next live refresh, a few seconds later.
 */
export const restoreDeliveries = cache(async (_db: DB, timezone: string) => {
  after(async () => {
    // A repair in passing: if it fails, the next page view tries again.
    try {
      const db = await getDb();
      const ids = await restoreMissingDeliveries(db, todayIn(timezone));
      if (ids.length) await geocodeOrderIds(db, ids);
    } catch (err) {
      console.error("[admin] couldn't restore missing deliveries:", err);
    }
  });
});
