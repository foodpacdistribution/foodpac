"use server";

import { type ActionResult, attempt } from "@/lib/action";
import { assertUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { geocodeAddress, reverseGeocode } from "@/lib/geo/geocode";
import { type LatLng, routeGeometry, travelMatrix } from "@/lib/geo/routing";
import { depotForUser, getSettings, UserError } from "@/lib/planning";
import { MAX_QUICK_STOPS, planSingleRoute } from "@/lib/quick-route";
import { nowSecondsIn } from "@/lib/time";

export type QuickEnd = "last_stop" | "start" | "depot";

export type QuickRouteRequest = {
  start: { kind: "gps"; lat: number; lng: number } | { kind: "depot" } | { kind: "address"; address: string };
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
      const g = await geocodeAddress(db, address);
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

    const matrix = await travelMatrix(points);
    // OSRM times assume empty roads; the same traffic buffer as the Route Planner covers congestion and parking.
    const durations = matrix.durations.map((row) => row.map((d) => Math.round(d * s.trafficFactor)));
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
        trafficFactor: s.trafficFactor,
        path,
      },
    };
  });
}
