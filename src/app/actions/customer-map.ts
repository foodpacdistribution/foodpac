"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, PIPELINE } from "@/lib/auth/dal";
import { locateCustomers } from "@/lib/customer-locations";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";

/**
 * Places the next few customers on the map (about 8 seconds' worth). The map page calls this
 * again until none are left, so a big import fills in while you watch.
 */
export async function locateCustomerBatch() {
  return attempt(async () => {
    await assertUser(PIPELINE);
    const r = await locateCustomers(await getDb(), { budgetMs: 8000 });
    revalidatePath("/admin/customer-map");
    return { data: r };
  });
}

/** Looks up again the addresses that couldn't be found (e.g. after fixing them, or the map service was down). */
export async function retryFailedLocations() {
  return attempt(async () => {
    await assertUser(PIPELINE);
    const db = await getDb();
    await db.update(customers).set({ geocodedAddress: null }).where(eq(customers.geocodeStatus, "failed"));
    const r = await locateCustomers(db, { budgetMs: 8000 });
    revalidatePath("/admin/customer-map");
    return { data: r };
  });
}
