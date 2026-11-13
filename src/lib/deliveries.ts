import "server-only";
import { after } from "next/server";
import { cache } from "react";
import { type DB, getDb } from "./db";
import { restoreMissingDeliveries } from "./shop";
import { checkDayLocations } from "./geo/geocode";
import { geocodeOrderIds } from "./sync";
import { reportError } from "./report-error";
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
      await reportError(err, { area: "Restoring missing deliveries" });
    }
  });
});

/**
 * After the response, locates the day's orders that are waiting for a pin or were pinned in the
 * wrong town (see checkDayLocations). Moved pins show on the next refresh.
 */
export function checkLocationsLater(date: string) {
  after(async () => {
    try {
      await checkDayLocations(await getDb(), date);
    } catch (err) {
      console.error("[admin] couldn't check order locations:", err);
      await reportError(err, { area: "Locating orders", detail: date });
    }
  });
}
