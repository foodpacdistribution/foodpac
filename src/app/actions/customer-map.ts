"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, PIPELINE } from "@/lib/auth/dal";
import { locateCustomers } from "@/lib/customer-locations";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { MAX_VISITS } from "@/lib/customer-map";
import { travelMatrix } from "@/lib/geo/routing";
import { getDepots, getSettings, UserError } from "@/lib/planning";
import { planSingleRoute } from "@/lib/quick-route";
import { nowSecondsIn } from "@/lib/time";

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

/** Time allowed at each visit, for the arrival times. */
const VISIT_S = 15 * 60;

export type VisitPlan = {
  stops: { id: string; name: string; address: string; phone: string | null; arriveS: number; driveS: number }[];
  driveS: number;
  distanceM: number;
  /** Opens the whole trip in Google Maps, ready to navigate. */
  mapsUrl: string;
  /** Travel times are straight-line guesses (the road service didn't answer). */
  estimate: boolean;
};

/**
 * The quickest order to visit these customers, from where the salesperson is (or the depot), with
 * arrival times from now and a Google Maps link for the whole trip.
 */
export async function planVisits(input: { customerIds: string[]; start: { lat: number; lng: number } | null }) {
  return attempt<VisitPlan>(async () => {
    await assertUser(PIPELINE);
    const ids = [...new Set((Array.isArray(input.customerIds) ? input.customerIds : []).map(String))].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, MAX_VISITS);
    if (!ids.length) throw new UserError("Pick who to visit.");
    const db = await getDb();
    const rows = await db
      .select({ id: customers.id, name: customers.name, address: customers.address, phone: customers.phone, lat: customers.lat, lng: customers.lng })
      .from(customers)
      .where(inArray(customers.id, ids));
    const stops = rows.filter((r): r is typeof r & { lat: number; lng: number } => r.lat !== null && r.lng !== null);
    if (!stops.length) throw new UserError("None of them are on the map yet.");
    const s = await getSettings(db);
    const here = input.start && Number.isFinite(input.start.lat) && Number.isFinite(input.start.lng) ? { lat: Number(input.start.lat), lng: Number(input.start.lng) } : null;
    const start = here ?? (await getDepots(db))[0] ?? stops[0];
    const matrix = await travelMatrix([start, ...stops]);
    const plan = planSingleRoute(matrix, { stopCount: stops.length, endNode: null, startS: nowSecondsIn(s.timezone), serviceS: VISIT_S });
    const ordered = plan.legs.map((l) => ({ ...stops[l.stop], arriveS: l.arrivalS, driveS: l.durationS }));
    const at = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("travelmode", "driving");
    // From "here", Google starts at the phone's own position; otherwise from the depot.
    if (!here) url.searchParams.set("origin", at(start));
    url.searchParams.set("destination", at(ordered[ordered.length - 1]));
    if (ordered.length > 1) url.searchParams.set("waypoints", ordered.slice(0, -1).map(at).join("|"));
    return {
      data: {
        stops: ordered.map(({ id, name, address, phone, arriveS, driveS }) => ({ id, name, address: address ?? "", phone, arriveS, driveS })),
        driveS: plan.driveS,
        distanceM: plan.distanceM,
        mapsUrl: url.toString(),
        estimate: matrix.source === "estimate",
      },
    };
  });
}
