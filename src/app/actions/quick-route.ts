"use server";

import { type ActionResult, attempt } from "@/lib/action";
import { assertUser } from "@/lib/auth/dal";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { deliveryEvents, orders } from "@/lib/db/schema";
import { geocodeAddress, reverseGeocode } from "@/lib/geo/geocode";
import { type LatLng, routeGeometry, travelMatrix } from "@/lib/geo/routing";
import { clean, readOutcome } from "@/lib/outcome";
import { depotForUser, getSettings, learnTiming, UserError } from "@/lib/planning";
import { saveProof } from "@/lib/proofs";
import { MAX_QUICK_STOPS, planSingleRoute } from "@/lib/quick-route";
import { nowSecondsIn, todayIn } from "@/lib/time";

export type QuickEnd = "last_stop" | "start" | "depot";

export type QuickRouteRequest = {
  /** An address picked from suggestions carries its position, so it isn't looked up again. */
  start: { kind: "gps"; lat: number; lng: number } | { kind: "depot" } | { kind: "address"; address: string; lat?: number; lng?: number };
  /** Stops already located (when re-planning the rest of a route) carry their coordinates. */
  stops: { address: string; lat?: number; lng?: number }[];
  end: QuickEnd;
  /** With end "start": the original starting point, so re-planning mid-route still finishes there. */
  returnTo?: LatLng & { label: string };
  serviceMin: number;
};

export type QuickPlace = LatLng & { label: string };

export type QuickRouteResult = {
  start: QuickPlace;
  /** Where the route finishes after the last stop; null = it ends there. */
  end: QuickPlace | null;
  stops: (QuickPlace & {
    address: string;
    approximate: boolean;
    legDurationS: number;
    legDistanceM: number;
    arrivalS: number;
    departureS: number;
  })[];
  returnLeg: { durationS: number; distanceM: number } | null;
  notFound: string[];
  startS: number;
  driveS: number;
  distanceM: number;
  finishS: number;
  entered: { driveS: number; distanceM: number };
  exact: boolean;
  matrixSource: "osrm" | "estimate";
  trafficFactor: number;
  /** The traffic factor was learned from past deliveries rather than the settings guess. */
  learned: boolean;
  path: [number, number][];
};

const validPoint = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export type LocatedAddress = { status: "ok" | "approximate" | "failed"; lat: number | null; lng: number | null; label: string | null };

/** One address at a time, so the page can show progress and the driver can check each pin before planning. */
export async function locateAddress(address: string): Promise<ActionResult<LocatedAddress>> {
  return attempt(async () => {
    await assertUser(["admin", "dispatcher", "driver"]);
    const q = String(address ?? "").trim().slice(0, 300);
    if (!q) throw new UserError("Enter an address.");
    const g = await geocodeAddress(await getDb(), q);
    return { data: { status: g.status, lat: g.lat, lng: g.lng, label: g.label } };
  });
}

/** Street address nearest to the driver's GPS position, to confirm the start point. */
export async function describeLocation(lat: number, lng: number): Promise<ActionResult<string | null>> {
  return attempt(async () => {
    await assertUser(["admin", "dispatcher", "driver"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new UserError("Invalid position.");
    return { data: await reverseGeocode(lat, lng) };
  });
}

export async function planQuickRoute(req: QuickRouteRequest): Promise<ActionResult<QuickRouteResult>> {
  return attempt(async () => {
    const user = await assertUser(["admin", "dispatcher", "driver"]);
    const db = await getDb();
    const s = await getSettings(db);

    const wanted = (Array.isArray(req.stops) ? req.stops : [])
      .map((x) => ({ ...x, address: String(x?.address ?? "").trim().slice(0, 300) }))
      .filter((x) => x.address);
    if (!wanted.length) throw new UserError("Enter at least one delivery address.");
    if (wanted.length > MAX_QUICK_STOPS) throw new UserError(`Quick routes take up to ${MAX_QUICK_STOPS} addresses. Use the Route Planner for more.`);
    if (!["last_stop", "start", "depot"].includes(req.end)) throw new UserError("Choose where the route finishes.");
    const serviceMin = Math.min(120, Math.max(0, Math.round(Number(req.serviceMin) || 0)));

    const needsDepot = req.start?.kind === "depot" || req.end === "depot";
    const depot = needsDepot ? await depotForUser(db, user.driverId) : null;
    if (needsDepot && !depot) throw new UserError("No depot is set up yet. Add one in Settings, or start from your location.");

    let start: QuickPlace;
    if (req.start?.kind === "gps") {
      if (!validPoint(req.start.lat, req.start.lng)) throw new UserError("Your location couldn't be read. Try again.");
      start = { lat: req.start.lat, lng: req.start.lng, label: "Your location" };
    } else if (req.start?.kind === "depot") {
      start = { lat: depot!.lat, lng: depot!.lng, label: depot!.name };
    } else {
      const address = String(req.start?.address ?? "").trim().slice(0, 300);
      if (!address) throw new UserError("Enter a starting address, or use your location.");
      const { lat, lng } = req.start ?? {};
      const g = validPoint(lat, lng) ? { status: "ok" as const, lat: lat!, lng: lng! } : await geocodeAddress(db, address);
      if (g.status === "failed") throw new UserError(`Couldn't find the starting address "${address}".`);
      start = { lat: g.lat!, lng: g.lng!, label: address };
    }

    // Nominatim allows one lookup per second; geocodeAddress spaces them and caches every result.
    const located: { address: string; lat: number; lng: number; label: string; approximate: boolean }[] = [];
    const notFound: string[] = [];
    for (const w of wanted) {
      if (validPoint(w.lat, w.lng)) {
        located.push({ address: w.address, lat: w.lat!, lng: w.lng!, label: w.address, approximate: false });
        continue;
      }
      const g = await geocodeAddress(db, w.address);
      if (g.status === "failed") notFound.push(w.address);
      else located.push({ address: w.address, lat: g.lat!, lng: g.lng!, label: g.label ?? w.address, approximate: g.status === "approximate" });
    }
    if (!located.length) throw new UserError("None of the addresses could be found. Check the spelling and add the suburb.");

    let end: QuickPlace | null = null;
    if (req.end === "depot") end = { lat: depot!.lat, lng: depot!.lng, label: depot!.name };
    else if (req.end === "start") {
      const r = req.returnTo;
      end = r && validPoint(r.lat, r.lng) ? { lat: r.lat, lng: r.lng, label: String(r.label ?? "Start").slice(0, 300) } : start;
    }
    const points: LatLng[] = [start, ...located, ...(end ? [end] : [])];
    const endNode = end ? located.length + 1 : null;

    const [matrix, learned] = await Promise.all([travelMatrix(points), learnTiming(db, s.timezone)]);
    // OSRM times assume empty roads. Drivers' real pace (learned from their delivery taps) beats
    // the settings guess once there's enough of it; either way it covers congestion and parking.
    const trafficFactor = learned?.trafficFactor ?? s.trafficFactor;
    const durations = matrix.durations.map((row) => row.map((d) => Math.round(d * trafficFactor)));
    const startS = nowSecondsIn(s.timezone);
    const plan = planSingleRoute(
      { durations, distances: matrix.distances },
      { stopCount: located.length, endNode, startS, serviceS: serviceMin * 60 },
    );

    const ordered = plan.legs.map((leg) => ({
      ...located[leg.stop],
      legDurationS: leg.durationS,
      legDistanceM: leg.distanceM,
      arrivalS: leg.arrivalS,
      departureS: leg.departureS,
    }));
    const path = await routeGeometry([start, ...ordered, ...(end ? [end] : [])]);

    return {
      data: {
        start,
        end,
        stops: ordered,
        returnLeg: plan.returnLeg,
        notFound,
        startS,
        driveS: plan.driveS,
        distanceM: plan.distanceM,
        finishS: plan.finishS,
        entered: plan.entered,
        exact: plan.exact,
        matrixSource: matrix.source,
        trafficFactor,
        learned: !!learned,
        path,
      },
    };
  });
}

/**
 * A Quick route stop delivered or not. Quick routes aren't planned orders, so each outcome is
 * kept as a one-off order (source "quick_route") with its delivery event, photo and signature,
 * which puts it in the office's order list with the same proof-of-delivery record.
 */
export async function recordQuickStop(_prev: unknown, form: FormData): Promise<ActionResult<{ orderId: string }>> {
  return attempt(async () => {
    const user = await assertUser(["admin", "dispatcher", "driver"]);
    const db = await getDb();
    const s = await getSettings(db);
    const address = clean(form.get("address"), 300);
    const lat = Number(form.get("stopLat"));
    const lng = Number(form.get("stopLng"));
    if (!address || !validPoint(lat, lng)) throw new UserError("This stop is missing its address. Plan the route again.");
    const type = form.get("outcome") === "failed" ? "failed" : "delivered";
    const outcome = await readOutcome(form, type, { ...s, proofRequired: true });

    const date = todayIn(s.timezone);
    const orderId = await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber: `QR-${date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
          deliveryDate: date,
          customerName: clean(form.get("label"), 200) ?? address,
          address,
          lat,
          lng,
          geocodeStatus: "ok",
          status: type,
          driverId: user.driverId,
          source: "quick_route",
        })
        .returning({ id: orders.id });
      const [event] = await tx
        .insert(deliveryEvents)
        .values({
          orderId: order.id,
          driverId: user.driverId,
          userId: user.id,
          type,
          reason: outcome.type === "failed" ? outcome.reason : null,
          recipient: outcome.type === "delivered" ? outcome.recipient : null,
          note: outcome.note,
          lat: outcome.at?.lat ?? null,
          lng: outcome.at?.lng ?? null,
          accuracyM: outcome.at?.accuracy ?? null,
        })
        .returning({ id: deliveryEvents.id });
      for (const kind of ["photo", "signature"] as const) {
        const p = outcome[kind];
        if (p) await saveProof(tx, { orderId: order.id, eventId: event.id, kind, mime: p.mime, data: p.data });
      }
      return order.id;
    });
    revalidatePath("/admin/orders");
    return { message: type === "delivered" ? "Marked as delivered" : "Delivery issue reported", data: { orderId } };
  });
}
