import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { depotForUser, getSettings, learnTiming } from "@/lib/planning";
import { QuickRouteLoader } from "./quick-route-loader";

export const metadata: Metadata = { title: "Quick route" };

// Route optimising (a server action on this page) can take longer than ordinary pages.
export const maxDuration = 300;

export default async function QuickRoutePage() {
  const user = await requireUser();
  const db = await getDb();
  const s = await getSettings(db);
  const [depot, learned] = await Promise.all([depotForUser(db, user.driverId), learnTiming(db, s.timezone)]);

  return (
    <QuickRouteLoader
      backHref={user.role === "driver" ? "/driver" : "/admin/planner"}
      depotName={depot?.name ?? null}
      // Unloading time measured from past deliveries, once there are enough of them.
      defaultServiceMin={learned?.serviceMin ?? s.defaultServiceMin}
      requirePhoto={s.requirePhoto}
      requireSignature={s.requireSignature}
    />
  );
}
