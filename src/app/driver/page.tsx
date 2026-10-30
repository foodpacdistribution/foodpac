import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { depotFor, getDepots, getPlanView, getSettings } from "@/lib/planning";
import { nowSecondsIn, todayIn } from "@/lib/time";
import { DriverClient } from "./driver-client";

export const metadata: Metadata = { title: "My deliveries" };

export default async function DriverPage() {
  const user = await requireUser(["driver"]);
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const view = await getPlanView(db, today);
  // Drivers only ever receive their own route, and only once it has been dispatched.
  const route = view.plan?.status === "dispatched" ? (view.routes.find((r) => r.driverId === user.driverId) ?? null) : null;
  const depot = depotFor(await getDepots(db), route?.depotId);

  return (
    <DriverClient
      name={user.name.split(" ")[0]}
      linked={!!user.driverId}
      date={today}
      nowS={nowSecondsIn(s.timezone)}
      depot={depot}
      route={route}
      requirePhoto={s.requirePhoto}
      requireSignature={s.requireSignature}
    />
  );
}
