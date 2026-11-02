import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { depotForUser, getSettings } from "@/lib/planning";
import { QuickRouteLoader } from "./quick-route-loader";

export const metadata: Metadata = { title: "Quick route" };

export default async function QuickRoutePage() {
  const user = await requireUser();
  const db = await getDb();
  const s = await getSettings(db);
  const depot = await depotForUser(db, user.driverId);

  return (
    <QuickRouteLoader
      backHref={user.role === "driver" ? "/driver" : "/admin/planner"}
      depotName={depot?.name ?? null}
      defaultServiceMin={s.defaultServiceMin}
    />
  );
}
