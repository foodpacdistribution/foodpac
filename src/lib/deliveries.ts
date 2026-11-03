import "server-only";
import { after } from "next/server";
import { cache } from "react";
import { type DB, getDb } from "./db";
import { restoreMissingDeliveries } from "./shop";
import { geocodeOrderIds } from "./sync";
import { todayIn } from "./time";

/**
 * Run before showing the delivery screens: confirmed shop orders from today on always have a
 * delivery to plan and ship, even if theirs was deleted. Addresses are located after the response.
 */
export const restoreDeliveries = cache(async (db: DB, timezone: string) => {
  const ids = await restoreMissingDeliveries(db, todayIn(timezone));
  if (ids.length) after(async () => geocodeOrderIds(await getDb(), ids));
});
