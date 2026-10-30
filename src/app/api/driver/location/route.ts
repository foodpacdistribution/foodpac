import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { plans, routes, vehicleLocations } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";

type Point = { lat: number; lng: number; accuracy?: number | null; speed?: number | null; heading?: number | null; ts: number };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Receives GPS fixes from the driver app. Fixes are only stored while the
 * driver's route for today is in progress — never before they start or after
 * they finish, so off-shift location is never collected.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "driver" || !user.driverId) return Response.json({ tracking: false, reason: "unauthorised" }, { status: 401 });

  let body: { points?: Point[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ tracking: false, reason: "bad_json" }, { status: 400 });
  }

  const db = await getDb();
  const s = await getSettings(db);
  const [route] = await db
    .select({ id: routes.id, status: routes.status })
    .from(routes)
    .innerJoin(plans, eq(plans.id, routes.planId))
    .where(and(eq(plans.deliveryDate, todayIn(s.timezone)), eq(plans.status, "dispatched"), eq(routes.driverId, user.driverId)))
    .limit(1);
  if (!route || route.status !== "in_progress") {
    return Response.json({ tracking: false, reason: route?.status === "completed" ? "route_completed" : "route_not_started" }, { status: 409 });
  }

  const now = Date.now();
  const points = (Array.isArray(body.points) ? body.points : []).slice(0, 200).flatMap((p) => {
    const lat = num(p?.lat);
    const lng = num(p?.lng);
    const ts = num(p?.ts);
    // Reject impossible coordinates and timestamps outside the last 12 hours.
    if (lat === null || lng === null || ts === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
    if (ts > now + 60_000 || ts < now - 12 * 3600_000) return [];
    const speed = num(p.speed);
    const heading = num(p.heading);
    return [
      {
        driverId: user.driverId!,
        routeId: route.id,
        lat,
        lng,
        accuracyM: num(p.accuracy),
        speedMps: speed !== null && speed >= 0 ? speed : null,
        heading: heading !== null && heading >= 0 && heading < 360 ? heading : null,
        recordedAt: new Date(ts),
      },
    ];
  });
  if (points.length) await db.insert(vehicleLocations).values(points);
  return Response.json({ tracking: true, stored: points.length });
}
